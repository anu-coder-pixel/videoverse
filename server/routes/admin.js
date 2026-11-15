const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('../middleware/auth');
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
const { transcodeQueue } = require('../utils/hlsTranscoder');

const router = express.Router();

// ── Strict Server-Side Admin Authorization on ALL Admin Endpoints ─────────────
router.use(requireAuth, requireAdmin);

/**
 * Helper to record administrative actions into append-only immutable audit log.
 */
async function recordAuditLog({
  admin,
  action,
  targetType,
  targetId,
  ipAddress = '',
  previousValues = null,
  newValues = null,
  status = 'success',
  errorMessage = null,
}) {
  try {
    await AdminAuditLog.create({
      adminId: admin._id,
      adminEmail: admin.email,
      action,
      targetType,
      targetId: String(targetId),
      ipAddress,
      previousValues,
      newValues,
      status,
      errorMessage,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[AdminAuditLog Error]', err.message);
  }
}

/**
 * Helper to parse view string (e.g. "1.4M", "250K", "1200") to integer
 */
function parseViewsNum(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const s = String(v).trim().toUpperCase();
  if (s.endsWith('M')) return parseFloat(s) * 1_000_000;
  if (s.endsWith('K')) return parseFloat(s) * 1_000;
  return parseInt(s, 10) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: Admin Dashboard Overview Metrics
// ─────────────────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. User metrics
    const totalUsersPromise = User.countDocuments();
    const dauUsersPromise = LoginHistory.distinct('userId', { timestamp: { $gte: oneDayAgo } });
    const mauUsersPromise = LoginHistory.distinct('userId', { timestamp: { $gte: thirtyDaysAgo } });

    // 2. Video metrics
    const totalVideosPromise = Video.countDocuments();
    const publishedVideosPromise = Video.countDocuments({
      isPublished: { $ne: false },
      isRemovedByAdmin: { $ne: true },
    });
    const processingVideosPromise = Video.countDocuments({
      processingStatus: { $in: ['uploading', 'queued', 'processing'] },
    });

    // 3. Download metrics
    const totalDownloadsPromise = Download.countDocuments({ status: 'completed' });

    // 4. Subscription tier metrics
    const freeUsersPromise = User.countDocuments({
      $or: [
        { subscriptionTier: 'free' },
        { subscriptionTier: null },
        { subscriptionExpiresAt: { $lt: now } },
      ],
    });
    const bronzeUsersPromise = User.countDocuments({
      subscriptionTier: 'bronze',
      $or: [{ subscriptionExpiresAt: null }, { subscriptionExpiresAt: { $gte: now } }],
    });
    const silverUsersPromise = User.countDocuments({
      subscriptionTier: { $in: ['silver', 'premium'] },
      $or: [{ subscriptionExpiresAt: null }, { subscriptionExpiresAt: { $gte: now } }],
    });
    const goldUsersPromise = User.countDocuments({
      subscriptionTier: { $in: ['gold', 'vip'] },
      $or: [{ subscriptionExpiresAt: null }, { subscriptionExpiresAt: { $gte: now } }],
    });

    // 5. Payment revenue metrics
    const totalRevenuePromise = Payment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
    ]);
    const monthlyRevenuePromise = Payment.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
    ]);
    const failedPaymentsPromise = Payment.countDocuments({ status: 'failed' });

    // 6. Moderation reports
    const pendingReportsPromise = CommentReport.countDocuments({ status: 'pending' });
    const flaggedCommentsPromise = Comment.countDocuments({ moderationStatus: 'flagged' });

    // 7. Video views calculation (from all videos)
    const videosForViewsPromise = Video.find({}, 'views').lean();

    const [
      totalUsers,
      dauUserIds,
      mauUserIds,
      totalVideos,
      publishedVideos,
      processingVideos,
      totalDownloads,
      freeUsers,
      bronzeUsers,
      silverUsers,
      goldUsers,
      totalRevenueAgg,
      monthlyRevenueAgg,
      failedPaymentsCount,
      pendingReportsCount,
      flaggedCommentsCount,
      videosForViews,
    ] = await Promise.all([
      totalUsersPromise,
      dauUsersPromise,
      mauUsersPromise,
      totalVideosPromise,
      publishedVideosPromise,
      processingVideosPromise,
      totalDownloadsPromise,
      freeUsersPromise,
      bronzeUsersPromise,
      silverUsersPromise,
      goldUsersPromise,
      totalRevenuePromise,
      monthlyRevenuePromise,
      failedPaymentsPromise,
      pendingReportsPromise,
      flaggedCommentsPromise,
      videosForViewsPromise,
    ]);

    // Calculate total views
    const totalViews = videosForViews.reduce((acc, v) => acc + parseViewsNum(v.views), 0);

    // Calculate revenue in INR (paise / 100)
    const totalRevenue = (totalRevenueAgg[0]?.totalAmount || 0) / 100;
    const monthlyRevenue = (monthlyRevenueAgg[0]?.totalAmount || 0) / 100;

    // Daily & Monthly active user calculation: fallback to User.updatedAt if LoginHistory empty
    let dauCount = dauUserIds.length;
    let mauCount = mauUserIds.length;
    if (dauCount === 0 && totalUsers > 0) {
      dauCount = await User.countDocuments({ updatedAt: { $gte: oneDayAgo } });
    }
    if (mauCount === 0 && totalUsers > 0) {
      mauCount = await User.countDocuments({ updatedAt: { $gte: thirtyDaysAgo } });
    }
    // Guarantee DAU <= MAU <= Total
    dauCount = Math.max(1, Math.min(dauCount || 1, totalUsers));
    mauCount = Math.max(dauCount, Math.min(mauCount || 1, totalUsers));

    const activeSubscriptions = bronzeUsers + silverUsers + goldUsers;

    return res.json({
      success: true,
      metrics: {
        users: {
          total: totalUsers,
          dau: dauCount,
          mau: mauCount,
        },
        videos: {
          total: totalVideos,
          published: publishedVideos,
          processing: processingVideos,
          totalViews,
        },
        downloads: {
          total: totalDownloads,
        },
        subscriptions: {
          activeTotal: activeSubscriptions,
          breakdown: {
            free: freeUsers,
            bronze: bronzeUsers,
            silver: silverUsers,
            gold: goldUsers,
          },
        },
        revenue: {
          totalRevenue,
          monthlyRevenue,
          failedPayments: failedPaymentsCount,
          currency: 'INR',
        },
        moderation: {
          pendingReports: pendingReportsCount,
          flaggedComments: flaggedCommentsCount,
          totalPending: pendingReportsCount + flaggedCommentsCount,
        },
      },
    });
  } catch (err) {
    console.error('[/api/admin/overview Error]', err);
    return res.status(500).json({ error: 'Failed to compute admin overview metrics.' });
  }
});

/**
 * GET /api/admin/stats
 * Quick admin overview stats.
 */
router.get('/stats', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const videoCount = await Video.countDocuments();
    return res.json({
      success: true,
      stats: {
        users: userCount,
        videos: videoCount,
        uptime: process.uptime(),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 3: User Management Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * Paginated user listing with search and filters.
 */
router.get('/users', async (req, res) => {
  try {
    const { q, role, tier, suspended, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const orConditions = [{ name: regex }, { email: regex }];
      if (mongoose.Types.ObjectId.isValid(q.trim())) {
        orConditions.push({ _id: q.trim() });
      }
      filter.$or = orConditions;
    }

    if (role && ['user', 'admin'].includes(role.toLowerCase())) {
      filter.role = role.toLowerCase();
    }

    if (tier && ['free', 'bronze', 'silver', 'gold'].includes(tier.toLowerCase())) {
      const t = tier.toLowerCase();
      if (t === 'silver') {
        filter.subscriptionTier = { $in: ['silver', 'premium'] };
      } else if (t === 'gold') {
        filter.subscriptionTier = { $in: ['gold', 'vip'] };
      } else {
        filter.subscriptionTier = t;
      }
    }

    if (suspended !== undefined && suspended !== '') {
      filter.isSuspended = suspended === 'true' || suspended === true;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      users: users.map(u => u.toSafeObject()),
    });
  } catch (err) {
    console.error('[/api/admin/users Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

/**
 * GET /api/admin/users/:id
 * Full individual user profile with login history, devices, downloads, and payments.
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID format.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Parallel lookup of user history & telemetry
    const [loginHistory, trustedDevices, downloadHistory, paymentHistory] = await Promise.all([
      LoginHistory.find({ userId: user._id }).sort({ timestamp: -1 }).limit(15).lean(),
      TrustedDevice.find({ userId: user._id }).sort({ lastUsedAt: -1 }).lean(),
      Download.find({ userId: user._id }).sort({ reservedAt: -1 }).limit(15).lean(),
      Payment.find({ userId: user._id }).sort({ createdAt: -1 }).limit(15).lean(),
    ]);

    return res.json({
      success: true,
      user: {
        ...user.toSafeObject(),
        isSuspended: Boolean(user.isSuspended),
        suspendedReason: user.suspendedReason || null,
        suspendedAt: user.suspendedAt || null,
        quotaReservationVersion: user.quotaReservationVersion || 0,
      },
      telemetry: {
        loginHistory: loginHistory.map(lh => ({
          id: lh._id.toString(),
          timestamp: lh.timestamp,
          ip: lh.ip,
          browser: `${lh.browser} ${lh.browserVersion}`.trim(),
          os: `${lh.os} ${lh.osVersion}`.trim(),
          deviceType: lh.deviceType,
          location: lh.location?.display || 'Unknown location',
          status: lh.status,
        })),
        trustedDevices: trustedDevices.map(td => ({
          id: td._id.toString(),
          deviceName: td.deviceName,
          browser: td.browser,
          os: td.os,
          deviceType: td.deviceType,
          lastIp: td.lastIp,
          isRevoked: td.isRevoked,
          createdAt: td.createdAt,
          lastUsedAt: td.lastUsedAt,
        })),
        downloadHistory: downloadHistory.map(d => ({
          id: d._id.toString(),
          videoId: d.videoId,
          videoTitle: d.videoTitle,
          status: d.status,
          fileSize: d.fileSize,
          reservedAt: d.reservedAt,
          completedAt: d.completedAt,
        })),
        paymentHistory: paymentHistory.map(p => ({
          id: p._id.toString(),
          razorpayOrderId: p.razorpayOrderId,
          razorpayPaymentId: p.razorpayPaymentId,
          tier: p.tier,
          billingCycle: p.billingCycle,
          amount: p.amount / 100,
          currency: p.currency,
          status: p.status,
          invoiceNumber: p.invoiceNumber,
          createdAt: p.createdAt,
        })),
      },
    });
  } catch (err) {
    console.error('[/api/admin/users/:id Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve user details.' });
  }
});

/**
 * PUT /api/admin/users/:id/suspend
 * Suspend or reactivate user account.
 */
router.put('/users/:id/suspend', async (req, res) => {
  try {
    const { id } = req.params;
    const { isSuspended, reason = '' } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID format.' });
    }

    // Protection: Prevent admin self-suspension
    if (req.user._id.toString() === id) {
      return res.status(400).json({ error: 'Administrators cannot suspend their own account.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const previousValues = {
      isSuspended: user.isSuspended,
      suspendedReason: user.suspendedReason,
      suspendedAt: user.suspendedAt,
    };

    const willSuspend = Boolean(isSuspended);
    user.isSuspended = willSuspend;
    user.suspendedReason = willSuspend ? (reason || 'Account suspended by administrator.') : null;
    user.suspendedAt = willSuspend ? new Date() : null;

    await user.save();

    const newValues = {
      isSuspended: user.isSuspended,
      suspendedReason: user.suspendedReason,
      suspendedAt: user.suspendedAt,
    };

    // Audit log
    await recordAuditLog({
      admin: req.user,
      action: willSuspend ? 'USER_SUSPEND' : 'USER_REACTIVATE',
      targetType: 'user',
      targetId: user._id,
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      previousValues,
      newValues,
    });

    return res.json({
      success: true,
      message: willSuspend ? 'User account has been suspended.' : 'User account has been reactivated.',
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[/api/admin/users/:id/suspend Error]', err);
    return res.status(500).json({ error: 'Failed to update user suspension status.' });
  }
});

/**
 * PUT /api/admin/users/:id/role
 * Change user role (user <-> admin).
 * Protected against self-demotion and unauthorized roles.
 */
router.put('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID format.' });
    }

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role specified. Allowed values: "user", "admin".' });
    }

    // Protection: Prevent admin self-demotion
    if (req.user._id.toString() === id && role !== 'admin') {
      return res.status(400).json({ error: 'Administrators cannot demote their own account.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const previousRole = user.role || 'user';
    user.role = role;
    await user.save();

    // Audit log
    await recordAuditLog({
      admin: req.user,
      action: 'USER_ROLE_CHANGE',
      targetType: 'user',
      targetId: user._id,
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      previousValues: { role: previousRole },
      newValues: { role: user.role },
    });

    return res.json({
      success: true,
      message: `User role updated to ${role}.`,
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[/api/admin/users/:id/role Error]', err);
    return res.status(500).json({ error: 'Failed to update user role.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 4: Video Management Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/videos
 * Paginated video listing for administrators with status/publishing filters.
 */
router.get('/videos', async (req, res) => {
  try {
    const { q, status, published, removed, category, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { title: regex },
        { id: regex },
        { 'channel.name': regex },
        { category: regex },
      ];
    }

    if (status) {
      filter.processingStatus = status;
    }

    if (published !== undefined && published !== '') {
      filter.isPublished = published === 'true' || published === true;
    }

    if (removed !== undefined && removed !== '') {
      filter.isRemovedByAdmin = removed === 'true' || removed === true;
    }

    if (category && category.toLowerCase() !== 'all') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [videos, total] = await Promise.all([
      Video.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('uploaderId', 'name email')
        .lean(),
      Video.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      videos: videos.map(v => ({
        ...v,
        viewsCount: parseViewsNum(v.views),
      })),
    });
  } catch (err) {
    console.error('[/api/admin/videos Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve videos.' });
  }
});

/**
 * PUT /api/admin/videos/:id/publish
 * Toggle video published / unpublished state.
 */
router.put('/videos/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const { isPublished } = req.body;

    const video = await Video.findOne({
      $or: [
        { id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    const previousPublished = video.isPublished !== false;
    const nextPublished = Boolean(isPublished);

    video.isPublished = nextPublished;
    await video.save();

    await recordAuditLog({
      admin: req.user,
      action: nextPublished ? 'VIDEO_PUBLISH' : 'VIDEO_UNPUBLISH',
      targetType: 'video',
      targetId: video.id,
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      previousValues: { isPublished: previousPublished },
      newValues: { isPublished: nextPublished },
    });

    return res.json({
      success: true,
      message: nextPublished ? 'Video has been published.' : 'Video has been unpublished.',
      video: {
        id: video.id,
        title: video.title,
        isPublished: video.isPublished,
      },
    });
  } catch (err) {
    console.error('[/api/admin/videos/:id/publish Error]', err);
    return res.status(500).json({ error: 'Failed to update video publishing state.' });
  }
});

/**
 * DELETE /api/admin/videos/:id
 * Administrative Content Takedown.
 * Marks video as removed by admin and unpublished without deleting original file on disk.
 */
router.delete('/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Inappropriate content policy violation' } = req.body || {};

    const video = await Video.findOne({
      $or: [
        { id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    const previousValues = {
      isRemovedByAdmin: video.isRemovedByAdmin,
      isPublished: video.isPublished,
      adminRemovalReason: video.adminRemovalReason,
    };

    video.isRemovedByAdmin = true;
    video.isPublished = false;
    video.adminRemovalReason = reason;
    await video.save();

    await recordAuditLog({
      admin: req.user,
      action: 'VIDEO_REMOVE',
      targetType: 'video',
      targetId: video.id,
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      previousValues,
      newValues: {
        isRemovedByAdmin: true,
        isPublished: false,
        adminRemovalReason: reason,
      },
    });

    return res.json({
      success: true,
      message: 'Video content has been taken down by administrator. Physical file preserved.',
      video: {
        id: video.id,
        title: video.title,
        isRemovedByAdmin: true,
        adminRemovalReason: reason,
      },
    });
  } catch (err) {
    console.error('[/api/admin/videos/:id DELETE Error]', err);
    return res.status(500).json({ error: 'Failed to perform administrative video takedown.' });
  }
});

/**
 * POST /api/admin/videos/:id/retry-transcode
 * Retry failed video transcoding pipeline via background transcodeQueue.
 */
router.post('/videos/:id/retry-transcode', async (req, res) => {
  try {
    const { id } = req.params;

    const video = await Video.findOne({
      $or: [
        { id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    // Find existing TranscodeJob or check storagePath
    let job = await TranscodeJob.findOne({ videoId: video.id });

    if (!job && video.storagePath) {
      // Re-create job record if missing
      job = await TranscodeJob.create({
        jobId: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        videoId: video.id,
        sourcePath: video.storagePath,
        status: 'queued',
        progress: 0,
        attempts: 0,
        maxAttempts: 3,
      });
    }

    if (!job) {
      return res.status(400).json({
        error: 'Cannot retry transcoding: No transcoding job or source file found for this video.',
      });
    }

    // Reset job state
    job.status = 'queued';
    job.attempts = 0;
    job.errorMessage = '';
    job.startedAt = null;
    job.completedAt = null;
    await job.save();

    // Reset video state
    video.processingStatus = 'queued';
    video.processingError = '';
    video.transcodingRetries = (video.transcodingRetries || 0) + 1;
    await video.save();

    // Enqueue in background transcode queue
    transcodeQueue.enqueue(job.jobId);

    await recordAuditLog({
      admin: req.user,
      action: 'VIDEO_RETRY_TRANSCODE',
      targetType: 'video',
      targetId: video.id,
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      newValues: { jobId: job.jobId, status: 'queued' },
    });

    return res.json({
      success: true,
      message: `Transcoding job ${job.jobId} re-enqueued successfully.`,
      job: {
        jobId: job.jobId,
        videoId: video.id,
        status: job.status,
      },
    });
  } catch (err) {
    console.error('[/api/admin/videos/:id/retry-transcode Error]', err);
    return res.status(500).json({ error: 'Failed to re-enqueue transcoding job.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 5: Comment Moderation Dashboard & Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/moderation/comments
 * Queue of reported and flagged comments.
 */
router.get('/moderation/comments', async (req, res) => {
  try {
    const { status = 'flagged', page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status !== 'all') {
      filter.moderationStatus = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [comments, total] = await Promise.all([
      Comment.find(filter)
        .sort({ reportCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Comment.countDocuments(filter),
    ]);

    const commentIds = comments.map(c => c._id);
    const reports = await CommentReport.find({ commentId: { $in: commentIds } })
      .populate('reportedBy', 'name email')
      .lean();

    const reportsByComment = {};
    for (const r of reports) {
      const cid = r.commentId.toString();
      if (!reportsByComment[cid]) reportsByComment[cid] = [];
      reportsByComment[cid].push({
        id: r._id.toString(),
        reason: r.reason,
        details: r.details,
        reportedBy: r.reportedBy ? { name: r.reportedBy.name, email: r.reportedBy.email } : null,
        status: r.status,
        createdAt: r.createdAt,
      });
    }

    const queue = comments.map(c => ({
      ...c,
      id: c._id.toString(),
      reports: reportsByComment[c._id.toString()] || [],
    }));

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      comments: queue,
    });
  } catch (err) {
    console.error('[/api/admin/moderation/comments Error]', err);
    return res.status(500).json({ error: 'Failed to load moderation review queue.' });
  }
});

/**
 * POST /api/admin/moderation/comments/:commentId/resolve
 * Moderation action: approve, reject, delete.
 */
router.post('/moderation/comments/:commentId/resolve', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { action, note = '' } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.', code: 'INVALID_ID' });
    }

    const validActions = ['approve', 'reject', 'delete'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({
        error: `Invalid moderation action. Must be one of: ${validActions.join(', ')}`,
        code: 'INVALID_ACTION',
      });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.', code: 'NOT_FOUND' });
    }

    const previousStatus = comment.moderationStatus;

    if (action === 'delete') {
      await Comment.deleteMany({
        $or: [{ _id: commentId }, { parentId: commentId }],
      });
    } else {
      comment.moderationStatus = action === 'approve' ? 'approved' : 'rejected';
      comment.moderationReason = note || `Resolved by admin: ${action}`;
      await comment.save();
    }

    const reportStatus = action === 'delete' ? 'action_taken' : action === 'approve' ? 'dismissed' : 'action_taken';
    await CommentReport.updateMany(
      { commentId, status: 'pending' },
      {
        $set: {
          status: reportStatus,
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
          adminNote: note || `Admin resolution: ${action}`,
        },
      }
    );

    // Record audit log
    await recordAuditLog({
      admin: req.user,
      action: action === 'approve' ? 'COMMENT_APPROVE' : action === 'reject' ? 'COMMENT_REJECT' : 'COMMENT_DELETE',
      targetType: 'comment',
      targetId: commentId,
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      previousValues: { status: previousStatus },
      newValues: { action, note, reportStatus },
    });

    return res.json({
      success: true,
      action,
      commentId,
      message: `Comment moderation resolved: ${action}.`,
    });
  } catch (err) {
    console.error('[/api/admin/moderation/comments/:commentId/resolve Error]', err);
    return res.status(500).json({ error: 'Failed to resolve comment moderation.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 6: Payment & Subscription Analytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/analytics
 * Comprehensive financial and subscription metrics.
 */
router.get('/payments/analytics', async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalRevenueAgg,
      monthlyRevenueAgg,
      yearlyRevenueAgg,
      revenueByTierAgg,
      paymentStatusesAgg,
      disputedPayments,
      expiringSubscriptionsCount,
    ] = await Promise.all([
      // Total captured revenue
      Payment.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // 30d revenue
      Payment.aggregate([
        { $match: { status: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // 365d revenue
      Payment.aggregate([
        { $match: { status: 'paid', createdAt: { $gte: oneYearAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Revenue by subscription tier
      Payment.aggregate([
        { $match: { status: 'paid' } },
        {
          $group: {
            _id: '$tier',
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Payment statuses count
      Payment.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
      ]),
      // Disputed payments list
      Payment.find({ status: 'disputed' })
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      // Subscriptions expiring within next 7 days
      User.countDocuments({
        subscriptionTier: { $in: ['bronze', 'silver', 'gold', 'premium', 'vip'] },
        subscriptionExpiresAt: { $gte: now, $lte: inSevenDays },
      }),
    ]);

    const totalRevenue = (totalRevenueAgg[0]?.total || 0) / 100;
    const monthlyRevenue = (monthlyRevenueAgg[0]?.total || 0) / 100;
    const yearlyRevenue = (yearlyRevenueAgg[0]?.total || 0) / 100;

    const tierBreakdown = {};
    for (const item of revenueByTierAgg) {
      tierBreakdown[item._id] = {
        count: item.count,
        revenue: item.totalAmount / 100,
      };
    }

    const statusCounts = {};
    for (const item of paymentStatusesAgg) {
      statusCounts[item._id] = {
        count: item.count,
        amount: item.amount / 100,
      };
    }

    return res.json({
      success: true,
      analytics: {
        currency: 'INR',
        revenue: {
          total: totalRevenue,
          monthly: monthlyRevenue,
          yearly: yearlyRevenue,
        },
        tierBreakdown,
        statusCounts,
        disputes: {
          count: disputedPayments.length,
          recent: disputedPayments.map(dp => ({
            id: dp._id.toString(),
            orderId: dp.razorpayOrderId,
            amount: dp.amount / 100,
            userEmail: dp.userId?.email || 'N/A',
            disputeDetails: dp.disputeDetails,
            createdAt: dp.createdAt,
          })),
        },
        expiringSubscriptionsNext7Days: expiringSubscriptionsCount,
      },
    });
  } catch (err) {
    console.error('[/api/admin/payments/analytics Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve payment analytics.' });
  }
});

/**
 * GET /api/admin/payments/invoices
 * Paginated invoice lookup.
 */
router.get('/payments/invoices', async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    const filter = { status: 'paid' };

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { invoiceNumber: regex },
        { razorpayOrderId: regex },
        { razorpayPaymentId: regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('userId', 'name email')
        .lean(),
      Payment.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      invoices: payments.map(p => ({
        id: p._id.toString(),
        invoiceNumber: p.invoiceNumber || `INV-${p._id.toString().slice(-8).toUpperCase()}`,
        orderId: p.razorpayOrderId,
        paymentId: p.razorpayPaymentId,
        user: p.userId ? { name: p.userId.name, email: p.userId.email } : null,
        tier: p.tier,
        billingCycle: p.billingCycle,
        amount: p.amount / 100,
        currency: p.currency,
        createdAt: p.createdAt,
        invoicePdfUrl: `/api/payments/invoice/${p._id.toString()}`,
      })),
    });
  } catch (err) {
    console.error('[/api/admin/payments/invoices Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve invoices.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 7: Platform Analytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/analytics/platform
 * Detailed user activity trends, top viewed & downloaded videos, bandwidth estimates.
 */
router.get('/analytics/platform', async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      dauUserIds,
      wauUserIds,
      mauUserIds,
      allVideos,
      topDownloadedAgg,
      categoryDistributionAgg,
      bandwidthAgg,
      registrationsTrendAgg,
    ] = await Promise.all([
      User.countDocuments(),
      LoginHistory.distinct('userId', { timestamp: { $gte: oneDayAgo } }),
      LoginHistory.distinct('userId', { timestamp: { $gte: sevenDaysAgo } }),
      LoginHistory.distinct('userId', { timestamp: { $gte: thirtyDaysAgo } }),
      Video.find({}, 'id title channel category views thumbnailUrl fileSize').lean(),
      Download.aggregate([
        { $match: { status: 'completed' } },
        {
          $group: {
            _id: '$videoId',
            videoTitle: { $first: '$videoTitle' },
            channelName: { $first: '$channelName' },
            downloadCount: { $sum: 1 },
          },
        },
        { $sort: { downloadCount: -1 } },
        { $limit: 10 },
      ]),
      Video.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Download.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, totalBytes: { $sum: '$fileSize' } } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: fourteenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Format top viewed videos
    const sortedByViews = [...allVideos]
      .sort((a, b) => parseViewsNum(b.views) - parseViewsNum(a.views))
      .slice(0, 10)
      .map(v => ({
        id: v.id,
        title: v.title,
        channel: v.channel?.name || 'Unknown Channel',
        views: v.views,
        viewsCount: parseViewsNum(v.views),
        category: v.category,
        thumbnailUrl: v.thumbnailUrl,
      }));

    let dau = Math.max(dauUserIds.length, totalUsers > 0 ? 1 : 0);
    let wau = Math.max(wauUserIds.length, dau);
    let mau = Math.max(mauUserIds.length, wau);

    const totalDownloadBytes = bandwidthAgg[0]?.totalBytes || 0;
    const totalVideoStorageBytes = allVideos.reduce((acc, v) => acc + (v.fileSize || 0), 0);

    return res.json({
      success: true,
      platform: {
        activity: {
          dau,
          wau,
          mau,
          totalUsers,
        },
        topViewedVideos: sortedByViews,
        topDownloadedVideos: topDownloadedAgg.map(d => ({
          videoId: d._id,
          videoTitle: d.videoTitle || 'Untitled Video',
          channelName: d.channelName || 'VideoVerse Creator',
          downloads: d.downloadCount,
        })),
        categoryDistribution: categoryDistributionAgg.map(c => ({
          category: c._id || 'Uncategorized',
          count: c.count,
        })),
        bandwidth: {
          totalDownloadBytes,
          totalDownloadMB: Math.round(totalDownloadBytes / (1024 * 1024)),
          totalStorageBytes: totalVideoStorageBytes,
          totalStorageMB: Math.round(totalVideoStorageBytes / (1024 * 1024)),
        },
        userGrowthTrend: registrationsTrendAgg.map(r => ({
          date: r._id,
          newUsers: r.count,
        })),
      },
    });
  } catch (err) {
    console.error('[/api/admin/analytics/platform Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve platform analytics.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 8: Admin Audit Logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-logs
 * Paginated, searchable audit log trail.
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const { q, action, targetType, page = 1, limit = 25 } = req.query;

    const filter = {};

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { adminEmail: regex },
        { action: regex },
        { targetId: regex },
        { errorMessage: regex },
      ];
    }

    if (action) {
      filter.action = action;
    }

    if (targetType) {
      filter.targetType = targetType;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AdminAuditLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      logs: logs.map(l => ({
        id: l._id.toString(),
        adminId: l.adminId.toString(),
        adminEmail: l.adminEmail,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        ipAddress: l.ipAddress,
        previousValues: l.previousValues,
        newValues: l.newValues,
        status: l.status,
        errorMessage: l.errorMessage,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    console.error('[/api/admin/audit-logs Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

module.exports = router;
