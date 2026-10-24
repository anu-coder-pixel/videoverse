const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Readable } = require('stream');
const Video = require('../models/Video');
const Download = require('../models/Download');
const { requireAuth } = require('../middleware/auth');
const { sanitizeFilename, safeFetchVideo } = require('../utils/downloadSecurity');

const DEFAULT_DAILY_LIMIT = 5; // Free tier fallback (used only when tier is absent)
const RESERVATION_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24 hours

/**
 * Returns the daily distinct-video download limit for a given subscription tier.
 *
 * @param {'free'|'premium'|'vip'|undefined} tier
 * @returns {number} Limit (Infinity for VIP = no cap)
 */
function getDailyLimit(tier) {
  if (tier === 'vip') return Infinity;
  if (tier === 'premium') return 25;
  return DEFAULT_DAILY_LIMIT; // 'free' or any unknown value
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
 * Helper: Computes rolling 24-hour distinct video download quota for a user
 * @param {import('mongoose').Types.ObjectId} userId
 * @param {'free'|'premium'|'vip'} tier
 */
async function getUserQuotaInfo(userId, tier) {
  const windowStart = new Date(Date.now() - QUOTA_WINDOW_MS);
  const dailyLimit = getDailyLimit(tier);

  // Clean stale reservations first
  await cleanupStaleReservations(userId);

  // VIP users: return early with unlimited quota (no DB read needed for quota)
  if (dailyLimit === Infinity) {
    return {
      limit: null,       // null signals 'unlimited'
      used: 0,
      remaining: Infinity,
      resetsAt: null,
      resetsInHours: null,
      distinctVideoIds: [],
      tier: 'vip',
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
    tier: tier || 'free',
  };
}

/**
 * GET /api/downloads/status
 *
 * Returns current authenticated user's daily download quota status.
 */
router.get('/downloads/status', requireAuth, async (req, res) => {
  try {
    const quotaInfo = await getUserQuotaInfo(req.user._id, req.user.subscriptionTier);
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
 *
 * Returns list of user's download attempts (completed, interrupted, failed).
 * Excludes soft-deleted entries.
 */
router.get('/downloads/history', requireAuth, async (req, res) => {
  try {
    const history = await Download.find({
      userId: req.user._id,
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const safeHistory = history.map(d => ({
      id: d._id.toString(),
      videoId: d.videoId,
      videoTitle: d.videoTitle,
      channelName: d.channelName,
      thumbnailUrl: d.thumbnailUrl,
      status: d.status,
      fileSize: d.fileSize,
      bytesDownloaded: d.bytesDownloaded,
      errorMessage: d.errorMessage,
      createdAt: d.createdAt,
      completedAt: d.completedAt,
    }));

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
 *
 * Removes a download entry from user's visible download history.
 * Does NOT delete the video or alter user accounts.
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
 * GET /api/videos/:id/download
 *
 * Initiates an authenticated, controlled video download stream.
 * - Authenticated: requireAuth (Free and all tiers allowed)
 * - Quota: 5 distinct videos per 24 hours. Re-downloads within window do not consume quota.
 * - Concurrency: Safely reserves a slot atomically.
 * - Security: Validates remote origin, HTTPS only, no user-supplied URLs, no unapproved redirects.
 * - Streaming: Bounded memory pipe with abort signals on disconnect.
 */
router.get('/videos/:id/download', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  try {
    // 1. Verify video exists in MongoDB
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

    // 2. Check and enforce 24-hour distinct video quota
    const quotaInfo = await getUserQuotaInfo(userId, req.user.subscriptionTier);
    const isAlreadyDownloaded = quotaInfo.distinctVideoIds.includes(video.id);
    const dailyLimit = getDailyLimit(req.user.subscriptionTier);

    if (!isAlreadyDownloaded && quotaInfo.remaining <= 0) {
      return res.status(429).json({
        error: `Daily download quota exceeded (limit: ${dailyLimit} distinct videos per 24 hours for ${req.user.subscriptionTier} plan).`,
        code: 'QUOTA_EXCEEDED',
        quota: quotaInfo,
      });
    }

    // 3. Atomically reserve slot in MongoDB
    const downloadRecord = new Download({
      userId,
      videoId: video.id,
      videoTitle: video.title,
      channelName: video.channel?.name || '',
      thumbnailUrl: video.thumbnailUrl || '',
      status: 'reserved',
      reservedAt: new Date(),
      sourceUrl: video.videoUrl || '',
    });
    await downloadRecord.save();

    // 3b. Concurrency guard: re-verify distinct chronological order in case of simultaneous requests
    // VIP has no quota limit, so skip the concurrency check for them
    if (!isAlreadyDownloaded && dailyLimit !== Infinity) {
      const windowStart = new Date(Date.now() - QUOTA_WINDOW_MS);
      const allActive = await Download.find({
        userId,
        createdAt: { $gte: windowStart },
        status: { $in: ['completed', 'reserved'] },
      }).sort({ createdAt: 1 }).lean();

      // Collect distinct video IDs in order of first appearance
      const firstAllowedVideos = [];
      for (const rec of allActive) {
        if (!firstAllowedVideos.includes(rec.videoId)) {
          firstAllowedVideos.push(rec.videoId);
          if (firstAllowedVideos.length === dailyLimit) break;
        }
      }

      // If this video ID did not make the top allowed distinct slots due to a race
      if (!firstAllowedVideos.includes(video.id)) {
        downloadRecord.status = 'failed';
        downloadRecord.errorMessage = 'Concurrency race: daily quota limit reached by simultaneous request.';
        await downloadRecord.save();

        return res.status(429).json({
          error: `Daily download quota exceeded (limit: ${dailyLimit} distinct videos per 24 hours for ${req.user.subscriptionTier} plan).`,
          code: 'QUOTA_EXCEEDED',
          quota: {
            limit: dailyLimit,
            used: dailyLimit,
            remaining: 0,
            tier: req.user.subscriptionTier,
          },
        });
      }
    }

    // 4. Setup client disconnect abort controller
    const clientAbortController = new AbortController();
    let isClientDisconnected = false;

    req.on('close', () => {
      // If request finishes normally, res.writableEnded is true.
      if (!res.writableEnded) {
        isClientDisconnected = true;
        clientAbortController.abort();
      }
    });

    // 5. Fetch remote video safely before sending response headers
    let fetchResult;
    try {
      fetchResult = await safeFetchVideo(
        video.videoUrl,
        video.fallbackUrl,
        clientAbortController.signal
      );
    } catch (originErr) {
      // Failed before sending headers: mark as failed
      downloadRecord.status = 'failed';
      downloadRecord.errorMessage = originErr.message;
      await downloadRecord.save();

      console.error(`[Download Origin Error for ${video.id}]`, originErr.message);
      return res.status(502).json({
        error: 'The video source file is currently unreachable from origin servers.',
        code: 'ORIGIN_UNREACHABLE',
        details: originErr.message,
      });
    }

    const { response, isByteRangeSupported, contentLength } = fetchResult;

    // 6. Set Content-Disposition and verified streaming headers
    const safeFilename = sanitizeFilename(video.title, video.id);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Cache-Control', 'private, no-transform, no-store');

    if (contentLength > 0) {
      res.setHeader('Content-Length', contentLength);
    }

    // Only claim byte ranges if verified by remote response
    if (isByteRangeSupported) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    // 7. Stream with bounded memory using Node.js stream
    const nodeStream = Readable.fromWeb(response.body);
    let bytesTransferred = 0;

    nodeStream.on('data', chunk => {
      bytesTransferred += chunk.length;
    });

    nodeStream.pipe(res);

    nodeStream.on('end', async () => {
      // Entire stream finished successfully
      try {
        downloadRecord.status = 'completed';
        downloadRecord.completedAt = new Date();
        downloadRecord.fileSize = contentLength > 0 ? contentLength : bytesTransferred;
        downloadRecord.bytesDownloaded = bytesTransferred;
        await downloadRecord.save();
      } catch (saveErr) {
        console.error('[Download Completion Save Error]', saveErr);
      }
    });

    nodeStream.on('error', async streamErr => {
      console.warn(`[Download Stream Error for ${video.id}]`, streamErr.message);
      try {
        downloadRecord.status = isClientDisconnected ? 'interrupted' : 'failed';
        downloadRecord.errorMessage = streamErr.message;
        downloadRecord.bytesDownloaded = bytesTransferred;
        await downloadRecord.save();
      } catch (err) {
        // ignore
      }
    });

    res.on('close', async () => {
      if (!res.writableEnded) {
        // Client disconnected mid-transfer
        try {
          if (downloadRecord.status === 'reserved') {
            downloadRecord.status = 'interrupted';
            downloadRecord.errorMessage = 'Client cancelled or disconnected during download transfer.';
            downloadRecord.bytesDownloaded = bytesTransferred;
            await downloadRecord.save();
          }
        } catch (err) {
          // ignore
        }
      }
    });
  } catch (err) {
    console.error('[Download Handler Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process download request.' });
    }
  }
});

module.exports = router;
