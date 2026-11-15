// Video Upload & Processing Pipeline Test Suite (Phase 5 - Module 4)
// Tests: Validation, Authorization, Magic Bytes, Chunk Ordering, Duplicates,
// Interruption/Cancellation, Cleanup, End-to-End Processing, and Streaming.

const path = require('path');
const dns = require('dns');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const { app } = require('../index');

const User = require('../models/User');
const Video = require('../models/Video');
const UploadSession = require('../models/UploadSession');
const TrustedDevice = require('../models/TrustedDevice');
const { cleanupAbandonedUploads } = require('../utils/uploadCleanup');

async function createTestUser(name, email) {
  const password = 'TestPass123!';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const user = new User({
    name,
    email,
    passwordHash,
    subscriptionTier: 'free',
    role: 'user',
  });
  await user.save();

  const rawDeviceToken = crypto.randomBytes(32).toString('hex');
  const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
  await TrustedDevice.create({
    userId: user._id,
    deviceTokenHash,
    deviceName: `${name} Device`,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .set('Cookie', [`vv_device_token=${rawDeviceToken}`])
    .send({ email, password });

  const cookie = loginRes.headers['set-cookie'].find(c => c.startsWith('vv_token=')).split(';')[0];
  return { user, cookie };
}

// Generate valid synthetic MP4 header chunk (ftypisom)
function createValidMp4Chunk(size = 1024) {
  const buf = Buffer.alloc(size);
  // Box size: 24 bytes
  buf.writeUInt32BE(24, 0);
  // Major brand: ftyp
  buf.write('ftyp', 4, 'ascii');
  // Brand: isom
  buf.write('isom', 8, 'ascii');
  buf.writeUInt32BE(512, 12); // minor version
  buf.write('isomiso2mp41', 16, 'ascii');
  return buf;
}

// Generate valid synthetic WebM header chunk
function createValidWebmChunk(size = 1024) {
  const buf = Buffer.alloc(size);
  // EBML Header ID 0x1A45DFA3
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  // Size + 'webm' DocType snippet
  buf.write('webm', 8, 'latin1');
  return buf;
}

describe('Video Upload & Processing Pipeline Suite', () => {
  let creatorUser;
  let otherUser;
  let creatorCookie;
  let otherCookie;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const testEmails = ['uploader1@example.com', 'uploader2@example.com'];
    await User.deleteMany({ email: { $in: testEmails } });
    await UploadSession.deleteMany({ title: /Upload Test/i });
    await Video.deleteMany({ title: /Upload Test/i });

    const u1 = await createTestUser('Upload Creator', 'uploader1@example.com');
    creatorUser = u1.user;
    creatorCookie = u1.cookie;

    const u2 = await createTestUser('Other Creator', 'uploader2@example.com');
    otherUser = u2.user;
    otherCookie = u2.cookie;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      const testEmails = ['uploader1@example.com', 'uploader2@example.com'];
      await User.deleteMany({ email: { $in: testEmails } });
      await UploadSession.deleteMany({ title: /Upload Test/i });
      await Video.deleteMany({ title: /Upload Test/i });
      await cleanupAbandonedUploads();
      await mongoose.disconnect();
    }
  });

  // =========================================================================
  // 1. Validation & Authorization on Session Initialization
  // =========================================================================
  describe('Session Initialization (POST /api/upload/init)', () => {
    test('Rejects unauthenticated request with HTTP 401', async () => {
      await request(app)
        .post('/api/upload/init')
        .send({ title: 'Unauthorized Video' })
        .expect(401);
    });

    test('Rejects missing or empty title with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: '   ',
          category: 'Technology',
          fileSize: 1024,
          mimeType: 'video/mp4',
          totalChunks: 1,
          chunkSize: 1024,
        })
        .expect(400);

      expect(res.body.error).toMatch(/title is required/i);
    });

    test('Rejects title exceeding 200 characters with HTTP 400', async () => {
      const longTitle = 'a'.repeat(201);
      const res = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: longTitle,
          category: 'Technology',
          fileSize: 1024,
          mimeType: 'video/mp4',
          totalChunks: 1,
          chunkSize: 1024,
        })
        .expect(400);

      expect(res.body.error).toMatch(/cannot exceed 200 characters/i);
    });

    test('Rejects file size exceeding 500 MB maximum limit with HTTP 400', async () => {
      const over500Mb = 500 * 1024 * 1024 + 1; // 524,288,001 bytes
      const res = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test Huge Video',
          category: 'Technology',
          fileSize: over500Mb,
          mimeType: 'video/mp4',
          totalChunks: 100,
          chunkSize: 5 * 1024 * 1024,
        })
        .expect(400);

      expect(res.body.code).toBe('FILE_TOO_LARGE');
      expect(res.body.error).toMatch(/500 MB maximum upload limit/i);
    });

    test('Rejects unsupported MIME formats (e.g. video/avi, image/png) with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test AVI',
          category: 'Technology',
          fileSize: 2048,
          mimeType: 'video/x-msvideo',
          totalChunks: 1,
          chunkSize: 2048,
        })
        .expect(400);

      expect(res.body.code).toBe('UNSUPPORTED_FORMAT');
    });

    test('Initializes valid MP4 session and pre-creates uploading Video record', async () => {
      const res = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test Valid MP4',
          description: 'Testing chunked upload initialization',
          category: 'Education',
          tags: ['React', 'NodeJS'],
          fileName: 'course_intro.mp4',
          fileSize: 2048,
          mimeType: 'video/mp4',
          totalChunks: 2,
          chunkSize: 1024,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.uploadId).toBeDefined();
      expect(res.body.videoId).toBeDefined();
      expect(res.body.status).toBe('uploading');

      // Verify Video document was created in DB with 'uploading' status
      const video = await Video.findOne({ id: res.body.videoId });
      expect(video).toBeDefined();
      expect(video.processingStatus).toBe('uploading');
      expect(video.uploaderId.toString()).toBe(creatorUser._id.toString());
      expect(video.channel.name).toBe(creatorUser.name);
    });
  });

  // =========================================================================
  // 2. Chunk Magic Bytes & Signature Validation
  // =========================================================================
  describe('File Signature & Magic Bytes Validation', () => {
    let uploadId;

    beforeEach(async () => {
      const initRes = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test Signature Check',
          category: 'Gaming',
          fileSize: 2048,
          mimeType: 'video/mp4',
          totalChunks: 2,
          chunkSize: 1024,
        });
      uploadId = initRes.body.uploadId;
    });

    test('Rejects chunk 0 containing invalid/malicious non-video bytes with HTTP 400', async () => {
      const maliciousBuffer = Buffer.from('<?php echo "HACKED"; ?> MALICIOUS_TEXT_PAYLOAD_NOT_A_VIDEO');

      const res = await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(maliciousBuffer)
        .expect(400);

      expect(res.body.code).toBe('INVALID_FILE_SIGNATURE');
      expect(res.body.error).toMatch(/signature mismatch/i);

      // Verify session was marked as failed
      const session = await UploadSession.findOne({ uploadId });
      expect(session.status).toBe('failed');
    });

    test('Accepts chunk 0 containing valid MP4 magic bytes', async () => {
      const validMp4Chunk = createValidMp4Chunk(1024);

      const res = await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(validMp4Chunk)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.uploadedChunks).toContain(0);
    });

    test('Accepts WebM signature for video/webm upload session', async () => {
      const webmInit = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test WebM',
          category: 'Gaming',
          fileSize: 1024,
          mimeType: 'video/webm',
          totalChunks: 1,
          chunkSize: 1024,
        });

      const webmUploadId = webmInit.body.uploadId;
      const validWebmChunk = createValidWebmChunk(1024);

      const res = await request(app)
        .put(`/api/upload/${webmUploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(validWebmChunk)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 3. Chunk Ordering, Duplicates, and Resumability
  // =========================================================================
  describe('Chunk Ordering, Duplicates & Resumability', () => {
    let uploadId;

    beforeEach(async () => {
      const initRes = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test Chunking Logic',
          category: 'Technology',
          fileSize: 3072,
          mimeType: 'video/mp4',
          totalChunks: 3,
          chunkSize: 1024,
        });
      uploadId = initRes.body.uploadId;
    });

    test('Rejects chunk upload from a different unauthorized user with HTTP 403', async () => {
      const chunk = createValidMp4Chunk(1024);
      await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [otherCookie]) // other user
        .set('Content-Type', 'application/octet-stream')
        .send(chunk)
        .expect(403);
    });

    test('Rejects chunk index exceeding totalChunks with HTTP 400', async () => {
      const chunk = createValidMp4Chunk(1024);
      const res = await request(app)
        .put(`/api/upload/${uploadId}/chunk/99`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk)
        .expect(400);

      expect(res.body.error).toMatch(/exceeds totalChunks/i);
    });

    test('Handles duplicate chunk uploads idempotently without corrupting uploadedChunks', async () => {
      const chunk0 = createValidMp4Chunk(1024);

      // Upload chunk 0 first time
      await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk0)
        .expect(200);

      // Upload chunk 0 second time (simulating network retry)
      const res2 = await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk0)
        .expect(200);

      expect(res2.body.uploadedChunks).toEqual([0]);
      const occurrences = res2.body.uploadedChunks.filter(c => c === 0).length;
      expect(occurrences).toBe(1);
    });

    test('GET /api/upload/:uploadId/status returns accurate progress for resumption', async () => {
      const chunk0 = createValidMp4Chunk(1024);
      await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk0);

      const statusRes = await request(app)
        .get(`/api/upload/${uploadId}/status`)
        .set('Cookie', [creatorCookie])
        .expect(200);

      expect(statusRes.body.uploadId).toBe(uploadId);
      expect(statusRes.body.uploadedChunks).toContain(0);
      expect(statusRes.body.totalChunks).toBe(3);
      expect(statusRes.body.status).toBe('uploading');
    });
  });

  // =========================================================================
  // 4. Interrupted Upload Cancellation & Storage Cleanup
  // =========================================================================
  describe('Cancellation & Cleanup', () => {
    test('DELETE /api/upload/:uploadId removes temp chunks and marks session abandoned', async () => {
      const initRes = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test Abandonment',
          category: 'Technology',
          fileSize: 2048,
          mimeType: 'video/mp4',
          totalChunks: 2,
          chunkSize: 1024,
        });

      const uploadId = initRes.body.uploadId;
      const chunk0 = createValidMp4Chunk(1024);
      await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk0);

      // Cancel session
      const cancelRes = await request(app)
        .delete(`/api/upload/${uploadId}`)
        .set('Cookie', [creatorCookie])
        .expect(200);

      expect(cancelRes.body.success).toBe(true);

      const session = await UploadSession.findOne({ uploadId });
      expect(session.status).toBe('abandoned');

      // Further chunk uploads must be rejected
      await request(app)
        .put(`/api/upload/${uploadId}/chunk/1`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk0)
        .expect(400);
    });

    test('Abandoned cleanup routine cleans expired sessions safely', async () => {
      const result = await cleanupAbandonedUploads();
      expect(result).toBeDefined();
      expect(typeof result.cleanedCount).toBe('number');
    });
  });

  // =========================================================================
  // 5. Complete Chunked Upload & End-to-End Processing
  // =========================================================================
  describe('End-to-End Upload, Processing & Streaming', () => {
    test('Uploads all chunks, triggers processing, and serves video via Range 206', async () => {
      const totalSize = 2048;
      const chunkSize = 1024;

      const initRes = await request(app)
        .post('/api/upload/init')
        .set('Cookie', [creatorCookie])
        .send({
          title: 'Upload Test Full End to End',
          description: 'Complete video processing test',
          category: 'Education',
          tags: ['FullStack', 'Testing'],
          fileName: 'e2e_video.mp4',
          fileSize: totalSize,
          mimeType: 'video/mp4',
          totalChunks: 2,
          chunkSize: chunkSize,
        })
        .expect(201);

      const { uploadId, videoId } = initRes.body;

      // Upload Chunk 0 (Header with MP4 magic bytes)
      const chunk0 = createValidMp4Chunk(chunkSize);
      await request(app)
        .put(`/api/upload/${uploadId}/chunk/0`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk0)
        .expect(200);

      // Upload Chunk 1 (Final chunk -> triggers assembly & async processing)
      const chunk1 = Buffer.alloc(chunkSize, 'A');
      const finalRes = await request(app)
        .put(`/api/upload/${uploadId}/chunk/1`)
        .set('Cookie', [creatorCookie])
        .set('Content-Type', 'application/octet-stream')
        .send(chunk1)
        .expect(200);

      expect(finalRes.body.status).toBe('processing');

      // Poll until processing transitions to ready (timeout: 10s)
      let videoReady = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        const checkRes = await request(app)
          .get(`/api/upload/${uploadId}/status`)
          .set('Cookie', [creatorCookie]);

        if (checkRes.body.processingStatus === 'ready') {
          videoReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      expect(videoReady).toBe(true);

      // Verify Video Document
      const videoDoc = await Video.findOne({ id: videoId });
      expect(videoDoc).toBeDefined();
      expect(videoDoc.processingStatus).toBe('ready');
      expect(videoDoc.processingProgress).toBe(100);
      expect(videoDoc.thumbnailUrl).toBeDefined();
      expect(videoDoc.duration).toBeDefined();

      // Verify it appears in creator's videos list
      const creatorVideosRes = await request(app)
        .get('/api/upload/my/videos')
        .set('Cookie', [creatorCookie])
        .expect(200);

      expect(creatorVideosRes.body.videos.some(v => v.id === videoId)).toBe(true);

      // Verify it appears in public catalog feed
      const publicVideosRes = await request(app)
        .get('/api/videos')
        .expect(200);

      expect(publicVideosRes.body.videos.some(v => v.id === videoId)).toBe(true);

      // Verify Local Video Streaming with Range 206
      const streamRes = await request(app)
        .get(`/api/videos/${videoId}/stream`)
        .set('Range', 'bytes=0-511')
        .expect(206);

      expect(streamRes.headers['content-range']).toMatch(/^bytes 0-511\/2048/);
      expect(streamRes.headers['content-length']).toBe('512');
    });
  });
});

