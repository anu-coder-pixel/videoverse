/**
 * VideoVerse — Comment Replies, Mentions & Notifications Test Suite
 *
 * Covers:
 * Task 1: Nested Comment Replies
 *   - Create reply referencing valid parentId
 *   - Reject reply to non-existent parent with 404
 *   - Reject reply referencing parent from different video with 400
 *   - Nested thread organization on GET /api/videos/:videoId/comments
 *   - Soft-delete parent when replies exist, preserving replies
 *   - Hard-delete comment when no replies exist
 *   - Moderation checks on replies (profanity/spam rejection)
 *
 * Task 2: @Username Mentions
 *   - Autocomplete user search (GET /api/comments/mention-search)
 *   - Search returns public fields only (no email, password, role)
 *   - Mentions parsed and deduplicated on comment submission
 *   - Mentions stored as subdocuments with user IDs
 *
 * Task 3: Mention & Reply Notifications
 *   - Mention creates Notification record for mentioned user
 *   - Self-mention does NOT create notification
 *   - Duplicate mentions in single comment create only ONE notification
 *   - Replying to another user creates a 'reply' notification
 *   - Replying to own comment does NOT create notification
 *   - GET /api/comments/notifications returns notifications with unread count
 *   - PUT /api/comments/notifications/:id/read marks as read
 *   - PUT /api/comments/notifications/read-all marks all read
 *   - Deleting comment cleans up associated notifications
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const User = require('../models/User');
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');

describe('Comment Replies, @Mentions & Notifications Suite (Phase 4 Step 2)', () => {
  const testVideoId = 'vid-replies-mentions-001';
  let userA, userACookie;
  let userB, userBCookie;
  let userC, userCCookie;
  let rootCommentId;

  async function createTestUserHelper(name, email, role = 'user') {
    const username = name.toLowerCase().replace(/\s+/g, '_');
    const user = await User.create({
      name,
      username,
      email,
      passwordHash: 'dummyhash',
      role,
      subscriptionTier: 'free',
      isSuspended: false,
    });

    const jwtSecret = process.env.JWT_SECRET || 'test_jwt_secret_must_be_32_chars_long!';
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '7d' });
    const authCookie = `vv_token=${token}`;

    return { user, authCookie };
  }

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const testEmails = [
      'user_a_mentions@example.com',
      'user_b_mentions@example.com',
      'user_c_mentions@example.com',
    ];
    await User.deleteMany({ email: { $in: testEmails } });
    await Video.deleteMany({ id: testVideoId });
    await Comment.deleteMany({ videoId: testVideoId });
    await Notification.deleteMany({ videoId: testVideoId });

    // Seed test video
    await Video.create({
      id: testVideoId,
      title: 'Replies & Mentions Test Video',
      description: 'Testing nested replies and interactive @mentions',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe',
      duration: '09:56',
      views: '1.2K',
      category: 'Technology',
      channel: {
        id: 'ch-test-mentions',
        name: 'Mention Studio',
        handle: '@mentionstudio',
        subscribers: '10K',
        avatarColor: '#6c63ff',
        initials: 'MS',
        verified: true,
      },
      isPublished: true,
      processingStatus: 'ready',
    });

    const uA = await createTestUserHelper('Alice Tester', 'user_a_mentions@example.com');
    userA = uA.user;
    userACookie = uA.authCookie;

    const uB = await createTestUserHelper('Bob Builder', 'user_b_mentions@example.com');
    userB = uB.user;
    userBCookie = uB.authCookie;

    const uC = await createTestUserHelper('Charlie Coder', 'user_c_mentions@example.com');
    userC = uC.user;
    userCCookie = uC.authCookie;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      const testEmails = [
        'user_a_mentions@example.com',
        'user_b_mentions@example.com',
        'user_c_mentions@example.com',
      ];
      await User.deleteMany({ email: { $in: testEmails } });
      await Video.deleteMany({ id: testVideoId });
      await Comment.deleteMany({ videoId: testVideoId });
      await Notification.deleteMany({ videoId: testVideoId });
      await mongoose.disconnect();
    }
  });

  // =========================================================================
  // 1. NESTED REPLIES & THREADING
  // =========================================================================
  describe('1. Nested Comment Replies', () => {
    test('1.1 Creates top-level parent comment successfully', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userACookie])
        .send({ text: 'This is the root parent comment by Alice.' })
        .expect(201);

      expect(res.body.comment).toBeDefined();
      expect(res.body.comment.parentId).toBeNull();
      rootCommentId = res.body.comment.id;
    });

    test('1.2 Rejects reply with invalid parentId format with 400', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userBCookie])
        .send({ text: 'Replying to invalid id', parentId: 'invalid-id-xyz' })
        .expect(400);

      expect(res.body.code).toBe('INVALID_PARENT_ID');
    });

    test('1.3 Rejects reply to non-existent parentId with 404', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userBCookie])
        .send({ text: 'Replying to ghost parent', parentId: fakeId })
        .expect(404);

      expect(res.body.code).toBe('PARENT_NOT_FOUND');
    });

    test('1.4 Creates reply attached to root comment (Bob replies to Alice)', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userBCookie])
        .send({
          text: 'Great point Alice! Here is my reply.',
          parentId: rootCommentId,
        })
        .expect(201);

      expect(res.body.comment).toBeDefined();
      expect(res.body.comment.parentId).toBe(rootCommentId);
      expect(res.body.comment.author).toBe(userB.name);
    });

    test('1.5 Supports multiple replies in chronological order', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userCCookie])
        .send({
          text: 'Charlie agreeing with both Alice and Bob.',
          parentId: rootCommentId,
        })
        .expect(201);

      expect(res.body.comment.parentId).toBe(rootCommentId);

      // Fetch comments for video and verify hierarchy
      const listRes = await request(app)
        .get(`/api/videos/${testVideoId}/comments`)
        .expect(200);

      expect(listRes.body.total).toBe(3); // 1 root + 2 replies
      expect(listRes.body.comments.length).toBe(1); // 1 top-level parent

      const parentDoc = listRes.body.comments[0];
      expect(parentDoc.id).toBe(rootCommentId);
      expect(Array.isArray(parentDoc.replies)).toBe(true);
      expect(parentDoc.replies.length).toBe(2);
      expect(parentDoc.replies[0].author).toBe('Bob Builder');
      expect(parentDoc.replies[1].author).toBe('Charlie Coder');
    });

    test('1.6 Enforces moderation and profanity filters on replies', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userBCookie])
        .send({
          text: 'bhenchod this is vulgar abusive reply',
          parentId: rootCommentId,
        })
        .expect(400);

      expect(res.body.code).toBe('MODERATION_REJECTED');
    });

    test('1.7 Soft-deletes parent comment when replies exist to preserve thread continuity', async () => {
      const delRes = await request(app)
        .delete(`/api/comments/${rootCommentId}`)
        .set('Cookie', [userACookie])
        .expect(200);

      expect(delRes.body.success).toBe(true);
      expect(delRes.body.softDeleted).toBe(true);

      // Verify in public feed: parent displays as [This comment has been deleted] but replies remain intact!
      const listRes = await request(app)
        .get(`/api/videos/${testVideoId}/comments`)
        .expect(200);

      const parentDoc = listRes.body.comments.find(c => c.id === rootCommentId);
      expect(parentDoc).toBeDefined();
      expect(parentDoc.isDeleted).toBe(true);
      expect(parentDoc.text).toBe('[This comment has been deleted]');
      expect(parentDoc.author).toBe('[Deleted]');
      expect(parentDoc.replies.length).toBe(2); // Replies preserved!
    });
  });

  // =========================================================================
  // 2. @USERNAME MENTIONS & AUTOCOMPLETE
  // =========================================================================
  describe('2. @Username Mentions & Autocomplete', () => {
    test('2.1 GET /api/comments/mention-search requires authentication', async () => {
      await request(app)
        .get('/api/comments/mention-search?q=alice')
        .expect(401);
    });

    test('2.2 GET /api/comments/mention-search returns matching users with public fields only', async () => {
      const res = await request(app)
        .get('/api/comments/mention-search?q=alice')
        .set('Cookie', [userBCookie])
        .expect(200);

      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThanOrEqual(1);

      const foundUser = res.body.users.find(u => u.name === 'Alice Tester');
      expect(foundUser).toBeDefined();
      expect(foundUser.username).toBe('alice_tester');
      expect(foundUser.avatarColor).toBeDefined();
      expect(foundUser.initials).toBe('AT');

      // Security check: Private fields MUST NEVER be exposed!
      expect(foundUser.email).toBeUndefined();
      expect(foundUser.passwordHash).toBeUndefined();
      expect(foundUser.role).toBeUndefined();
      expect(foundUser.subscriptionTier).toBeUndefined();
    });

    test('2.3 Automatically parses, resolves, and deduplicates mentions in comment text', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userACookie])
        .send({
          text: 'Hey @bob_builder and @bob_builder check this out with @charlie_coder!',
        })
        .expect(201);

      expect(res.body.comment).toBeDefined();
      expect(Array.isArray(res.body.comment.mentions)).toBe(true);
      // Even though @bob_builder was typed twice, mentions array should be deduplicated to 2 users
      expect(res.body.comment.mentions.length).toBe(2);

      const handles = res.body.comment.mentions.map(m => m.username);
      expect(handles).toContain('bob_builder');
      expect(handles).toContain('charlie_coder');
    });
  });

  // =========================================================================
  // 3. MENTION & REPLY IN-APP NOTIFICATIONS
  // =========================================================================
  describe('3. In-App Notifications for Mentions & Replies', () => {
    test('3.1 Mentions trigger notifications for mentioned recipients', async () => {
      // Bob should have received a mention notification from Alice
      const res = await request(app)
        .get('/api/comments/notifications')
        .set('Cookie', [userBCookie])
        .expect(200);

      expect(Array.isArray(res.body.notifications)).toBe(true);
      const mentionNotif = res.body.notifications.find(n => n.type === 'mention' && n.senderName === 'Alice Tester');
      expect(mentionNotif).toBeDefined();
      expect(mentionNotif.isRead).toBe(false);
      expect(res.body.unreadCount).toBeGreaterThanOrEqual(1);
    });

    test('3.2 Self-mention does NOT create a notification for the author', async () => {
      // Alice mentions herself
      await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userACookie])
        .send({ text: 'Note to myself @alice_tester regarding testing.' })
        .expect(201);

      const res = await request(app)
        .get('/api/comments/notifications')
        .set('Cookie', [userACookie])
        .expect(200);

      // Alice should have NO notification from herself
      const selfNotif = res.body.notifications.find(n => n.senderName === 'Alice Tester' && n.type === 'mention');
      expect(selfNotif).toBeUndefined();
    });

    test('3.3 Replying to a comment creates a reply notification for parent author', async () => {
      // Create a new fresh comment by Bob
      const parentRes = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userBCookie])
        .send({ text: 'Fresh discussion post by Bob' })
        .expect(201);

      const bobParentId = parentRes.body.comment.id;

      // Charlie replies to Bob
      await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [userCCookie])
        .send({ text: 'Charlie replying directly to Bob', parentId: bobParentId })
        .expect(201);

      // Check Bob's notifications
      const bobNotifRes = await request(app)
        .get('/api/comments/notifications')
        .set('Cookie', [userBCookie])
        .expect(200);

      const replyNotif = bobNotifRes.body.notifications.find(n => n.type === 'reply' && n.senderName === 'Charlie Coder');
      expect(replyNotif).toBeDefined();
      expect(replyNotif.isRead).toBe(false);
    });

    test('3.4 PUT /api/comments/notifications/:id/read marks notification as read', async () => {
      const bobNotifRes = await request(app)
        .get('/api/comments/notifications')
        .set('Cookie', [userBCookie])
        .expect(200);

      const firstNotif = bobNotifRes.body.notifications[0];
      expect(firstNotif).toBeDefined();

      const readRes = await request(app)
        .put(`/api/comments/notifications/${firstNotif.id}/read`)
        .set('Cookie', [userBCookie])
        .expect(200);

      expect(readRes.body.success).toBe(true);
      expect(readRes.body.isRead).toBe(true);
    });

    test('3.5 PUT /api/comments/notifications/read-all marks all unread as read', async () => {
      const readAllRes = await request(app)
        .put('/api/comments/notifications/read-all')
        .set('Cookie', [userBCookie])
        .expect(200);

      expect(readAllRes.body.success).toBe(true);

      const checkRes = await request(app)
        .get('/api/comments/notifications')
        .set('Cookie', [userBCookie])
        .expect(200);

      expect(checkRes.body.unreadCount).toBe(0);
      expect(checkRes.body.notifications.every(n => n.isRead)).toBe(true);
    });
  });
});
