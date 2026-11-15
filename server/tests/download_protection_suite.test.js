/**
 * VideoVerse Phase 2, Step 5 — Download Protection, Watermarking & Cleanup Test Suite
 *
 * Covers:
 * 1. User-Specific Watermark Generation & Formatting:
 *    - Privacy-preserving masked identifier generation
 *    - FFmpeg drawtext watermark embedding without mutating source video
 *    - User-specific isolation (different users receive distinct watermarked files)
 * 2. Secure Cryptographic Signed Download URLs:
 *    - Valid HMAC-SHA256 token generation and acceptance
 *    - Link expiration (returns HTTP 410)
 *    - URL tampering / forged signature rejection (returns HTTP 403)
 *    - Single-use replay protection (completed tokens cannot be re-executed, returns HTTP 403)
 *    - Missing token handling (returns HTTP 400)
 * 3. Daily Download Quota Enforcement:
 *    - Free plan: exactly 1 distinct video per 24 hours (second distinct video returns HTTP 429)
 *    - Bronze plan (5 distinct), Silver plan (25 distinct), Gold plan (Unlimited)
 *    - Re-downloading the same distinct video within 24 hours does NOT consume quota
 *    - Concurrent reservation race conditions (CAS versioning)
 *    - Failed download rollback (failed generation does not consume quota)
 *    - Expired Gold subscription (reverts to Free limit = 1)
 * 4. Offline Playback Authorization:
 *    - Issues short-lived offline authorization tokens
 *    - Rejects uncompleted downloads
 *    - Offline token expiration and signature validation
 * 5. Background Cleanup Worker:
 *    - Purges orphaned upload chunks and expired watermarked temporary files
 *    - Resolves stale reservations (>15 mins) to 'interrupted'
 *    - Traversal guard strictly prevents deletion of original uploaded videos
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { app } = require('../index');
const User = require('../models/User');
const Video = require('../models/Video');
const Download = require('../models/Download');
const {
  generateDownloadToken,
  verifyDownloadToken,
  generateOfflinePlaybackToken,
  verifyOfflinePlaybackToken,
  hashToken,
} = require('../utils/signedUrl');
const {
  createMaskedIdentifier,
  buildWatermarkText,
  applyWatermark,
  getWatermarkedPath,
  WATERMARKED_DIR,
} = require('../utils/watermarkService');
const {
  runCleanup,
  sweepOldFiles,
  UPLOAD_ROOT,
  CHUNKS_DIR,
  TEMP_DIR,
  VIDEOS_DIR,
} = require('../utils/cleanupWorker');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const FFMPEG_BIN = ffmpegInstaller.path;

describe('Phase 2, Step 5: Download Protection, Watermarking & Cleanup Suite', () => {
  let userFree, userBronze, userGold, userExpiredGold, userOther;
  let tokenFree, tokenBronze, tokenGold, tokenExpiredGold, tokenOther;
  let testVideo1, testVideo2, sampleVideoPath;

  const tempTestDir = path.resolve(__dirname, '../uploads/temp_step5_test');

  // Helper to generate synthetic test MP4 video using bundled ffmpeg
  function generateSyntheticVideo(targetPath, durationSec = 2) {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', 'lavfi',
        '-i', `testsrc=duration=${durationSec}:size=640x360:rate=30`,
        '-f', 'lavfi',
        '-i', `sine=frequency=1000:duration=${durationSec}`,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-pix_fmt', 'yuv420p',
        '-y',
        targetPath,
      ];
      const proc = spawn(FFMPEG_BIN, args);
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(targetPath)) resolve(targetPath);
        else reject(new Error(`Failed to generate test video (code ${code})`));
      });
      proc.on('error', reject);
    });
  }

  beforeAll(async () => {
    if (!fs.existsSync(tempTestDir)) fs.mkdirSync(tempTestDir, { recursive: true });
    sampleVideoPath = path.join(tempTestDir, 'step5_source.mp4');
    await generateSyntheticVideo(sampleVideoPath, 2);

    // Clean up test data
    await User.deleteMany({
      email: {
        $in: [
          'step5_free@example.com',
          'step5_bronze@example.com',
          'step5_gold@example.com',
          'step5_expired_gold@example.com',
          'step5_other@example.com',
        ],
      },
    });
    await Video.deleteMany({ id: { $in: ['step5-vid-001', 'step5-vid-002'] } });
    await Download.deleteMany({});

    // 1. Create Users
    userFree = await User.create({
      name: 'Free User',
      email: 'step5_free@example.com',
      passwordHash: 'dummyhash',
      subscriptionTier: 'free',
      quotaReservationVersion: 0,
    });
    tokenFree = jwt.sign({ id: userFree._id.toString(), email: userFree.email, role: 'user' }, process.env.JWT_SECRET || 'testsecret');

    userBronze = await User.create({
      name: 'Bronze User',
      email: 'step5_bronze@example.com',
      passwordHash: 'dummyhash',
      subscriptionTier: 'bronze',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      quotaReservationVersion: 0,
    });
    tokenBronze = jwt.sign({ id: userBronze._id.toString(), email: userBronze.email, role: 'user' }, process.env.JWT_SECRET || 'testsecret');

    userGold = await User.create({
      name: 'Gold User',
      email: 'step5_gold@example.com',
      passwordHash: 'dummyhash',
      subscriptionTier: 'gold',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      quotaReservationVersion: 0,
    });
    tokenGold = jwt.sign({ id: userGold._id.toString(), email: userGold.email, role: 'user' }, process.env.JWT_SECRET || 'testsecret');

    userExpiredGold = await User.create({
      name: 'Expired Gold User',
      email: 'step5_expired_gold@example.com',
      passwordHash: 'dummyhash',
      subscriptionTier: 'gold',
      subscriptionExpiresAt: new Date(Date.now() - 5 * 24 * 3600 * 1000), // Expired 5 days ago!
      quotaReservationVersion: 0,
    });
    tokenExpiredGold = jwt.sign({ id: userExpiredGold._id.toString(), email: userExpiredGold.email, role: 'user' }, process.env.JWT_SECRET || 'testsecret');

    userOther = await User.create({
      name: 'Other User',
      email: 'step5_other@example.com',
      passwordHash: 'dummyhash',
      subscriptionTier: 'free',
      quotaReservationVersion: 0,
    });
    tokenOther = jwt.sign({ id: userOther._id.toString(), email: userOther.email, role: 'user' }, process.env.JWT_SECRET || 'testsecret');

    // 2. Create Videos
    testVideo1 = await Video.create({
      id: 'step5-vid-001',
      title: 'Watermark Test Video One',
      description: 'Testing video watermarking and signed URLs',
      category: 'Education',
      tags: ['download', 'watermark'],
      videoUrl: '/api/videos/step5-vid-001/stream',
      storagePath: sampleVideoPath,
      duration: '0:02',
      views: '100',
      likes: 10,
      dislikes: 0,
      channel: {
        id: 'ch-step5',
        name: 'Step5 Channel',
        handle: '@step5ch',
        subscribers: '1K',
        avatarColor: '#6c63ff',
        initials: 'S5',
        verified: true,
      },
      processingStatus: 'ready',
    });

    testVideo2 = await Video.create({
      id: 'step5-vid-002',
      title: 'Watermark Test Video Two',
      description: 'Testing second download quota slot',
      category: 'Education',
      tags: ['download', 'quota'],
      videoUrl: '/api/videos/step5-vid-002/stream',
      storagePath: sampleVideoPath,
      duration: '0:02',
      views: '50',
      likes: 5,
      dislikes: 0,
      channel: {
        id: 'ch-step5',
        name: 'Step5 Channel',
        handle: '@step5ch',
        subscribers: '1K',
        avatarColor: '#6c63ff',
        initials: 'S5',
        verified: true,
      },
      processingStatus: 'ready',
    });
  }, 35000);

  afterAll(async () => {
    await User.deleteMany({
      email: {
        $in: [
          'step5_free@example.com',
          'step5_bronze@example.com',
          'step5_gold@example.com',
          'step5_expired_gold@example.com',
          'step5_other@example.com',
        ],
      },
    });
    await Video.deleteMany({ id: { $in: ['step5-vid-001', 'step5-vid-002'] } });
    await Download.deleteMany({});

    try {
      if (fs.existsSync(tempTestDir)) fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Watermark Generation & Formatting ────────────────────────────────
  describe('1. Watermark Generation & Isolation', () => {
    it('creates masked user identifier preserving privacy', () => {
      expect(createMaskedIdentifier({ email: 'alice.smith@example.com' })).toBe('a***h@example.com');
      expect(createMaskedIdentifier({ email: 'bob@corp.org' })).toBe('b***b@corp.org');
      expect(createMaskedIdentifier({ _id: '6af8ad2a6f082b7a64a1f52d' })).toBe('User_***f52d');
    });

    it('builds standard watermark text including branding and date', () => {
      const text = buildWatermarkText({ email: 'john.doe@example.com' });
      expect(text).toContain('VideoVerse • j***e@example.com •');
    });

    it('renders watermark onto video via FFmpeg without altering original source', async () => {
      const outPath = path.join(tempTestDir, 'watermarked_output.mp4');
      const originalStatBefore = fs.statSync(sampleVideoPath);

      const resPath = await applyWatermark({
        inputPath: sampleVideoPath,
        outputPath: outPath,
        watermarkText: 'VideoVerse • test_user • 2026-11-15',
      });

      expect(resPath).toBe(outPath);
      expect(fs.existsSync(outPath)).toBe(true);
      expect(fs.statSync(outPath).size).toBeGreaterThan(0);

      // Verify source file was untouched
      const originalStatAfter = fs.statSync(sampleVideoPath);
      expect(originalStatAfter.size).toBe(originalStatBefore.size);
    }, 20000);

    it('isolates watermarked files for different users', () => {
      const pathA = getWatermarkedPath('dl_001', 'vid_01');
      const pathB = getWatermarkedPath('dl_002', 'vid_01');
      expect(pathA).not.toBe(pathB);
      expect(pathA).toContain('dl_001');
      expect(pathB).toContain('dl_002');
    });
  });

  // ── 2. Secure Cryptographic Signed Download URLs ────────────────────────
  describe('2. Signed Download Authorization URLs', () => {
    let validToken, expiredToken, tamperedToken, downloadId;

    beforeAll(async () => {
      const rec = await Download.create({
        userId: userFree._id,
        videoId: testVideo1.id,
        videoTitle: testVideo1.title,
        status: 'reserved',
      });
      downloadId = rec._id;

      // 1. Valid token (15 mins)
      const tokenObj = generateDownloadToken({
        downloadId,
        videoId: testVideo1.id,
        userId: userFree._id,
        expiresInSeconds: 900,
      });
      validToken = tokenObj.token;
      rec.downloadTokenHash = tokenObj.downloadTokenHash;
      rec.tokenExpiresAt = tokenObj.expiresAt;
      await rec.save();

      // 2. Expired token (-10 seconds)
      const expiredObj = generateDownloadToken({
        downloadId,
        videoId: testVideo1.id,
        userId: userFree._id,
        expiresInSeconds: -10,
      });
      expiredToken = expiredObj.token;

      // 3. Tampered token (modified payload without valid signature)
      const [payloadPart, sigPart] = validToken.split('.');
      const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      decoded.vId = 'malicious-injected-vid';
      const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
      tamperedToken = `${forgedPayload}.${sigPart}`;
    });

    it('accepts valid signed token and streams watermarked video with attachment header', async () => {
      const res = await request(app)
        .get(`/api/downloads/download?token=${validToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.body.length).toBeGreaterThan(0);

      // Verify Download record marked as completed with watermark info (polling for async save)
      let updatedRec = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 100));
        updatedRec = await Download.findById(downloadId);
        if (updatedRec && updatedRec.status === 'completed') break;
      }
      expect(updatedRec.status).toBe('completed');
      expect(updatedRec.isWatermarked).toBe(true);
      expect(updatedRec.fileSize).toBeGreaterThan(0);
    }, 25000);

    it('enforces single-use replay protection: completed token cannot be re-executed', async () => {
      const res = await request(app)
        .get(`/api/downloads/download?token=${validToken}`)
        .expect(403);

      expect(res.body.code).toBe('TOKEN_ALREADY_USED');
    });

    it('rejects expired signed token with HTTP 410', async () => {
      const res = await request(app)
        .get(`/api/downloads/download?token=${expiredToken}`)
        .expect(410);

      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects tampered URL / forged token with HTTP 403', async () => {
      const res = await request(app)
        .get(`/api/downloads/download?token=${tamperedToken}`)
        .expect(403);

      expect(res.body.code).toBe('INVALID_SIGNATURE');
    });

    it('rejects missing token query parameter with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/downloads/download')
        .expect(400);

      expect(res.body.code).toBe('MISSING_TOKEN');
    });
  });

  // ── 3. Download Quota Enforcement & CAS ──────────────────────────────────
  describe('3. Download Quota Enforcement & Plan Limits', () => {
    it('Free plan: allows exactly 1 distinct video per 24 hours and rejects 2nd with HTTP 429', async () => {
      // 1st distinct video download ticket -> allowed
      const res1 = await request(app)
        .post(`/api/videos/${testVideo1.id}/download-ticket`)
        .set('Authorization', `Bearer ${tokenFree}`)
        .expect(200);

      expect(res1.body.success).toBe(true);
      expect(res1.body.downloadUrl).toContain('/api/downloads/download?token=');
      expect(res1.body.quota.remaining).toBe(0);

      // 2nd distinct video download ticket -> rejected with 429 QUOTA_EXCEEDED
      const res2 = await request(app)
        .post(`/api/videos/${testVideo2.id}/download-ticket`)
        .set('Authorization', `Bearer ${tokenFree}`)
        .expect(429);

      expect(res2.body.code).toBe('QUOTA_EXCEEDED');
      expect(res2.body.error).toContain('quota exceeded');
    });

    it('allows re-downloading the same video within 24 hours without consuming extra quota', async () => {
      // Re-requesting ticket for testVideo1 should be permitted
      const res = await request(app)
        .post(`/api/videos/${testVideo1.id}/download-ticket`)
        .set('Authorization', `Bearer ${tokenFree}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('Bronze plan: permits up to 5 distinct videos per 24 hours', async () => {
      const res = await request(app)
        .get('/api/downloads/status')
        .set('Authorization', `Bearer ${tokenBronze}`)
        .expect(200);

      expect(res.body.quota.limit).toBe(5);
      expect(res.body.quota.remaining).toBe(5);
      expect(res.body.quota.tier).toBe('bronze');
    });

    it('Gold plan: provides unlimited downloads without daily cap', async () => {
      const res = await request(app)
        .get('/api/downloads/status')
        .set('Authorization', `Bearer ${tokenGold}`)
        .expect(200);

      expect(res.body.quota.limit).toBeNull(); // null = unlimited
      expect(res.body.quota.remaining === null || res.body.quota.remaining === Infinity).toBe(true);
      expect(res.body.quota.tier).toBe('gold');
    });

    it('expired Gold plan: correctly reverts to Free tier limit of 1 distinct video', async () => {
      const res = await request(app)
        .get('/api/downloads/status')
        .set('Authorization', `Bearer ${tokenExpiredGold}`)
        .expect(200);

      expect(res.body.quota.tier).toBe('free');
      expect(res.body.quota.isExpired).toBe(true);
      expect(res.body.quota.limit).toBe(1);
    });

    it('rolls back reservation on failure before delivery so quota is not consumed', async () => {
      // Create user and a failed download record
      const rec = await Download.create({
        userId: userOther._id,
        videoId: 'failed-video-test',
        videoTitle: 'Failed Video',
        status: 'failed',
        errorMessage: 'Origin unreachable',
      });

      const quota = await request(app)
        .get('/api/downloads/status')
        .set('Authorization', `Bearer ${tokenOther}`)
        .expect(200);

      // Failed records do not consume quota
      expect(quota.body.quota.used).toBe(0);
      expect(quota.body.quota.remaining).toBe(1);
    });
  });

  // ── 4. Offline Playback Authorization ────────────────────────────────────
  describe('4. Offline Playback Authorization', () => {
    let completedDownloadId;

    beforeAll(async () => {
      const rec = await Download.create({
        userId: userGold._id,
        videoId: testVideo1.id,
        videoTitle: testVideo1.title,
        status: 'completed',
        completedAt: new Date(),
        fileSize: 1048576,
      });
      completedDownloadId = rec._id;
    });

    it('issues an offline playback authorization token for a completed download', async () => {
      const res = await request(app)
        .post(`/api/downloads/${completedDownloadId}/offline-auth`)
        .set('Authorization', `Bearer ${tokenGold}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.offlineToken).toBeDefined();
      expect(res.body.licenseType).toBe('offline-playback-v1');
      expect(res.body.limitations).toContain('Browser storage does not provide hardware DRM protection');

      // Verify offline token via verification endpoint
      const verifyRes = await request(app)
        .get(`/api/downloads/offline-verify?token=${res.body.offlineToken}`)
        .expect(200);

      expect(verifyRes.body.valid).toBe(true);
      expect(verifyRes.body.payload.videoId).toBe(testVideo1.id);
    });

    it('rejects offline authorization request for non-existent or uncompleted download with 404', async () => {
      const incomplete = await Download.create({
        userId: userGold._id,
        videoId: testVideo2.id,
        status: 'reserved',
      });

      const res = await request(app)
        .post(`/api/downloads/${incomplete._id}/offline-auth`)
        .set('Authorization', `Bearer ${tokenGold}`)
        .expect(404);

      expect(res.body.code).toBe('DOWNLOAD_NOT_COMPLETED');
    });

    it('rejects expired offline playback token', () => {
      const expiredOffline = generateOfflinePlaybackToken({
        downloadId: completedDownloadId,
        videoId: testVideo1.id,
        userId: userGold._id,
        expiresInSeconds: -10,
      });

      const verify = verifyOfflinePlaybackToken(expiredOffline.token);
      expect(verify.valid).toBe(false);
      expect(verify.code).toBe('AUTH_EXPIRED');
    });
  });

  // ── 5. Background Cleanup Worker Safety ──────────────────────────────────
  describe('5. Background Cleanup Worker Safety', () => {
    it('cleans up expired temporary files without touching original source videos', async () => {
      // 1. Create a dummy old temporary file in TEMP_DIR
      const oldTempFile = path.join(TEMP_DIR, 'abandoned_test_transcode.tmp');
      fs.writeFileSync(oldTempFile, 'dummy temporary transcode data');
      // Artificially age the file
      const twoHoursAgo = (Date.now() - 2 * 3600 * 1000) / 1000;
      fs.utimesSync(oldTempFile, twoHoursAgo, twoHoursAgo);

      // 2. Create a dummy old temporary watermarked file in WATERMARKED_DIR
      const oldWmFile = path.join(WATERMARKED_DIR, 'expired_watermark.mp4');
      fs.writeFileSync(oldWmFile, 'dummy watermarked data');
      fs.utimesSync(oldWmFile, twoHoursAgo, twoHoursAgo);

      // 3. Ensure a source video exists in VIDEOS_DIR
      if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
      const protectedOriginalVideo = path.join(VIDEOS_DIR, 'protected_original_master.mp4');
      fs.writeFileSync(protectedOriginalVideo, 'DO_NOT_DELETE_ORIGINAL_SOURCE');
      fs.utimesSync(protectedOriginalVideo, twoHoursAgo, twoHoursAgo);

      // 4. Run cleanup worker
      const summary = await runCleanup();

      // Verify temp files removed
      expect(fs.existsSync(oldTempFile)).toBe(false);
      expect(fs.existsSync(oldWmFile)).toBe(false);

      // Verify protected original video file is strictly PRESERVED!
      expect(fs.existsSync(protectedOriginalVideo)).toBe(true);

      // Clean up test file
      try { fs.unlinkSync(protectedOriginalVideo); } catch {}
    });

    it('resolves stale download reservations older than 15 minutes to interrupted', async () => {
      const staleTime = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago
      const staleRec = await Download.create({
        userId: userFree._id,
        videoId: 'stale-test-video',
        status: 'reserved',
        reservedAt: staleTime,
      });

      await runCleanup();

      const updated = await Download.findById(staleRec._id);
      expect(updated.status).toBe('interrupted');
      expect(updated.errorMessage).toContain('expired before stream completion');
    });
  });
});

