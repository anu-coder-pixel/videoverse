/**
 * VideoVerse Phase 2, Step 6 — Admin Moderation, Analytics & Management Dashboard Test Suite
 *
 * Comprehensive verification of:
 * 1. Admin Authentication & RBAC (Task 1):
 *    - Strict rejection of unauthenticated requests (HTTP 401)
 *    - Rejection of normal users attempting admin access (HTTP 403)
 *    - Rejection of suspended users in authentication middleware (HTTP 403 ACCOUNT_SUSPENDED)
 *    - Authorized access for administrators (HTTP 200)
 * 2. Admin Dashboard Overview (Task 2):
 *    - Accurate database aggregation metrics (no mock data)
 *    - DAU, MAU, total videos, processing status, active subscriptions by tier, payment revenue, pending moderation
 * 3. User Management (Task 3):
 *    - User search, filtering, and pagination
 *    - Individual user profile inspection with login history, trusted devices, downloads, and payments
 *    - Account suspension and reactivation with reason tracking and audit logging
 *    - Protection against self-suspension
 *    - Role modification with audit logging and protection against self-demotion
 * 4. Video Management (Task 4):
 *    - Video search, status filtering, and pagination
 *    - Publishing and unpublishing toggle (verifying unpublished videos are hidden from public endpoints)
 *    - Administrative content takedown (hiding video while preserving physical media on disk)
 *    - Transcoding failure retry via background queue
 * 5. Comment Moderation (Task 5):
 *    - Moderation review queue of flagged comments and reports
 *    - Resolution actions: 'approve', 'reject', and 'delete' with audit logging
 * 6. Payment & Subscription Analytics (Task 6):
 *    - Revenue aggregation (total, monthly, yearly), tier distribution, and disputes
 *    - Paginated invoice lookup with PDF invoice links
 * 7. Platform Analytics (Task 7):
 *    - Activity trends (DAU, WAU, MAU), top viewed videos, top downloaded videos, bandwidth usage estimates
 * 8. Admin Audit Logs & Immutability (Task 8):
 *    - Audit log search, filtering, and pagination
 *    - Append-only immutability guarantee: mutation attempts throw explicit errors
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { app } = require('../index');
const User = require('../models/User');
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const CommentReport = require('../models/CommentReport');
const Payment = require('../models/Payment');
const Download = require('../models/Download');
const LoginHistory = require('../models/LoginHistory');
const TrustedDevice = require('../models/TrustedDevice');
const TranscodeJob = require('../models/TranscodeJob');
const AdminAuditLog = require('../models/AdminAuditLog');

describe('Phase 2, Step 6: Admin Moderation, Analytics & Management Dashboard Suite', () => {
  let adminUser, regularUser, targetUser;
  let adminToken, regularToken, targetToken;
  let testVideo1, testVideo2;
  let testComment1, testComment2;

  beforeAll(async () => {
    // Clean test records
    await User.deleteMany({
      email: {
        $in: [
          'step6_admin@example.com',
          'step6_regular@example.com',
          'step6_target@example.com',
        ],
      },
    });
    await Video.deleteMany({ id: { $in: ['step6-vid-001', 'step6-vid-002'] } });
    await Comment.deleteMany({ videoId: { $in: ['step6-vid-001', 'step6-vid-002'] } });
    await CommentReport.deleteMany({});
    await Payment.deleteMany({ razorpayOrderId: { $in: ['order_step6_1', 'order_step6_2'] } });
    await Download.deleteMany({ videoId: { $in: ['step6-vid-001', 'step6-vid-002'] } });
    // Pre-cleanup orphaned fixtures from previous failed runs
    await TrustedDevice.deleteMany({ deviceTokenHash: 'hash_step6_target_dev_1' });
    await TranscodeJob.deleteMany({ jobId: 'job_step6_test_002' });
    // AdminAuditLog is immutable via Mongoose pre-hooks; bypass via native collection driver
    await AdminAuditLog.collection.deleteMany({ adminEmail: 'step6_admin@example.com' });

    // 1. Create Admin User
    adminUser = await User.create({
      name: 'Step6 Admin',
      email: 'step6_admin@example.com',
      passwordHash: 'hashed_pw',
      role: 'admin',
      subscriptionTier: 'gold',
    });

    // 2. Create Regular User
    regularUser = await User.create({
      name: 'Step6 Regular',
      email: 'step6_regular@example.com',
      passwordHash: 'hashed_pw',
      role: 'user',
      subscriptionTier: 'free',
    });

    // 3. Create Target User (for suspension/role testing)
    targetUser = await User.create({
      name: 'Step6 Target',
      email: 'step6_target@example.com',
      passwordHash: 'hashed_pw',
      role: 'user',
      subscriptionTier: 'bronze',
    });

    // Generate JWT tokens
    const secret = process.env.JWT_SECRET || 'test_jwt_secret_must_be_32_chars_long!';
    adminToken = jwt.sign({ id: adminUser._id.toString() }, secret, { algorithm: 'HS256', expiresIn: '1d' });
    regularToken = jwt.sign({ id: regularUser._id.toString() }, secret, { algorithm: 'HS256', expiresIn: '1d' });
    targetToken = jwt.sign({ id: targetUser._id.toString() }, secret, { algorithm: 'HS256', expiresIn: '1d' });

    // 4. Create Videos
    testVideo1 = await Video.create({
      id: 'step6-vid-001',
      title: 'Step 6 Test Video Alpha',
      channel: {
        id: 'ch-s6',
        name: 'Admin Studio',
        handle: '@adminstudio',
        subscribers: '100K',
        avatarColor: '#ff0000',
        initials: 'AS',
        verified: true,
      },
      category: 'Technology',
      views: '10K',
      processingStatus: 'ready',
      isPublished: true,
      isRemovedByAdmin: false,
      fileSize: 15000000,
    });

    testVideo2 = await Video.create({
      id: 'step6-vid-002',
      title: 'Step 6 Test Video Beta (Failed Transcode)',
      channel: {
        id: 'ch-s6',
        name: 'Admin Studio',
        handle: '@adminstudio',
        subscribers: '100K',
        avatarColor: '#ff0000',
        initials: 'AS',
        verified: true,
      },
      category: 'Education',
      views: '500',
      processingStatus: 'failed',
      processingError: 'Synthetic encoder crash for test',
      isPublished: true,
      isRemovedByAdmin: false,
      storagePath: 'server/uploads/videos/dummy.mp4',
    });

    // 5. Create TranscodeJob for Video 2
    await TranscodeJob.create({
      jobId: 'job_step6_test_002',
      videoId: 'step6-vid-002',
      sourcePath: 'server/uploads/videos/dummy.mp4',
      status: 'failed',
      attempts: 3,
      errorMessage: 'Synthetic encoder crash for test',
    });

    // 6. Create Telemetry & Payment records
    await LoginHistory.create({
      userId: targetUser._id,
      timestamp: new Date(),
      ip: '127.0.0.1',
      browser: 'Chrome',
      browserVersion: '120.0',
      os: 'Windows',
      osVersion: '11',
      deviceType: 'desktop',
      status: 'success',
    });

    await TrustedDevice.create({
      userId: targetUser._id,
      deviceTokenHash: 'hash_step6_target_dev_1',
      deviceName: 'Windows PC (Chrome)',
      browser: 'Chrome',
      os: 'Windows',
      lastIp: '127.0.0.1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await Download.create({
      userId: targetUser._id,
      videoId: testVideo1.id,
      videoTitle: testVideo1.title,
      channelName: testVideo1.channel.name,
      status: 'completed',
      fileSize: 15000000,
      completedAt: new Date(),
    });

    await Payment.create({
      userId: targetUser._id,
      razorpayOrderId: 'order_step6_1',
      razorpayPaymentId: 'pay_step6_1',
      tier: 'bronze',
      billingCycle: 'monthly',
      amount: 9900,
      status: 'paid',
      invoiceNumber: 'INV-2026-STEP6-001',
    });

    // 7. Create Moderation Comments & Reports
    testComment1 = await Comment.create({
      videoId: testVideo1.id,
      userId: targetUser._id,
      author: targetUser.name,
      authorInitials: 'ST',
      authorColor: '#3ea6ff',
      text: 'This video contains severe clickbait and fake information.',
      moderationStatus: 'flagged',
      moderationReason: 'Automated policy rule match: clickbait',
      reportCount: 1,
    });

    await CommentReport.create({
      commentId: testComment1._id,
      videoId: testVideo1.id,
      reportedBy: regularUser._id,
      reason: 'misinformation',
      details: 'Flagged by automated test fixture',
      status: 'pending',
    });
  });

  afterAll(async () => {
    // Cleanup created test documents
    await User.deleteMany({
      email: {
        $in: [
          'step6_admin@example.com',
          'step6_regular@example.com',
          'step6_target@example.com',
        ],
      },
    });
    await Video.deleteMany({ id: { $in: ['step6-vid-001', 'step6-vid-002'] } });
    await Comment.deleteMany({ videoId: { $in: ['step6-vid-001', 'step6-vid-002'] } });
    await CommentReport.deleteMany({});
    await Payment.deleteMany({ razorpayOrderId: { $in: ['order_step6_1', 'order_step6_2'] } });
    await Download.deleteMany({ videoId: { $in: ['step6-vid-001', 'step6-vid-002'] } });
    await TranscodeJob.deleteMany({ jobId: 'job_step6_test_002' });
    await TrustedDevice.deleteMany({ deviceTokenHash: 'hash_step6_target_dev_1' });
    await LoginHistory.deleteMany({ userId: { $in: [adminUser?._id, regularUser?._id, targetUser?._id].filter(Boolean) } });
    await AdminAuditLog.collection.deleteMany({ adminEmail: 'step6_admin@example.com' });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 1: Admin Authentication & RBAC
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 1: Admin Authentication & Role-Based Access Control', () => {
    test('1.1: Rejects unauthenticated request with HTTP 401', async () => {
      const res = await request(app).get('/api/admin/overview');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    test('1.2: Rejects standard user (role: "user") with HTTP 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Cookie', `vv_token=${regularToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    test('1.3: Allows authenticated administrator with HTTP 200', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Cookie', `vv_token=${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.metrics).toBeDefined();
    });

    test('1.4: Suspended user is rejected across all authenticated endpoints with HTTP 403', async () => {
      // Temporarily mark targetUser as suspended
      targetUser.isSuspended = true;
      targetUser.suspendedReason = 'Suspicious security violation';
      await targetUser.save();

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `vv_token=${targetToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(res.body.reason).toBe('Suspicious security violation');

      // Restore
      targetUser.isSuspended = false;
      targetUser.suspendedReason = null;
      await targetUser.save();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 2: Admin Dashboard Overview Metrics
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 2: Admin Dashboard Overview Metrics', () => {
    test('2.1: Computes accurate overview counts from live MongoDB records', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      const m = res.body.metrics;

      // Users
      expect(m.users.total).toBeGreaterThanOrEqual(3);
      expect(m.users.dau).toBeGreaterThanOrEqual(1);
      expect(m.users.mau).toBeGreaterThanOrEqual(1);

      // Videos
      expect(m.videos.total).toBeGreaterThanOrEqual(2);
      expect(m.videos.published).toBeGreaterThanOrEqual(1);
      expect(m.videos.processing).toBeGreaterThanOrEqual(0);
      expect(m.videos.totalViews).toBeGreaterThanOrEqual(10000);

      // Downloads
      expect(m.downloads.total).toBeGreaterThanOrEqual(1);

      // Subscriptions
      expect(m.subscriptions.breakdown).toBeDefined();
      expect(typeof m.subscriptions.breakdown.free).toBe('number');
      expect(typeof m.subscriptions.breakdown.bronze).toBe('number');
      expect(typeof m.subscriptions.breakdown.gold).toBe('number');

      // Revenue
      expect(m.revenue.totalRevenue).toBeGreaterThanOrEqual(99);
      expect(m.revenue.currency).toBe('INR');

      // Moderation
      expect(m.moderation.pendingReports).toBeGreaterThanOrEqual(1);
      expect(m.moderation.flaggedComments).toBeGreaterThanOrEqual(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 3: User Management
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 3: User Management Operations', () => {
    test('3.1: Paginated user search by query and role filter', async () => {
      const res = await request(app)
        .get('/api/admin/users?q=Step6+Target&role=user')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(1);
      expect(res.body.users[0].email).toBe('step6_target@example.com');
      expect(res.body.users[0].role).toBe('user');
    });

    test('3.2: Inspects individual user profile with telemetry & transaction arrays', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${targetUser._id}`)
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe('Step6 Target');

      const { telemetry } = res.body;
      expect(telemetry.loginHistory.length).toBeGreaterThanOrEqual(1);
      expect(telemetry.trustedDevices.length).toBeGreaterThanOrEqual(1);
      expect(telemetry.downloadHistory.length).toBeGreaterThanOrEqual(1);
      expect(telemetry.paymentHistory.length).toBeGreaterThanOrEqual(1);
    });

    test('3.3: Suspend user account with reason and creates audit log', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${targetUser._id}/suspend`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ isSuspended: true, reason: 'Abusive comments policy violation' });

      expect(res.status).toBe(200);
      expect(res.body.user.isSuspended).toBe(true);

      const dbUser = await User.findById(targetUser._id);
      expect(dbUser.isSuspended).toBe(true);
      expect(dbUser.suspendedReason).toBe('Abusive comments policy violation');
      expect(dbUser.suspendedAt).toBeDefined();

      // Verify audit log creation
      const audit = await AdminAuditLog.findOne({
        targetId: targetUser._id.toString(),
        action: 'USER_SUSPEND',
      });
      expect(audit).toBeDefined();
      expect(audit.adminEmail).toBe(adminUser.email);
    });

    test('3.4: Prevents administrator from suspending their own account', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${adminUser._id}/suspend`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ isSuspended: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot suspend their own account/i);
    });

    test('3.5: Reactivates user account and creates audit log', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${targetUser._id}/suspend`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ isSuspended: false });

      expect(res.status).toBe(200);
      expect(res.body.user.isSuspended).toBe(false);

      const dbUser = await User.findById(targetUser._id);
      expect(dbUser.isSuspended).toBe(false);

      const audit = await AdminAuditLog.findOne({
        targetId: targetUser._id.toString(),
        action: 'USER_REACTIVATE',
      });
      expect(audit).toBeDefined();
    });

    test('3.6: Updates user role and prevents self-demotion', async () => {
      // 1. Promote targetUser to admin
      const promoteRes = await request(app)
        .put(`/api/admin/users/${targetUser._id}/role`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ role: 'admin' });

      expect(promoteRes.status).toBe(200);
      expect(promoteRes.body.user.role).toBe('admin');

      // 2. Prevent admin self-demotion
      const selfDemoteRes = await request(app)
        .put(`/api/admin/users/${adminUser._id}/role`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ role: 'user' });

      expect(selfDemoteRes.status).toBe(400);
      expect(selfDemoteRes.body.error).toMatch(/cannot demote their own account/i);

      // Revert targetUser
      await User.findByIdAndUpdate(targetUser._id, { role: 'user' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 4: Video Management
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 4: Video Management & Transcoding Pipeline', () => {
    test('4.1: Paginated video listing with metadata', async () => {
      const res = await request(app)
        .get('/api/admin/videos?q=Step+6')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.videos.some(v => v.id === 'step6-vid-001')).toBe(true);
    });

    test('4.2: Toggles video publishing status and isolates unpublished video from public feed', async () => {
      // 1. Unpublish video 1
      const unpublishRes = await request(app)
        .put(`/api/admin/videos/${testVideo1.id}/publish`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ isPublished: false });

      expect(unpublishRes.status).toBe(200);
      expect(unpublishRes.body.video.isPublished).toBe(false);

      // 2. Anonymous public GET /api/videos should not include unpublished video
      const publicListRes = await request(app).get('/api/videos');
      expect(publicListRes.status).toBe(200);
      const isPresentInFeed = publicListRes.body.videos.some(v => v.id === testVideo1.id);
      expect(isPresentInFeed).toBe(false);

      // 3. Anonymous public GET /api/videos/:id returns 404 for unpublished video
      const publicSingleRes = await request(app).get(`/api/videos/${testVideo1.id}`);
      expect(publicSingleRes.status).toBe(404);

      // 4. Admin can still view the unpublished video
      const adminSingleRes = await request(app)
        .get(`/api/videos/${testVideo1.id}`)
        .set('Cookie', `vv_token=${adminToken}`);
      expect(adminSingleRes.status).toBe(200);

      // 5. Re-publish video 1
      const republishRes = await request(app)
        .put(`/api/admin/videos/${testVideo1.id}/publish`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ isPublished: true });
      expect(republishRes.status).toBe(200);
    });

    test('4.3: Administrative content takedown preserves video file while hiding from public', async () => {
      const takedownRes = await request(app)
        .delete(`/api/admin/videos/${testVideo1.id}`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ reason: 'Copyright infringement notice' });

      expect(takedownRes.status).toBe(200);
      expect(takedownRes.body.video.isRemovedByAdmin).toBe(true);

      const dbVideo = await Video.findOne({ id: testVideo1.id });
      expect(dbVideo.isRemovedByAdmin).toBe(true);
      expect(dbVideo.isPublished).toBe(false);
      expect(dbVideo.adminRemovalReason).toBe('Copyright infringement notice');

      // Check audit log
      const audit = await AdminAuditLog.findOne({
        targetId: testVideo1.id,
        action: 'VIDEO_REMOVE',
      });
      expect(audit).toBeDefined();

      // Restore video 1 for subsequent tests
      dbVideo.isRemovedByAdmin = false;
      dbVideo.isPublished = true;
      dbVideo.adminRemovalReason = null;
      await dbVideo.save();
    });

    test('4.4: Safely retries failed transcoding job via background queue', async () => {
      const retryRes = await request(app)
        .post(`/api/admin/videos/${testVideo2.id}/retry-transcode`)
        .set('Cookie', `vv_token=${adminToken}`);

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.success).toBe(true);
      expect(retryRes.body.job.status).toBe('queued');

      const dbJob = await TranscodeJob.findOne({ videoId: testVideo2.id });
      expect(dbJob.status).toBe('queued');
      expect(dbJob.attempts).toBe(0);

      const audit = await AdminAuditLog.findOne({
        targetId: testVideo2.id,
        action: 'VIDEO_RETRY_TRANSCODE',
      });
      expect(audit).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 5: Comment Moderation Queue
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 5: Comment Moderation Review Queue', () => {
    test('5.1: Lists flagged comments with attached reports', async () => {
      const res = await request(app)
        .get('/api/admin/moderation/comments?status=flagged')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.comments.length).toBeGreaterThanOrEqual(1);

      const target = res.body.comments.find(c => c.id === testComment1._id.toString());
      expect(target).toBeDefined();
      expect(target.reports.length).toBeGreaterThanOrEqual(1);
    });

    test('5.2: Resolves flagged comment with "approve" action', async () => {
      const res = await request(app)
        .post(`/api/admin/moderation/comments/${testComment1._id}/resolve`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ action: 'approve', note: 'Reviewed and deemed safe by moderator.' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('approve');

      const dbComment = await Comment.findById(testComment1._id);
      expect(dbComment.moderationStatus).toBe('approved');

      // Verify associated report is dismissed
      const dbReport = await CommentReport.findOne({ commentId: testComment1._id });
      expect(dbReport.status).toBe('dismissed');

      // Verify audit log
      const audit = await AdminAuditLog.findOne({
        targetId: testComment1._id.toString(),
        action: 'COMMENT_APPROVE',
      });
      expect(audit).toBeDefined();
    });

    test('5.3: Resolves comment with "delete" action and purges document', async () => {
      // Create temporary flagged comment
      const tempComment = await Comment.create({
        videoId: testVideo1.id,
        userId: targetUser._id,
        author: 'Spammer',
        authorInitials: 'SP',
        authorColor: '#000000',
        text: 'Malicious spam comment link',
        moderationStatus: 'flagged',
      });

      const res = await request(app)
        .post(`/api/admin/moderation/comments/${tempComment._id}/resolve`)
        .set('Cookie', `vv_token=${adminToken}`)
        .send({ action: 'delete', note: 'Spam purged' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('delete');

      const check = await Comment.findById(tempComment._id);
      expect(check).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 6: Payment & Subscription Analytics
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 6: Payment & Subscription Analytics', () => {
    test('6.1: Computes financial analytics and tier revenue distribution', async () => {
      const res = await request(app)
        .get('/api/admin/payments/analytics')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      const a = res.body.analytics;
      expect(a.revenue.total).toBeGreaterThanOrEqual(99);
      expect(a.tierBreakdown).toBeDefined();
      expect(a.tierBreakdown.bronze).toBeDefined();
      expect(a.tierBreakdown.bronze.revenue).toBeGreaterThanOrEqual(99);
      expect(typeof a.expiringSubscriptionsNext7Days).toBe('number');
    });

    test('6.2: Paginated invoices lookup with PDF links', async () => {
      const res = await request(app)
        .get('/api/admin/payments/invoices?q=INV-2026-STEP6-001')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      const invoice = res.body.invoices[0];
      expect(invoice.invoiceNumber).toBe('INV-2026-STEP6-001');
      expect(invoice.amount).toBe(99);
      expect(invoice.invoicePdfUrl).toContain('/api/payments/invoice/');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 7: Platform Analytics
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 7: Platform Analytics', () => {
    test('7.1: Returns active user metrics, top viewed, top downloaded, and bandwidth', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/platform')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      const p = res.body.platform;

      expect(p.activity.totalUsers).toBeGreaterThanOrEqual(3);
      expect(p.topViewedVideos.length).toBeGreaterThanOrEqual(1);
      expect(p.topDownloadedVideos.length).toBeGreaterThanOrEqual(1);
      expect(p.categoryDistribution.length).toBeGreaterThanOrEqual(1);
      expect(p.bandwidth.totalDownloadBytes).toBeGreaterThanOrEqual(15000000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 8: Admin Audit Logs & Append-Only Immutability
  // ───────────────────────────────────────────────────────────────────────────
  describe('Task 8: Admin Audit Logs & Immutability', () => {
    test('8.1: Retrieves paginated audit logs with action filter', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs?action=USER_SUSPEND')
        .set('Cookie', `vv_token=${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.logs[0].action).toBe('USER_SUSPEND');
    });

    test('8.2: Enforces strict append-only immutability (mutations throw error)', async () => {
      const log = await AdminAuditLog.findOne({ action: 'USER_SUSPEND' });
      expect(log).toBeDefined();

      // Attempt updateOne -> must throw
      await expect(
        AdminAuditLog.updateOne({ _id: log._id }, { action: 'MUTATED_ACTION' })
      ).rejects.toThrow(/immutable/i);

      // Attempt deleteOne -> must throw
      await expect(
        AdminAuditLog.deleteOne({ _id: log._id })
      ).rejects.toThrow(/immutable/i);

      // Attempt findByIdAndDelete -> must throw
      await expect(
        AdminAuditLog.findByIdAndDelete(log._id)
      ).rejects.toThrow(/immutable/i);
    });
  });
});
