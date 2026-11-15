/**
 * VideoVerse Phase 2, Step 1 — Content Safety & Comment Moderation Test Suite
 *
 * Covers:
 * 1. Profanity & Abusive Language Detection (English, Hinglish, Leetspeak)
 * 2. Repetitive & Spam Comment Detection (Emoji Floods, Word Repetition, Malicious Links)
 * 3. Duplicate Comment Prevention
 * 4. Comment Flooding & Mathematical CAPTCHA Challenge
 * 5. 15-Minute Author Edit/Delete Time Window Enforcement (Admin Exemption)
 * 6. User Comment Reporting with Predefined Reasons & Duplicate Report Blocking
 * 7. Admin Moderation Review Queue & Resolution ('approve', 'reject', 'delete')
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const User = require('../models/User');
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const CommentReport = require('../models/CommentReport');
const { generateCaptchaChallenge, verifyCaptchaChallenge, resetCommentFlood } = require('../utils/moderation');

describe('Phase 2, Step 1: Content Safety & Comment Moderation Suite', () => {
  let regularUser;
  let adminUser;
  let regularToken;
  let adminToken;
  const testVideoId = 'test-mod-video-01';

  beforeEach(() => {
    resetCommentFlood();
  });

  beforeAll(async () => {
    // Setup test users and test video
    await User.deleteMany({ email: { $in: ['mod_user@example.com', 'mod_admin@example.com'] } });
    await Video.deleteMany({ id: testVideoId });
    await Comment.deleteMany({ videoId: testVideoId });
    await CommentReport.deleteMany({ videoId: testVideoId });

    regularUser = await User.create({
      name: 'Regular Commenter',
      email: 'mod_user@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
      avatarColor: '#10b981',
      initials: 'RC',
    });

    adminUser = await User.create({
      name: 'Moderation Admin',
      email: 'mod_admin@example.com',
      passwordHash: 'dummyhash',
      role: 'admin',
      avatarColor: '#ef4444',
      initials: 'MA',
    });

    regularToken = jwt.sign({ id: regularUser._id }, process.env.JWT_SECRET || 'testsecret');
    adminToken = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'testsecret');

    await Video.create({
      id: testVideoId,
      title: 'Moderation Test Video',
      description: 'Test description',
      category: 'Education',
      channel: {
        id: 'ch-test-mod',
        name: 'Mod Channel',
        handle: '@modchannel',
        subscribers: '10K',
        avatarColor: '#6366f1',
        initials: 'MC',
        verified: true,
      },
    });
  });

  afterAll(async () => {
    await User.deleteMany({ email: { $in: ['mod_user@example.com', 'mod_admin@example.com'] } });
    await Video.deleteMany({ id: testVideoId });
    await Comment.deleteMany({ videoId: testVideoId });
    await CommentReport.deleteMany({ videoId: testVideoId });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. PROFANITY & ABUSIVE LANGUAGE DETECTION
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Profanity & Abusive Language Detection', () => {
    test('1.1 Rejects severe English profanities and slurs with 400', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'You are a fucking asshole, go die' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MODERATION_REJECTED');
      expect(res.body.error).toContain('community safety guidelines');
    });

    test('1.2 Rejects severe Hinglish abusive terms with 400', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'tu ekdum madarchod chutiya hai' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MODERATION_REJECTED');
    });

    test('1.3 Rejects leetspeak-obfuscated profanities (e.g. f*ck, b!tch, a$$hole)', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'Get out of here you little b!tch a$$hole' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MODERATION_REJECTED');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. REPETITIVE & SPAM COMMENT DETECTION
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Repetitive & Spam Comment Detection', () => {
    test('2.1 Flags comments with excessive repeated emojis (e.g. 5+ identical emojis)', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'Great content 🔥🔥🔥🔥🔥🔥🔥' });

      expect(res.status).toBe(201);
      expect(res.body.flagged).toBe(true);
      expect(res.body.message).toContain('pending automated review');
    });

    test('2.2 Flags comments with repeated identical word spam', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'Subscribe to me now free free free free free money' });

      expect(res.status).toBe(201);
      expect(res.body.flagged).toBe(true);
    });

    test('2.3 Rejects comments containing known malicious / ip-logging links', async () => {
      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'Check out this free gift: iplogger.org/2f5x1' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MODERATION_REJECTED');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. DUPLICATE COMMENT DETECTION
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Duplicate Comment Prevention', () => {
    test('3.1 Rejects identical comment by same user within 5-minute window', async () => {
      const uniqueText = `Clean constructive comment ${Date.now()}`;

      // First submission succeeds
      const firstRes = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: uniqueText });
      expect(firstRes.status).toBe(201);

      // Immediate duplicate submission must be rejected with 400
      const dupRes = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: uniqueText });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.code).toBe('DUPLICATE_COMMENT');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. FLOODING & CAPTCHA CHALLENGE
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Comment Flooding & CAPTCHA Challenge', () => {
    test('4.1 Issues and validates mathematical CAPTCHA challenge', () => {
      const challenge = generateCaptchaChallenge();
      expect(challenge.question).toBeDefined();
      expect(challenge.token).toBeDefined();

      // Extract parts to test verification
      const parts = challenge.token.split('.');
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));

      // Correct answer passes
      expect(verifyCaptchaChallenge(challenge.token, payload.a)).toBe(true);
      // Wrong answer fails
      expect(verifyCaptchaChallenge(challenge.token, '9999')).toBe(false);
    });

    test('4.2 Challenge endpoint GET /api/comments/challenge returns valid challenge', async () => {
      const res = await request(app).get('/api/comments/challenge');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.challenge.question).toMatch(/What is \d+ \+ \d+\?/);
      expect(res.body.challenge.token).toBeDefined();
    });

    test('4.3 Submitting correct challenge answer bypasses flood restriction', async () => {
      const challenge = generateCaptchaChallenge();
      const parts = challenge.token.split('.');
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));

      const res = await request(app)
        .post(`/api/videos/${testVideoId}/comments`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({
          text: `Verified challenge comment ${Date.now()}`,
          challengeToken: challenge.token,
          challengeAnswer: payload.a,
        });

      expect(res.status).toBe(201);
      expect(res.body.comment).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. 15-MINUTE EDIT/DELETE TIME WINDOW ENFORCEMENT
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. 15-Minute Author Edit/Delete Window Enforcement', () => {
    let recentCommentId;
    let oldCommentId;

    beforeEach(async () => {
      // Create fresh comment (now)
      const freshComment = await Comment.create({
        videoId: testVideoId,
        userId: regularUser._id,
        author: regularUser.name,
        authorInitials: regularUser.initials,
        text: 'Recent comment for edit window test',
        moderationStatus: 'approved',
        createdAt: new Date(),
      });
      recentCommentId = freshComment._id.toString();

      // Create old comment (> 15 minutes ago)
      const staleComment = await Comment.create({
        videoId: testVideoId,
        userId: regularUser._id,
        author: regularUser.name,
        authorInitials: regularUser.initials,
        text: 'Old comment created 20 minutes ago',
        moderationStatus: 'approved',
        createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20m ago
      });
      oldCommentId = staleComment._id.toString();
    });

    test('5.1 Author can edit recent comment within 15 minutes', async () => {
      const res = await request(app)
        .put(`/api/comments/${recentCommentId}`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'Updated text within 15 minutes' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.comment.text).toBe('Updated text within 15 minutes');
    });

    test('5.2 Author CANNOT edit comment after 15 minutes (rejected with 403 TIME_LIMIT_EXCEEDED)', async () => {
      const res = await request(app)
        .put(`/api/comments/${oldCommentId}`)
        .set('Cookie', [`vv_token=${regularToken}`])
        .send({ text: 'Attempting to edit expired comment' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TIME_LIMIT_EXCEEDED');
      expect(res.body.error).toContain('within 15 minutes');
    });

    test('5.3 Author CANNOT delete comment after 15 minutes (rejected with 403 TIME_LIMIT_EXCEEDED)', async () => {
      const res = await request(app)
        .delete(`/api/comments/${oldCommentId}`)
        .set('Cookie', [`vv_token=${regularToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TIME_LIMIT_EXCEEDED');
    });

    test('5.4 Admin CAN edit and delete comments at any time regardless of 15-minute window', async () => {
      // Admin edit on 20-minute old comment
      const editRes = await request(app)
        .put(`/api/comments/${oldCommentId}`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ text: 'Admin edited this stale comment cleanly' });
      expect(editRes.status).toBe(200);

      // Admin delete on 20-minute old comment
      const deleteRes = await request(app)
        .delete(`/api/comments/${oldCommentId}`)
        .set('Cookie', [`vv_token=${adminToken}`]);
      expect(deleteRes.status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. COMMENT REPORTING WITH PREDEFINED REASONS
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Comment Reporting & Predefined Reasons', () => {
    let reportableCommentId;

    beforeEach(async () => {
      const c = await Comment.create({
        videoId: testVideoId,
        userId: regularUser._id,
        author: regularUser.name,
        authorInitials: regularUser.initials,
        text: 'Reportable comment test',
        moderationStatus: 'approved',
      });
      reportableCommentId = c._id.toString();
    });

    test('6.1 Rejects invalid or missing report reasons with 400', async () => {
      const res = await request(app)
        .post(`/api/comments/${reportableCommentId}/report`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ reason: 'i_just_dont_like_it' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REASON');
    });

    test('6.2 Successfully reports comment with predefined reason (harassment)', async () => {
      const res = await request(app)
        .post(`/api/comments/${reportableCommentId}/report`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ reason: 'harassment', details: 'User is personally targeting another commenter.' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.reportCount).toBe(1);

      // Verify comment is flagged in database
      const updatedComment = await Comment.findById(reportableCommentId);
      expect(updatedComment.moderationStatus).toBe('flagged');
      expect(updatedComment.reportCount).toBe(1);
    });

    test('6.3 Prevents duplicate reporting of the same comment by the same user with 409', async () => {
      // First report
      await request(app)
        .post(`/api/comments/${reportableCommentId}/report`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ reason: 'spam' });

      // Duplicate report
      const dupRes = await request(app)
        .post(`/api/comments/${reportableCommentId}/report`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ reason: 'offensive' });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.code).toBe('ALREADY_REPORTED');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. ADMIN MODERATION REVIEW QUEUE & RESOLUTION
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Admin Moderation Review Queue & Resolution', () => {
    let flaggedCommentId;

    beforeEach(async () => {
      const c = await Comment.create({
        videoId: testVideoId,
        userId: regularUser._id,
        author: regularUser.name,
        authorInitials: regularUser.initials,
        text: 'Borderline flagged comment for queue test',
        moderationStatus: 'flagged',
        moderationReason: 'Automated borderline pattern',
        reportCount: 2,
      });
      flaggedCommentId = c._id.toString();

      await CommentReport.create({
        commentId: c._id,
        videoId: testVideoId,
        reportedBy: adminUser._id,
        reason: 'offensive',
        details: 'Needs review',
        status: 'pending',
      });
    });

    test('7.1 Non-admin is rejected from moderation review queue with 403', async () => {
      const res = await request(app)
        .get('/api/admin/moderation/comments')
        .set('Cookie', [`vv_token=${regularToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    test('7.2 Admin can fetch moderation review queue with report details', async () => {
      const res = await request(app)
        .get('/api/admin/moderation/comments?status=flagged')
        .set('Cookie', [`vv_token=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.comments)).toBe(true);

      const target = res.body.comments.find(c => c.id === flaggedCommentId);
      expect(target).toBeDefined();
      expect(target.reports.length).toBeGreaterThan(0);
      expect(target.reports[0].reason).toBe('offensive');
    });

    test('7.3 Admin can approve flagged comment, returning it to public feed', async () => {
      const res = await request(app)
        .post(`/api/admin/moderation/comments/${flaggedCommentId}/resolve`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ action: 'approve', note: 'Reviewed and deemed safe.' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('approve');

      const updated = await Comment.findById(flaggedCommentId);
      expect(updated.moderationStatus).toBe('approved');

      // Associated reports should be dismissed
      const reports = await CommentReport.find({ commentId: flaggedCommentId });
      expect(reports.every(r => r.status === 'dismissed')).toBe(true);
    });

    test('7.4 Admin can reject or delete comment in review queue', async () => {
      const res = await request(app)
        .post(`/api/admin/moderation/comments/${flaggedCommentId}/resolve`)
        .set('Cookie', [`vv_token=${adminToken}`])
        .send({ action: 'delete', note: 'Severe rule violation.' });

      expect(res.status).toBe(200);

      const deleted = await Comment.findById(flaggedCommentId);
      expect(deleted).toBeNull();
    });
  });
});
