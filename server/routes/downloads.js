const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const Video = require('../models/Video');
const Download = require('../models/Download');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { sanitizeFilename, safeFetchVideo } = require('../utils/downloadSecurity');
const {
  hashToken,
  generateDownloadToken,
  verifyDownloadToken,
  generateOfflinePlaybackToken,
  verifyOfflinePlaybackToken,
} = require('../utils/signedUrl');
const {
  buildWatermarkText,
  applyWatermark,
  getWatermarkedPath,
  WATERMARKED_DIR,
} = require('../utils/watermarkService');

const DEFAULT_DAILY_LIMIT = 1; // Free tier limit: exactly 1 download per 24 hours
const RESERVATION_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24 hours

const UPLOAD_ROOT = path.resolve(__dirname, '../uploads');
const VIDEOS_DIR = path.join(UPLOAD_ROOT, 'videos');
const TEMP_DIR = path.join(UPLOAD_ROOT, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o755 });
}

/**
 * Normalizes tier names and maps legacy aliases ('vip' -> 'gold', 'premium' -> 'silver')
 * @param {string} tier
 * @returns {'free'|'bronze'|'silver'|'gold'}
 */
function normalizeTier(tier) {
  if (!tier) return 'free';
  const t = String(tier).toLowerCase().trim();
  if (t === 'gold' || t === 'vip') return 'gold';
  if (t === 'silver' || t === 'premium') return 'silver';
  if (t === 'bronze') return 'bronze';
  return 'free';
}

/**
 * Returns the daily distinct-video download limit for a given subscription tier.
 *
 * @param {'free'|'bronze'|'silver'|'gold'|'premium'|'vip'|undefined} tier
 * @returns {number} Limit (Infinity for Gold/VIP = no cap)
 */
function getDailyLimit(tier) {
  const norm = normalizeTier(tier);
  if (norm === 'gold') return Infinity;
  if (norm === 'silver') return 25;
  if (norm === 'bronze') return 5;
  return DEFAULT_DAILY_LIMIT; // 1 for 'free' or unknown
}

/**
 * Helper: Cleans up abandoned reservations older than 15 minutes for the user
 */
async function cleanupStaleReservations(userId) {
  const staleThreshold = new Date(Date.now() - RESERVATION_EXPIRY_MS);
  await Download.updateMany(
    {
      userId,
      status: 'reserved',
      reservedAt: { $lt: staleThreshold },
    },
    {
      $set: {
        status: 'interrupted',
        errorMessage: 'Download reservation timed out before completion.',
      },
    }
  );
}

/**
 * Helper: Computes rolling 24-hour distinct video download quota for a user,
 * checking subscription validity and handling expirations safely.
 */
async function getUserQuotaInfo(userId, userOrTier) {
  let tier = 'free';
  let isExpired = false;
  let expiresAt = null;
  let billingCycle = null;
  let isCancelled = false;

  if (typeof userOrTier === 'object' && userOrTier !== null) {
    expiresAt = userOrTier.subscriptionExpiresAt || null;
    billingCycle = userOrTier.subscriptionBillingCycle || null;
    isCancelled = Boolean(userOrTier.subscriptionCancelledAt);

    if (typeof userOrTier.getEffectiveTier === 'function') {
      tier = userOrTier.getEffectiveTier();
    } else {
      tier = normalizeTier(userOrTier.subscriptionTier);
      if (tier !== 'free' && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        tier = 'free';
        isExpired = true;
      }
    }
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      isExpired = true;
    }
  } else if (typeof userOrTier === 'string') {
    tier = normalizeTier(userOrTier);
  }

  const windowStart = new Date(Date.now() - QUOTA_WINDOW_MS);
  const dailyLimit = getDailyLimit(tier);

  // Clean stale reservations first
  await cleanupStaleReservations(userId);

  // Gold / VIP users: return early with unlimited quota
  if (dailyLimit === Infinity) {
    return {
      limit: null,       // null signals 'unlimited'
      used: 0,
      remaining: Infinity,
      resetsAt: null,
      resetsInHours: null,
      distinctVideoIds: [],
      tier,
      isExpired,
      expiresAt,
      billingCycle,
      isCancelled,
    };
  }

  // Find all active records in the 24-hour window
  const recentRecords = await Download.find({
    userId,
    createdAt: { $gte: windowStart },
    status: { $in: ['completed', 'reserved'] },
  }).sort({ createdAt: 1 }).lean();

  const distinctVideoIds = new Set(recentRecords.map(r => r.videoId));
  const used = distinctVideoIds.size;
  const remaining = Math.max(0, dailyLimit - used);

  // Determine earliest reset time among active records
  let resetsAt = null;
  let resetsInHours = null;
  if (recentRecords.length > 0) {
    const earliestTime = new Date(recentRecords[0].createdAt).getTime();
    resetsAt = new Date(earliestTime + QUOTA_WINDOW_MS);
    const msRemaining = Math.max(0, resetsAt.getTime() - Date.now());
    resetsInHours = Math.ceil(msRemaining / (1000 * 60 * 60));
  }

  return {
    limit: dailyLimit,
    used,
    remaining,
    resetsAt,
    resetsInHours,
    distinctVideoIds: Array.from(distinctVideoIds),
    tier,
    isExpired,
    expiresAt,
    billingCycle,
    isCancelled,
  };
}

/**
 * Resolves local or remote source file path for video watermarking.
 */
async function resolveVideoSource(video, abortSignal) {
  // 1. Check direct local storagePath from chunk assembler
  if (video.storagePath && fs.existsSync(video.storagePath)) {
    return { sourcePath: video.storagePath, isTemporary: false };
  }

  // 2. Check standard uploads/videos directory
  const localStandardPath = path.join(VIDEOS_DIR, `${video.id}.mp4`);
  if (fs.existsSync(localStandardPath)) {
    return { sourcePath: localStandardPath, isTemporary: false };
  }

  // 3. Remote URL fetch
  if (video.videoUrl && /^https?:\/\//i.test(video.videoUrl)) {
    const fetchResult = await safeFetchVideo(video.videoUrl, video.fallbackUrl, abortSignal);
    const tempSrcPath = path.join(TEMP_DIR, `dl_src_${video.id}_${Date.now()}.mp4`);
    const nodeStream = Readable.fromWeb(fetchResult.response.body);

    await new Promise((resolve, reject) => {
      const fileOut = fs.createWriteStream(tempSrcPath);
      nodeStream.pipe(fileOut);
      fileOut.on('finish', resolve);
      fileOut.on('error', reject);
      nodeStream.on('error', reject);
    });

    return { sourcePath: tempSrcPath, isTemporary: true };
  }

  // 4. Fallback check for any matching file in uploads/videos
  if (fs.existsSync(VIDEOS_DIR)) {
    const files = fs.readdirSync(VIDEOS_DIR);
    const matched = files.find(f => f.startsWith(video.id));
    if (matched) {
      return { sourcePath: path.join(VIDEOS_DIR, matched), isTemporary: false };
    }
  }

  throw new Error(`Video source file not found for video ${video.id}`);
}

/**
 * Streams the watermarked video file to the client with appropriate headers.
 */
async function executeWatermarkedDownloadStream({
  downloadRecord,
  video,
  user,
  req,
  res,
}) {
  const clientAbortController = new AbortController();
  let isClientDisconnected = false;

  req.on('close', () => {
    if (!res.writableEnded) {
      isClientDisconnected = true;
      clientAbortController.abort();
    }
  });

  let resolvedSource = null;
  let finalWatermarkedPath = null;

  try {
    // 1. Resolve source video file
    resolvedSource = await resolveVideoSource(video, clientAbortController.signal);

    // 2. Generate personalized watermark text
    const watermarkText = buildWatermarkText(user);
    finalWatermarkedPath = getWatermarkedPath(downloadRecord._id, video.id);

    // 3. Render watermark via FFmpeg
    await applyWatermark({
      inputPath: resolvedSource.sourcePath,
      outputPath: finalWatermarkedPath,
      watermarkText,
      signal: clientAbortController.signal,
    });

    // Clean up temporary fetched remote video source
    if (resolvedSource.isTemporary && fs.existsSync(resolvedSource.sourcePath)) {
      try { fs.unlinkSync(resolvedSource.sourcePath); } catch {}
    }

    if (!fs.existsSync(finalWatermarkedPath)) {
      throw new Error('Watermarked video generation did not produce an output file.');
    }

    const stat = fs.statSync(finalWatermarkedPath);
    const safeFilename = sanitizeFilename(video.title, video.id);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, no-transform, no-store');

    const fileStream = fs.createReadStream(finalWatermarkedPath);
    let bytesTransferred = 0;

    fileStream.on('data', chunk => {
      bytesTransferred += chunk.length;
    });

    fileStream.pipe(res);

    const markCompleted = async () => {
      if (downloadRecord.status === 'completed') return;
      try {
        downloadRecord.status = 'completed';
        downloadRecord.completedAt = new Date();
        downloadRecord.fileSize = stat.size;
        downloadRecord.bytesDownloaded = bytesTransferred;
        downloadRecord.isWatermarked = true;
        downloadRecord.watermarkText = watermarkText;
        downloadRecord.watermarkedPath = finalWatermarkedPath;
        await downloadRecord.save();
      } catch (saveErr) {
        console.error('[Download Completion Save Error]', saveErr);
      }
    };

    fileStream.on('end', markCompleted);
    res.on('finish', markCompleted);

    fileStream.on('error', async streamErr => {
      console.warn(`[Download Stream Error for ${video.id}]`, streamErr.message);
      try {
        downloadRecord.status = isClientDisconnected ? 'interrupted' : 'failed';
        downloadRecord.errorMessage = streamErr.message;
        downloadRecord.bytesDownloaded = bytesTransferred;
        await downloadRecord.save();
      } catch {}
    });

    res.on('close', async () => {
      if (!res.writableEnded) {
        try {
          if (downloadRecord.status === 'reserved') {
            downloadRecord.status = 'interrupted';
            downloadRecord.errorMessage = 'Client cancelled or disconnected during download transfer.';
            downloadRecord.bytesDownloaded = bytesTransferred;
            await downloadRecord.save();
          }
        } catch {}
      }
    });
  } catch (err) {
    if (resolvedSource && resolvedSource.isTemporary && fs.existsSync(resolvedSource.sourcePath)) {
      try { fs.unlinkSync(resolvedSource.sourcePath); } catch {}
    }

    // Roll back reservation so failed generation does not consume quota
    downloadRecord.status = isClientDisconnected ? 'interrupted' : 'failed';
    downloadRecord.errorMessage = err.message;
    await downloadRecord.save();

    console.error(`[Download Execution Error for ${video.id}]`, err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Failed to generate or deliver watermarked video.',
        code: 'WATERMARK_PROCESSING_ERROR',
        details: err.message,
      });
    }
  }
}

/**
 * GET /api/downloads/status
 * Returns current authenticated user's daily download quota status.
 */
router.get('/downloads/status', requireAuth, async (req, res) => {
  try {
    const quotaInfo = await getUserQuotaInfo(req.user._id, req.user);
    res.json({
      success: true,
      quota: quotaInfo,
    });
  } catch (err) {
    console.error('[Download Status Error]', err);
    res.status(500).json({ error: 'Failed to retrieve download quota status.' });
  }
});

/**
 * GET /api/downloads/history
 * Returns list of user's download attempts (completed, interrupted, failed).
 */
router.get('/downloads/history', requireAuth, async (req, res) => {
  try {
    const history = await Download.find({
      userId: req.user._id,
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(100);

    const safeHistory = history.map(d => d.toSafeObject());

    res.json({
      total: safeHistory.length,
      downloads: safeHistory,
    });
  } catch (err) {
    console.error('[Download History Error]', err);
    res.status(500).json({ error: 'Failed to retrieve download history.' });
  }
});

/**
 * DELETE /api/downloads/:id
 * Removes a download entry from user's visible download history.
 */
router.delete('/downloads/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid download ID format.' });
    }

    const record = await Download.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { $set: { isDeleted: true } },
      { new: true }
    );

    if (!record) {
      return res.status(404).json({ error: 'Download record not found.' });
    }

    res.json({
      success: true,
      message: 'Download record removed from history.',
    });
  } catch (err) {
    console.error('[Delete Download Error]', err);
    res.status(500).json({ error: 'Failed to delete download record.' });
  }
});

/**
 * POST /api/videos/:id/download-ticket
 *
 * Atomically checks quota, reserves a download slot in MongoDB via versioned CAS,
 * and issues a cryptographically signed, short-lived download authorization token.
 */
router.post('/videos/:id/download-ticket', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  try {
    // 1. Verify video exists
    const video = await Video.findOne({
      $or: [
        { id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    }).lean();

    if (!video) {
      return res.status(404).json({
        error: 'Video not found.',
        code: 'VIDEO_NOT_FOUND',
      });
    }

    // 2. Check quota
    const quotaInfo = await getUserQuotaInfo(userId, req.user);
    const isAlreadyDownloaded = quotaInfo.distinctVideoIds.includes(video.id);
    const dailyLimit = quotaInfo.limit === null ? Infinity : quotaInfo.limit;

    if (!isAlreadyDownloaded && quotaInfo.remaining <= 0) {
      const videoWord = dailyLimit === 1 ? 'video' : 'videos';
      return res.status(429).json({
        error: `Daily download quota exceeded (limit: ${dailyLimit} distinct ${videoWord} per 24 hours for ${quotaInfo.tier} plan).`,
        code: 'QUOTA_EXCEEDED',
        quota: quotaInfo,
      });
    }

    // 3. Atomically reserve slot via CAS
    let downloadRecord = null;
    const MAX_RETRIES = 3;
    let attempts = 0;

    while (attempts < MAX_RETRIES && !downloadRecord) {
      attempts++;
      const userDoc = await User.findById(userId);
      if (!userDoc) {
        return res.status(401).json({ error: 'User not found.', code: 'USER_NOT_FOUND' });
      }

      const qInfo = await getUserQuotaInfo(userId, userDoc);
      const isAlready = qInfo.distinctVideoIds.includes(video.id);
      const currentLimit = qInfo.limit === null ? Infinity : qInfo.limit;

      if (!isAlready && currentLimit !== Infinity && qInfo.remaining <= 0) {
        const videoWord = currentLimit === 1 ? 'video' : 'videos';
        return res.status(429).json({
          error: `Daily download quota exceeded (limit: ${currentLimit} distinct ${videoWord} per 24 hours for ${qInfo.tier} plan).`,
          code: 'QUOTA_EXCEEDED',
          quota: qInfo,
        });
      }

      const currentVersion = userDoc.quotaReservationVersion || 0;
      if (!isAlready && currentLimit !== Infinity) {
        const casResult = await User.updateOne(
          { _id: userId, quotaReservationVersion: currentVersion },
          { $inc: { quotaReservationVersion: 1 } }
        );
        if (casResult.matchedCount === 0 || casResult.modifiedCount === 0) {
          continue;
        }
      }

      const rec = new Download({
        userId,
        videoId: video.id,
        videoTitle: video.title,
        channelName: video.channel?.name || '',
        thumbnailUrl: video.thumbnailUrl || '',
        status: 'reserved',
        reservedAt: new Date(),
        sourceUrl: video.videoUrl || '',
      });
      await rec.save();
      downloadRecord = rec;
    }

    if (!downloadRecord) {
      return res.status(429).json({
        error: 'Concurrent download conflict. Daily quota limit reached.',
        code: 'QUOTA_EXCEEDED',
        quota: await getUserQuotaInfo(userId, req.user),
      });
    }

    // 4. Generate signed download authorization token (15-minute expiration)
    const tokenData = generateDownloadToken({
      downloadId: downloadRecord._id,
      videoId: video.id,
      userId,
      expiresInSeconds: 900,
    });

    downloadRecord.downloadTokenHash = tokenData.downloadTokenHash;
    downloadRecord.tokenExpiresAt = tokenData.expiresAt;
    await downloadRecord.save();

    const updatedQuota = await getUserQuotaInfo(userId, req.user);

    res.json({
      success: true,
      downloadId: downloadRecord._id.toString(),
      downloadUrl: `/api/downloads/download?token=${tokenData.token}`,
      expiresAt: tokenData.expiresAt,
      quota: updatedQuota,
    });
  } catch (err) {
    console.error('[Download Ticket Error]', err);
    res.status(500).json({ error: 'Failed to generate download ticket.' });
  }
});

/**
 * GET /api/downloads/download
 *
 * Validates the cryptographically signed download token, enforces expiration
 * and single-use link security, renders user watermark, and streams the MP4 file.
 */
router.get('/downloads/download', async (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(400).json({
      error: 'Signed download token is required.',
      code: 'MISSING_TOKEN',
    });
  }

  // 1. Verify signed token signature and expiry
  const verification = verifyDownloadToken(token);
  if (!verification.valid) {
    if (verification.code === 'TOKEN_EXPIRED') {
      return res.status(410).json({
        error: 'Download link has expired. Please generate a new download request.',
        code: 'TOKEN_EXPIRED',
      });
    }
    if (verification.code === 'INVALID_SIGNATURE') {
      return res.status(403).json({
        error: 'Invalid download link signature. URL tampering detected.',
        code: 'INVALID_SIGNATURE',
      });
    }
    return res.status(400).json({
      error: verification.error || 'Invalid download token format.',
      code: verification.code || 'INVALID_TOKEN',
    });
  }

  const { downloadId, videoId, userId } = verification.payload;

  try {
    // 2. Fetch the reservation record
    const downloadRecord = await Download.findById(downloadId);
    if (!downloadRecord || downloadRecord.isDeleted) {
      return res.status(404).json({
        error: 'Download authorization record not found or was removed.',
        code: 'DOWNLOAD_NOT_FOUND',
      });
    }

    // 3. Enforce single-use link prevention: Completed tokens cannot be re-executed
    if (downloadRecord.status === 'completed') {
      return res.status(403).json({
        error: 'This download link has already been used. Please request a fresh download ticket.',
        code: 'TOKEN_ALREADY_USED',
      });
    }

    // 4. Verify binding to user and video
    if (downloadRecord.userId.toString() !== userId || downloadRecord.videoId !== videoId) {
      return res.status(403).json({
        error: 'Download authorization mismatch.',
        code: 'TOKEN_MISMATCH',
      });
    }

    // 5. Fetch user and video documents
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ error: 'Authorized user not found.', code: 'USER_NOT_FOUND' });
    }

    const video = await Video.findOne({
      $or: [
        { id: videoId },
        ...(mongoose.Types.ObjectId.isValid(videoId) ? [{ _id: videoId }] : []),
      ],
    }).lean();

    if (!video) {
      return res.status(404).json({ error: 'Video not found.', code: 'VIDEO_NOT_FOUND' });
    }

    // 6. Execute watermarked video delivery
    await executeWatermarkedDownloadStream({
      downloadRecord,
      video,
      user,
      req,
      res,
    });
  } catch (err) {
    console.error('[Download Execution Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process secure download.' });
    }
  }
});

/**
 * GET /api/videos/:id/download
 *
 * Backward-compatible download endpoint.
 * If called with ?token=..., validates signed token.
 * If called by authenticated user, performs atomic reservation, watermarking, and streaming.
 */
router.get('/videos/:id/download', async (req, res, next) => {
  // If token is present, delegate directly to the signed token download handler
  if (req.query.token) {
    return router.handle({ ...req, url: `/downloads/download?token=${req.query.token}` }, res, next);
  }

  // Otherwise, require authentication and process directly
  return requireAuth(req, res, async () => {
    const { id } = req.params;
    const userId = req.user._id;

    try {
      const video = await Video.findOne({
        $or: [
          { id },
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
        ],
      }).lean();

      if (!video) {
        return res.status(404).json({ error: 'Video not found.', code: 'VIDEO_NOT_FOUND' });
      }

      const quotaInfo = await getUserQuotaInfo(userId, req.user);
      const isAlreadyDownloaded = quotaInfo.distinctVideoIds.includes(video.id);
      const dailyLimit = quotaInfo.limit === null ? Infinity : quotaInfo.limit;

      if (!isAlreadyDownloaded && quotaInfo.remaining <= 0) {
        const videoWord = dailyLimit === 1 ? 'video' : 'videos';
        return res.status(429).json({
          error: `Daily download quota exceeded (limit: ${dailyLimit} distinct ${videoWord} per 24 hours for ${quotaInfo.tier} plan).`,
          code: 'QUOTA_EXCEEDED',
          quota: quotaInfo,
        });
      }

      // CAS reservation
      let downloadRecord = null;
      let attempts = 0;
      while (attempts < 3 && !downloadRecord) {
        attempts++;
        const userDoc = await User.findById(userId);
        if (!userDoc) return res.status(401).json({ error: 'User not found.' });

        const qInfo = await getUserQuotaInfo(userId, userDoc);
        const isAlready = qInfo.distinctVideoIds.includes(video.id);
        const currentLimit = qInfo.limit === null ? Infinity : qInfo.limit;

        if (!isAlready && currentLimit !== Infinity && qInfo.remaining <= 0) {
          return res.status(429).json({
            error: 'Daily download quota exceeded.',
            code: 'QUOTA_EXCEEDED',
            quota: qInfo,
          });
        }

        const currentVersion = userDoc.quotaReservationVersion || 0;
        if (!isAlready && currentLimit !== Infinity) {
          const casResult = await User.updateOne(
            { _id: userId, quotaReservationVersion: currentVersion },
            { $inc: { quotaReservationVersion: 1 } }
          );
          if (casResult.matchedCount === 0 || casResult.modifiedCount === 0) continue;
        }

        const rec = new Download({
          userId,
          videoId: video.id,
          videoTitle: video.title,
          channelName: video.channel?.name || '',
          thumbnailUrl: video.thumbnailUrl || '',
          status: 'reserved',
          reservedAt: new Date(),
          sourceUrl: video.videoUrl || '',
        });
        await rec.save();
        downloadRecord = rec;
      }

      if (!downloadRecord) {
        return res.status(429).json({
          error: 'Concurrent download conflict. Quota limit reached.',
          code: 'QUOTA_EXCEEDED',
        });
      }

      await executeWatermarkedDownloadStream({
        downloadRecord,
        video,
        user: req.user,
        req,
        res,
      });
    } catch (err) {
      console.error('[Direct Download Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process download request.' });
      }
    }
  });
});

/**
 * POST /api/downloads/:id/offline-auth
 *
 * Issues a short-lived offline playback authorization token for a completed download.
 */
router.post('/downloads/:id/offline-auth', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid download ID format.' });
    }

    const record = await Download.findOne({
      _id: id,
      userId: req.user._id,
      status: 'completed',
      isDeleted: { $ne: true },
    });

    if (!record) {
      return res.status(404).json({
        error: 'Completed download record not found for offline authorization.',
        code: 'DOWNLOAD_NOT_COMPLETED',
      });
    }

    // Determine authorization duration based on plan:
    // Gold: 7 days, Silver: 3 days, Bronze/Free: 48 hours
    const tier = req.user.getEffectiveTier ? req.user.getEffectiveTier() : 'free';
    const expiresInSeconds = tier === 'gold' ? 7 * 24 * 3600 : tier === 'silver' ? 3 * 24 * 3600 : 48 * 3600;

    const tokenData = generateOfflinePlaybackToken({
      downloadId: record._id,
      videoId: record.videoId,
      userId: req.user._id,
      expiresInSeconds,
    });

    record.offlineAuthTokenHash = tokenData.tokenHash;
    record.offlineAuthExpiresAt = tokenData.expiresAt;
    await record.save();

    res.json({
      success: true,
      offlineToken: tokenData.token,
      expiresAt: tokenData.expiresAt,
      videoId: record.videoId,
      licenseType: 'offline-playback-v1',
      limitations: 'Browser storage does not provide hardware DRM protection. Offline authorization validates user playback permission locally.',
    });
  } catch (err) {
    console.error('[Offline Auth Error]', err);
    res.status(500).json({ error: 'Failed to generate offline authorization.' });
  }
});

/**
 * GET /api/downloads/offline-verify
 *
 * Validates an offline playback authorization token.
 */
router.get('/downloads/offline-verify', async (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(400).json({ error: 'Offline token is required.', valid: false });
  }

  const result = verifyOfflinePlaybackToken(token);
  if (!result.valid) {
    return res.status(401).json({
      valid: false,
      error: result.error,
      code: result.code,
    });
  }

  res.json({
    valid: true,
    payload: result.payload,
  });
});

module.exports = router;
