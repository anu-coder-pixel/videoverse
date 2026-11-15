// Social features test suite for VideoVerse
// Tests Comments, Likes/Dislikes, Watch Later, Subscriptions, Watch History, Guest Merge, and Translation Caching

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
const { app } = require('../index');

const User = require('../models/User');
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const TrustedDevice = require('../models/TrustedDevice');

async function createTestUserRecord(name, email, role = 'user') {
  const password = 'TestPass123!';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const user = new User({
    name,
    email,
    passwordHash,
    subscriptionTier: 'free',
    role,
    likedVideos: [],
    dislikedVideos: [],
    watchLater: [],
    watchHistory: [],
    subscribedChannels: [],
  });
  await user.save();

  const rawDeviceToken = crypto.randomBytes(32).toString('hex');
  const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
  await TrustedDevice.create({
    userId: user._id,
    deviceTokenHash,
    deviceName: `${name} Trusted Device`,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return { user, password, rawDeviceToken };
}

describe('Social Features Integration & Security Suite', () => {
  let regularUser;
  let adminUser;
  let otherUser;
  let authCookie;
  let adminAuthCookie;
  let otherAuthCookie;

  const testVideoId = 'vid-social-test-01';

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    // Clean up test collections
    const testEmails = [
      'socialuser@example.com',
      'socialadmin@example.com',
      'otheruser@example.com',
      'guestmerge@example.com',
    ];
    await User.deleteMany({ email: { $in: testEmails } });
    await TrustedDevice.deleteMany({
      deviceName: { $regex: /Trusted Device/i },
      userId: { $in: (await User.find({ email: { $in: testEmails } })).map(u => u._id) }
    });
    await Comment.deleteMany({ videoId: testVideoId });
    await Video.deleteMany({ id: testVideoId });

    // Seed test video
    await Video.create({
      id: testVideoId,
      title: 'Social Test Video',
      description: 'Testing social features in VideoVerse',
      thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration: '5:00',
      views: '1.2K',
      uploadedAt: '1 day ago',
      category: 'Education',
      channel: {
        id: 'ch-test-01',
        name: 'Test Channel',
        handle: '@testchannel',
        subscribers: '10K',
        avatarColor: '#6c63ff',
        initials: 'TC',
        verified: true,
      },
      likes: 10,
      dislikes: 1,
    });

    // Create users
    const u1 = await createTestUserRecord('Social User', 'socialuser@example.com', 'user');
    regularUser = u1.user;
    const login1 = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [`vv_device_token=${u1.rawDeviceToken}`])
      .send({ email: 'socialuser@example.com', password: u1.password });
    authCookie = login1.headers['set-cookie'].find(c => c.startsWith('vv_token=')).split(';')[0];

    const u2 = await createTestUserRecord('Social Admin', 'socialadmin@example.com', 'admin');
    adminUser = u2.user;
    const login2 = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [`vv_device_token=${u2.rawDeviceToken}`])
      .send({ email: 'socialadmin@example.com', password: u2.password });
    adminAuthCookie = login2.headers['set-cookie'].find(c => c.startsWith('vv_token=')).split(';')[0];

    const u3 = await createTestUserRecord('Other User', 'otheruser@example.com', 'user');
    otherUser = u3.user;
    const login3 = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [`vv_device_token=${u3.rawDeviceToken}`])
      .send({ email: 'otheruser@example.com', password: u3.password });
    otherAuthCookie = login3.headers['set-cookie'].find(c => c.startsWith('vv_token=')).split(';')[0];
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      const testEmails = [
        'socialuser@example.com',
        'socialadmin@example.com',
        'otheruser@example.com',
        'guestmerge@example.com',
      ];
      await User.deleteMany({ email: { $in: testEmails } });
      await Comment.deleteMany({ videoId: testVideoId });
      await Video.deleteMany({ id: testVideoId });
      await mongoose.disconnect();
    }
  });

  // =========================================================================
  // 1. Comments API (Auth, Validation, CRUD, Moderation)
  // =========================================================================
  describe('Comments API', () => {
    let createdCommentId;
    let hinglishCommentId;

    test('GET /api/videos/:videoId/comments returns 200 without authentication', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoId}/comments`)
        .expect(200);

      expect(res.body.comments).toBeDefined();
      expect(Array.isArray(res.body.comments)).toBe(true);
      expect(res.body.total).toBe(0);
    });

    test('POST /api/videos/:videoId/comments rejects unauthenticated user with 401', async () => {
      await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .send({ text: 'Unauthorized comment' })
        .expect(401);
    });

    test('POST /api/videos/:videoId/comments rejects empty or whitespace comment with 400', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [authCookie])
        .send({ text: '   ' })
        .expect(400);

      expect(res.body.error).toMatch(/cannot be empty/i);
    });

    test('POST /api/videos/:videoId/comments rejects comment exceeding 1000 characters with 400', async () => {
      const longText = 'a'.repeat(1001);
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [authCookie])
        .send({ text: longText })
        .expect(400);

      expect(res.body.error).toMatch(/exceed 1000 characters/i);
    });

    test('POST /api/videos/:videoId/comments rejects non-existent video with 404', async () => {
      await request(app)
        .post('/api/videos/non-existent-video-xyz/comments')
        .set('Cookie', [authCookie])
        .send({ text: 'Nice video!' })
        .expect(404);
    });

    test('POST /api/videos/:videoId/comments creates comment with session author identity', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [authCookie])
        .send({ text: 'This is a genuine approved comment!', author: 'Fake Hacker Name' })
        .expect(201);

      expect(res.body.flagged).toBe(false);
      expect(res.body.comment).toBeDefined();
      expect(res.body.comment.text).toBe('This is a genuine approved comment!');
      expect(res.body.comment.author).toBe(regularUser.name); // Ignores client-supplied name
      createdCommentId = res.body.comment.id;
    });

    test('POST /api/videos/:videoId/comments saves Hinglish comment for translation test', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [authCookie])
        .send({ text: 'bahut badhiya video' })
        .expect(201);

      expect(res.body.comment).toBeDefined();
      hinglishCommentId = res.body.comment.id;
    });

    test('PUT /api/comments/:commentId/like toggles comment like', async () => {
      const res = await request(app)
        .put(`/api/comments/${createdCommentId}/like`)
        .set('Cookie', [authCookie])
        .send({ action: 'like' })
        .expect(200);

      expect(res.body.liked).toBe(true);
      expect(res.body.likesCount).toBe(1);

      // Unlike
      const res2 = await request(app)
        .put(`/api/comments/${createdCommentId}/like`)
        .set('Cookie', [authCookie])
        .send({ action: 'unlike' })
        .expect(200);

      expect(res2.body.liked).toBe(false);
      expect(res2.body.likesCount).toBe(0);
    });

    test('PUT /api/comments/:commentId/dislike toggles comment dislike', async () => {
      const res = await request(app)
        .put(`/api/comments/${createdCommentId}/dislike`)
        .set('Cookie', [authCookie])
        .send({ action: 'dislike' })
        .expect(200);

      expect(res.body.disliked).toBe(true);
      expect(res.body.dislikesCount).toBe(1);
    });

    test('PUT /api/comments/:commentId rejects edit from non-author with 403', async () => {
      const res = await request(app)
        .put(`/api/comments/${createdCommentId}`)
        .set('Cookie', [otherAuthCookie])
        .send({ text: 'Hijacked edit' })
        .expect(403);

      expect(res.body.error).toMatch(/not authorized/i);
    });

    test('PUT /api/comments/:commentId allows author to edit comment', async () => {
      const res = await request(app)
        .put(`/api/comments/${createdCommentId}`)
        .set('Cookie', [authCookie])
        .send({ text: 'Updated comment text by original author' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.comment.text).toBe('Updated comment text by original author');
      expect(res.body.comment.isEdited).toBe(true);
    });

    test('DELETE /api/comments/:commentId rejects non-author non-admin with 403', async () => {
      const res = await request(app)
        .delete(`/api/comments/${createdCommentId}`)
        .set('Cookie', [otherAuthCookie])
        .expect(403);

      expect(res.body.error).toMatch(/not authorized/i);
    });

    test('DELETE /api/comments/:commentId allows admin to delete any comment', async () => {
      const res = await request(app)
        .delete(`/api/comments/${createdCommentId}`)
        .set('Cookie', [adminAuthCookie])
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.deletedCommentId).toBe(createdCommentId);
    });

    test('DELETE /api/comments/:commentId allows author to delete own comment', async () => {
      // Create a temporary comment by otherUser
      const postRes = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [otherAuthCookie])
        .send({ text: 'Temporary comment by other user' })
        .expect(201);

      const tempId = postRes.body.comment.id;

      const delRes = await request(app)
        .delete(`/api/comments/${tempId}`)
        .set('Cookie', [otherAuthCookie])
        .expect(200);

      expect(delRes.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 2. Video Likes & Dislikes (Mutual Exclusivity & Validation)
  // =========================================================================
  describe('Video Likes & Dislikes API', () => {
    test('PUT /api/auth/likes rejects invalid or missing videoId with 400', async () => {
      await request(app)
        .put('/api/auth/likes')
        .set('Cookie', [authCookie])
        .send({})
        .expect(400);

      await request(app)
        .put('/api/auth/likes')
        .set('Cookie', [authCookie])
        .send({ videoId: '   ' })
        .expect(400);
    });

    test('PUT /api/auth/dislikes rejects invalid or missing videoId with 400', async () => {
      await request(app)
        .put('/api/auth/dislikes')
        .set('Cookie', [authCookie])
        .send({})
        .expect(400);
    });

    test('PUT /api/auth/likes adds video to likes and removes from dislikes', async () => {
      // First dislike video
      await request(app)
        .put('/api/auth/dislikes')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId })
        .expect(200);

      // Now like video - should be in likes and removed from dislikes
      const res = await request(app)
        .put('/api/auth/likes')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId })
        .expect(200);

      expect(res.body.likedVideos).toContain(testVideoId);
      expect(res.body.dislikedVideos).not.toContain(testVideoId);
    });

    test('PUT /api/auth/dislikes adds video to dislikes and removes from likes', async () => {
      const res = await request(app)
        .put('/api/auth/dislikes')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId })
        .expect(200);

      expect(res.body.dislikedVideos).toContain(testVideoId);
      expect(res.body.likedVideos).not.toContain(testVideoId);
    });

    test('PUT /api/auth/likes toggles off like when clicked again', async () => {
      // Turn like on
      await request(app)
        .put('/api/auth/likes')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId });

      // Turn like off
      const res = await request(app)
        .put('/api/auth/likes')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId })
        .expect(200);

      expect(res.body.likedVideos).not.toContain(testVideoId);
    });
  });

  // =========================================================================
  // 3. Watch Later & Subscriptions
  // =========================================================================
  describe('Watch Later & Subscriptions API', () => {
    test('PUT /api/auth/watch-later rejects empty videoId with 400', async () => {
      await request(app)
        .put('/api/auth/watch-later')
        .set('Cookie', [authCookie])
        .send({ videoId: '' })
        .expect(400);
    });

    test('PUT /api/auth/watch-later toggles video in watch later list', async () => {
      // Add
      const res1 = await request(app)
        .put('/api/auth/watch-later')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId })
        .expect(200);

      expect(res1.body.watchLater).toContain(testVideoId);

      // Remove (toggle)
      const res2 = await request(app)
        .put('/api/auth/watch-later')
        .set('Cookie', [authCookie])
        .send({ videoId: testVideoId })
        .expect(200);

      expect(res2.body.watchLater).not.toContain(testVideoId);
    });

    test('PUT /api/auth/subscriptions rejects empty channelId with 400', async () => {
      await request(app)
        .put('/api/auth/subscriptions')
        .set('Cookie', [authCookie])
        .send({ channelId: '' })
        .expect(400);
    });

    test('PUT /api/auth/subscriptions toggles channel subscription', async () => {
      const channelId = 'ch-codecraft';
      // Subscribe
      const res1 = await request(app)
        .put('/api/auth/subscriptions')
        .set('Cookie', [authCookie])
        .send({ channelId })
        .expect(200);

      expect(res1.body.subscribedChannels).toContain(channelId);

      // Unsubscribe (toggle)
      const res2 = await request(app)
        .put('/api/auth/subscriptions')
        .set('Cookie', [authCookie])
        .send({ channelId })
        .expect(200);

      expect(res2.body.subscribedChannels).not.toContain(channelId);
    });
  });

  // =========================================================================
  // 4. Watch History API (Deduplication, Single Removal, Clear All)
  // =========================================================================
  describe('Watch History API', () => {
    test('POST /api/auth/history validates videoId', async () => {
      await request(app)
        .post('/api/auth/history')
        .set('Cookie', [authCookie])
        .send({})
        .expect(400);
    });

    test('POST /api/auth/history adds videos to front and deduplicates', async () => {
      await request(app)
        .post('/api/auth/history')
        .set('Cookie', [authCookie])
        .send({ videoId: 'vid-hist-1' })
        .expect(200);

      await request(app)
        .post('/api/auth/history')
        .set('Cookie', [authCookie])
        .send({ videoId: 'vid-hist-2' })
        .expect(200);

      // Re-add vid-hist-1: should move to index 0, not duplicate
      const res = await request(app)
        .post('/api/auth/history')
        .set('Cookie', [authCookie])
        .send({ videoId: 'vid-hist-1' })
        .expect(200);

      expect(res.body.watchHistory[0]).toBe('vid-hist-1');
      expect(res.body.watchHistory[1]).toBe('vid-hist-2');
      const occurrences = res.body.watchHistory.filter(id => id === 'vid-hist-1').length;
      expect(occurrences).toBe(1);
    });

    test('DELETE /api/auth/history/:videoId removes only specified video', async () => {
      const res = await request(app)
        .delete('/api/auth/history/vid-hist-1')
        .set('Cookie', [authCookie])
        .expect(200);

      expect(res.body.watchHistory).not.toContain('vid-hist-1');
      expect(res.body.watchHistory).toContain('vid-hist-2');
    });

    test('DELETE /api/auth/history clears entire watch history', async () => {
      const res = await request(app)
        .delete('/api/auth/history')
        .set('Cookie', [authCookie])
        .expect(200);

      expect(res.body.watchHistory).toEqual([]);
    });
  });

  // =========================================================================
  // 5. Guest Data Merging & Mutual Exclusivity
  // =========================================================================
  describe('Guest Data Merging', () => {
    test('Registration with guest data preserves mutual exclusivity of likes/dislikes', async () => {
      const guestData = {
        likedVideos: ['vid-merge-1', 'vid-merge-2'],
        dislikedVideos: ['vid-merge-2', 'vid-merge-3'], // vid-merge-2 is in both!
        watchLater: ['vid-merge-wl-1'],
        watchHistory: ['vid-merge-h-1', 'vid-merge-h-2'],
        subscribedChannels: ['ch-merge-1'],
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Guest Merger',
          email: 'guestmerge@example.com',
          password: 'Password123!',
          guestData,
        })
        .expect(201);

      expect(res.body.success).toBe(true);

      const user = await User.findOne({ email: 'guestmerge@example.com' });
      expect(user).toBeDefined();

      // vid-merge-2 must be in likedVideos, and MUST NOT be in dislikedVideos
      expect(user.likedVideos).toContain('vid-merge-1');
      expect(user.likedVideos).toContain('vid-merge-2');
      expect(user.dislikedVideos).not.toContain('vid-merge-2');
      expect(user.dislikedVideos).toContain('vid-merge-3');

      // Check others
      expect(user.watchLater).toContain('vid-merge-wl-1');
      expect(user.watchHistory).toContain('vid-merge-h-1');
      expect(user.subscribedChannels).toContain('ch-merge-1');
    });
  });

  // =========================================================================
  // 6. Multilingual Translation & In-Memory Caching
  // =========================================================================
  describe('Multilingual Translation & Caching', () => {
    let testCommentId;

    beforeAll(async () => {
      // Find the Hinglish comment created earlier
      const comment = await Comment.findOne({ videoId: testVideoId, text: 'bahut badhiya video' });
      testCommentId = comment ? comment._id.toString() : null;
    });

    test('GET /api/comments/:commentId/translate returns 400 on malformed commentId', async () => {
      await request(app)
        .get('/api/comments/not-a-valid-id/translate')
        .expect(400);
    });

    test('GET /api/comments/:commentId/translate returns alreadyTargetLanguage for English text', async () => {
      const engComment = await Comment.create({
        videoId: testVideoId,
        userId: regularUser._id,
        author: 'Tester',
        authorInitials: 'T',
        text: 'This is genuinely an English comment',
        language: 'en',
        moderationStatus: 'approved',
      });

      const res = await request(app)
        .get(`/api/comments/${engComment._id}/translate?target=en`)
        .expect(200);

      expect(res.body.alreadyTargetLanguage).toBe(true);
      expect(res.body.translated).toBe(false);
    });

    test('GET /api/comments/:commentId/translate translates Hinglish and caches result', async () => {
      expect(testCommentId).toBeDefined();

      // First call (uncached or populated)
      const res1 = await request(app)
        .get(`/api/comments/${testCommentId}/translate?target=en`)
        .expect(200);

      expect(res1.body.translated).toBe(true);
      expect(res1.body.translatedText).toMatch(/(very good|great) video/i);

      // Second call (must be served from in-memory cache)
      const res2 = await request(app)
        .get(`/api/comments/${testCommentId}/translate?target=en`)
        .expect(200);

      expect(res2.body.translated).toBe(true);
      expect(res2.body.cached).toBe(true);
      expect(res2.body.translatedText).toBe(res1.body.translatedText);
    });
  });
});
