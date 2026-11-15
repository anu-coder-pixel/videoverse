const request = require('supertest');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { app } = require('../index');
const Video = require('../models/Video');

/**
 * Path containment tests for video streaming endpoint.
 */
describe('Streaming Path Containment', () => {
  let validVideoId;
  const uploadsDir = path.resolve(__dirname, '..', 'uploads', 'videos');
  const dummyChannel = {
    id: 'ch-test',
    name: 'Test Channel',
    handle: '@test',
    subscribers: '1K',
    avatarColor: '#ff0000',
    initials: 'TC',
    verified: true,
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    // Ensure uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    // Create a valid dummy video file
    const validPath = path.join(uploadsDir, 'valid.mp4');
    fs.writeFileSync(validPath, Buffer.from('valid')); // dummy content
    const validVideo = new Video({
      id: 'test-valid-video',
      title: 'Valid Video',
      mimeType: 'video/mp4',
      storagePath: validPath,
      processingStatus: 'ready',
      category: 'All',
      channel: dummyChannel,
    });
    await validVideo.save();
    validVideoId = validVideo.id;
  });

  afterAll(async () => {
    await Video.deleteMany({ id: /test-*/ });
    // Cleanup any files created
    const files = fs.readdirSync(uploadsDir);
    for (const file of files) {
      if (file.startsWith('valid') || file.startsWith('evil')) {
        fs.unlinkSync(path.join(uploadsDir, file));
      }
    }
    await mongoose.disconnect();
  });

  test('valid video path succeeds', async () => {
    const res = await request(app).get(`/api/videos/${validVideoId}/stream`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/video\/mp4/);
  });

  test('sibling-prefix path (videos-evil) is rejected', async () => {
    // Construct a path that resolves to a sibling but appears as prefix
    const evilPath = path.resolve(__dirname, '..', 'uploads', 'videos-evil', 'evil.mp4');
    // Ensure directory exists and file
    const evilDir = path.dirname(evilPath);
    if (!fs.existsSync(evilDir)) fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(evilPath, Buffer.from('evil'));
    const evilVideo = new Video({
      id: 'test-evil-video',
      title: 'Evil Video',
      mimeType: 'video/mp4',
      storagePath: evilPath,
      processingStatus: 'ready',
      category: 'All',
      channel: dummyChannel,
    });
    await evilVideo.save();
    const res = await request(app).get(`/api/videos/${evilVideo.id}/stream`);
    expect(res.status).toBe(403);
    await Video.deleteOne({ id: evilVideo.id });
  });

  test('.. traversal path is rejected', async () => {
    const traversalPath = path.resolve(__dirname, '..', '..', 'outside.mp4');
    // Create dummy file outside uploads/videos
    fs.writeFileSync(traversalPath, Buffer.from('outside'));
    const travVideo = new Video({
      id: 'test-trav-video',
      title: 'Traversal Video',
      mimeType: 'video/mp4',
      storagePath: traversalPath,
      processingStatus: 'ready',
      category: 'All',
      channel: dummyChannel,
    });
    await travVideo.save();
    const res = await request(app).get(`/api/videos/${travVideo.id}/stream`);
    expect(res.status).toBe(403);
    await Video.deleteOne({ id: travVideo.id });
    fs.unlinkSync(traversalPath);
  });
});

