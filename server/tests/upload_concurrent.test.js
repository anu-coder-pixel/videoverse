// Jest test for concurrent chunk writes safety
const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { app } = require('../index'); // Express app
const User = require('../models/User');
const TrustedDevice = require('../models/TrustedDevice');
const UploadSession = require('../models/UploadSession');
const Video = require('../models/Video');

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

function createValidMp4Header(size = 1024) {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('isom', 8, 'ascii');
  buf.writeUInt32BE(512, 12);
  buf.write('isomiso2mp41', 16, 'ascii');
  return buf;
}

describe('Concurrent Chunk Write Safety', () => {
  let uploadId;
  let videoId;
  let testUser, testCookie;
  const chunkIndex = 0;
  const chunkData1 = createValidMp4Header(1024);
  const chunkData2 = Buffer.concat([chunkData1.slice(0, 32), Buffer.from('b'.repeat(1024 - 32))]);

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/videoverse_test';
      await mongoose.connect(uri);
    }

    const res = await createTestUser('Concurrent Tester', `concurrent_${Date.now()}@example.com`);
    testUser = res.user;
    testCookie = res.cookie;

    // Init upload session
    const initRes = await request(app)
      .post('/api/upload/init')
      .set('Cookie', testCookie)
      .send({
        title: 'Concurrent Test Video',
        category: 'Technology',
        fileName: 'test.mp4',
        fileSize: 3072,
        mimeType: 'video/mp4',
        totalChunks: 3,
        chunkSize: 1024,
      });

    uploadId = initRes.body.uploadId;
    videoId = initRes.body.videoId;
  }, 30000);

  afterAll(async () => {
    if (uploadId) await UploadSession.deleteMany({ uploadId });
    if (videoId) await Video.deleteMany({ id: videoId });
    if (testUser) {
      await User.deleteOne({ _id: testUser._id });
      await TrustedDevice.deleteMany({ userId: testUser._id });
    }
  });

  test('identical duplicate chunk is accepted without error', async () => {
    const res1 = await request(app)
      .put(`/api/upload/${uploadId}/chunk/${chunkIndex}`)
      .set('Cookie', testCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(chunkData1);
    expect(res1.status).toBe(200);

    // Send identical chunk again
    const res2 = await request(app)
      .put(`/api/upload/${uploadId}/chunk/${chunkIndex}`)
      .set('Cookie', testCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(chunkData1);
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
  }, 15000);

  test('different duplicate chunk leads to conflict', async () => {
    const idx = 1;
    const firstRes = await request(app)
      .put(`/api/upload/${uploadId}/chunk/${idx}`)
      .set('Cookie', testCookie)
      .set('Content-Type', 'application/octet-stream')
      .send(chunkData1);
    expect(firstRes.status).toBe(200);

    // Concurrent attempt with different data
    const [resA, resB] = await Promise.all([
      request(app)
        .put(`/api/upload/${uploadId}/chunk/${idx}`)
        .set('Cookie', testCookie)
        .set('Content-Type', 'application/octet-stream')
        .send(chunkData2),
      request(app)
        .put(`/api/upload/${uploadId}/chunk/${idx}`)
        .set('Cookie', testCookie)
        .set('Content-Type', 'application/octet-stream')
        .send(chunkData2),
    ]);

    // Both attempts should be rejected with 409 conflict since chunk 1 already exists with chunkData1
    expect(resA.status).toBe(409);
    expect(resB.status).toBe(409);
  }, 20000);
});
