const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Video = require('../models/Video');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const {
  evaluateComment,
  detectLanguage,
  generateCaptchaChallenge,
  verifyCaptchaChallenge,
  checkCommentFlood,
  resetCommentFlood,
} = require('../utils/moderation');
const CommentReport = require('../models/CommentReport');
const { commentPostLimiter } = require('../middleware/rateLimiter');

// In-memory cache for comment translations (cacheKey: "commentId:target" -> response object)
const translationCache = new Map();
// In-flight translation promises to coalesce concurrent duplicate requests
const inFlightTranslations = new Map();

/**
 * GET /api/comments/challenge
 * Issues a mathematical CAPTCHA challenge for comment flood deterrence
 */
router.get('/comments/challenge', (req, res) => {
  const challenge = generateCaptchaChallenge();
  return res.json({ success: true, challenge });
});

/**
 * GET /api/comments/mention-search
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Securely searches users for autocomplete @mentions.
 * Security: Strictly projects public fields only (_id, name, username, avatarColor, initials).
 * Never exposes email, role, passwordHash, billing, or telemetry.
 */
router.get('/comments/mention-search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
      return res.json({ users: [] });
    }

    const sanitized = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${sanitized}`, 'i');
    const containsRegex = new RegExp(sanitized, 'i');

    const users = await User.find({
      isSuspended: { $ne: true },
      $or: [
        { username: regex },
        { name: regex },
        { name: containsRegex },
      ],
    })
      .select('_id name username avatarColor initials')
      .limit(8)
      .lean();

    const safeUsers = users.map(u => ({
      id: u._id.toString(),
      name: u.name,
      username: u.username || u.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      avatarColor: u.avatarColor || '#6c63ff',
      initials: u.initials || u.name.slice(0, 2).toUpperCase(),
    }));

    return res.json({ users: safeUsers });
  } catch (err) {
    console.error('[Mention Search Error]', err);
    return res.status(500).json({ error: 'Failed to search users for mentions.' });
  }
});

/**
 * GET /api/comments/notifications
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Returns real in-app notifications (mentions and replies) for the current user.
 */
router.get('/comments/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await Notification.find({ recipient: userId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });

    return res.json({
      unreadCount,
      notifications: notifications.map(n => ({
        id: n._id.toString(),
        type: n.type,
        senderName: n.senderName,
        senderInitials: n.senderInitials,
        senderColor: n.senderColor,
        videoId: n.videoId,
        videoTitle: n.videoTitle || 'Video',
        commentId: n.commentId ? n.commentId.toString() : null,
        commentText: n.commentText,
        isRead: !!n.isRead,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    console.error('[Get Notifications Error]', err);
    return res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

/**
 * PUT /api/comments/notifications/:id/read
 * Marks a single notification as read.
 */
router.put('/comments/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification ID format.' });
    }

    const notif = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.user._id },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notif) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    return res.json({ success: true, notificationId: id, isRead: true });
  } catch (err) {
    console.error('[Mark Read Error]', err);
    return res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
});

/**
 * PUT /api/comments/notifications/read-all
 * Marks all notifications for the user as read.
 */
router.put('/comments/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );

    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('[Mark All Read Error]', err);
    return res.status(500).json({ error: 'Failed to mark all notifications as read.' });
  }
});

/**
 * GET /api/videos/:videoId/comments
 *
 * Public access: Anyone (guest or authenticated) can view comments.
 * Filter: Only approved comments are shown. Flagged or rejected comments are never included.
 * Query:
 *   ?sort=top (default)  → sorts by likesCount desc, then createdAt desc
 *   ?sort=newest         → sorts by createdAt desc
 */
router.get('/videos/:videoId/comments', optionalAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { sort = 'top' } = req.query;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required.' });
    }

    let sortOption;
    if (sort === 'newest') {
      sortOption = { createdAt: -1 };
    } else if (sort === 'oldest') {
      sortOption = { createdAt: 1 };
    } else {
      sortOption = { likesCount: -1, createdAt: -1 };
    }

    // Resolve canonical video ID if valid
    const video = await Video.findOne({
      $or: [
        { id: videoId },
        ...(mongoose.Types.ObjectId.isValid(videoId) ? [{ _id: videoId }] : [])
      ]
    }).lean();

    const targetVideoId = video ? video.id : videoId;

    // Strict filter: only approved comments are public
    const filter = {
      videoId: targetVideoId,
      moderationStatus: 'approved',
    };

    const comments = await Comment.find(filter).sort(sortOption).lean();

    const currentUserId = req.user ? req.user._id : null;

    const safeComments = comments.map(doc => {
      const hasLiked = currentUserId && Array.isArray(doc.likedBy)
        ? doc.likedBy.some(id => id.toString() === currentUserId.toString())
        : false;
      const hasDisliked = currentUserId && Array.isArray(doc.dislikedBy)
        ? doc.dislikedBy.some(id => id.toString() === currentUserId.toString())
        : false;

      return {
        id: doc._id.toString(),
        userId: doc.userId ? doc.userId.toString() : null,
        videoId: doc.videoId,
        author: doc.author,
        authorInitials: doc.authorInitials,
        authorColor: doc.authorColor,
        text: doc.text,
        language: doc.language || 'en',
        likesCount: doc.likesCount || (doc.likedBy ? doc.likedBy.length : 0),
        dislikesCount: doc.dislikesCount || (doc.dislikedBy ? doc.dislikedBy.length : 0),
        hasLiked: !!hasLiked,
        hasDisliked: !!hasDisliked,
        isEdited: !!doc.isEdited,
        editedAt: doc.editedAt || null,
        isDeleted: !!doc.isDeleted,
        deletedAt: doc.deletedAt || null,
        location: doc.location || '',
        parentId: doc.parentId ? doc.parentId.toString() : null,
        mentions: Array.isArray(doc.mentions) ? doc.mentions.map(m => ({
          userId: m.userId ? m.userId.toString() : null,
          username: m.username || '',
          name: m.name || '',
        })) : [],
        createdAt: doc.createdAt,
        timeAgo: formatTimeAgo(doc.createdAt),
      };
    });

    // Organize into threaded hierarchy: top-level comments with nested replies
    const commentMap = new Map();
    const topLevelComments = [];

    safeComments.forEach(c => {
      c.replies = [];
      commentMap.set(c.id, c);
    });

    safeComments.forEach(c => {
      if (c.parentId && commentMap.has(c.parentId)) {
        const parent = commentMap.get(c.parentId);
        parent.replies.push(c);
      } else if (!c.parentId) {
        topLevelComments.push(c);
      } else {
        // Orphaned reply whose parent was hard-deleted or is absent:
        // Keep it visible as an active discussion item
        topLevelComments.push(c);
      }
    });

    // Ensure replies on each parent are sorted chronologically ascending
    topLevelComments.forEach(c => {
      if (Array.isArray(c.replies) && c.replies.length > 0) {
        c.replies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        c.repliesCount = c.replies.length;
      } else {
        c.repliesCount = 0;
      }
    });

    res.json({
      total: safeComments.length,
      comments: topLevelComments,
      allComments: safeComments,
    });
  } catch (err) {
    console.error('[Get Comments Error]', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * POST /api/videos/:videoId/comments
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Author identity: Derived EXCLUSIVELY from authenticated session (req.user).
 * Client-supplied author names, initials, and IDs are ignored.
 * Moderation:
 *   - Prohibited / severe content → rejected with HTTP 400.
 *   - Borderline / spam content  → saved as 'flagged', not visible in public feed, returns HTTP 201 with notice.
 *   - Clean content              → saved as 'approved', returns HTTP 201 with full comment object.
 */
router.post('/videos/:videoId/comments', requireAuth, commentPostLimiter, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { text, parentId, mentions: clientMentions } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required.' });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Comment text cannot be empty.' });
    }

    if (text.trim().length > 1000) {
      return res.status(400).json({ error: 'Comment cannot exceed 1000 characters.' });
    }

    // Validate parent comment if this is a reply
    let validatedParentId = null;
    let parentComment = null;
    if (parentId) {
      if (!mongoose.Types.ObjectId.isValid(parentId)) {
        return res.status(400).json({ error: 'Invalid parent comment ID format.', code: 'INVALID_PARENT_ID' });
      }
      parentComment = await Comment.findById(parentId);
      if (!parentComment) {
        return res.status(404).json({ error: 'Parent comment not found.', code: 'PARENT_NOT_FOUND' });
      }
      // Ensure parent comment belongs to the same video
      const parentVideoId = parentComment.videoId;
      const targetVideo = await Video.findOne({
        $or: [
          { id: videoId },
          ...(mongoose.Types.ObjectId.isValid(videoId) ? [{ _id: videoId }] : [])
        ]
      });
      if (targetVideo && parentVideoId !== targetVideo.id) {
        return res.status(400).json({ error: 'Parent comment does not belong to this video.', code: 'VIDEO_MISMATCH' });
      }
      validatedParentId = parentComment._id;
    }

    // 1. CAPTCHA verification if challenge token provided or flooding detected
    const { challengeToken, challengeAnswer } = req.body;
    if (challengeToken) {
      const isValidChallenge = verifyCaptchaChallenge(challengeToken, challengeAnswer);
      if (!isValidChallenge) {
        return res.status(400).json({
          error: 'Security challenge failed or expired. Please solve the new challenge.',
          code: 'CHALLENGE_FAILED',
          requiresChallenge: true,
          challenge: generateCaptchaChallenge(),
        });
      }
      resetCommentFlood(req.user._id);
    } else {
      // Check flood frequency: > 3 comments within 60s requires CAPTCHA challenge
      const floodCheck = checkCommentFlood(req.user._id, 3, 60000);
      if (floodCheck.isFlooding) {
        return res.status(429).json({
          error: 'You are posting comments too quickly. Please solve the security challenge to continue.',
          code: 'CHALLENGE_REQUIRED',
          requiresChallenge: true,
          challenge: generateCaptchaChallenge(),
        });
      }
    }

    // 2. Duplicate comment detection: identical comment by same user within 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingDuplicate = await Comment.findOne({
      userId: req.user._id,
      text: text.trim(),
      createdAt: { $gt: fiveMinutesAgo },
    });
    if (existingDuplicate) {
      return res.status(400).json({
        error: 'Duplicate comment detected. You have already posted this identical comment recently.',
        code: 'DUPLICATE_COMMENT',
      });
    }

    // Verify video exists
    const videoExists = await Video.findOne({
      $or: [
        { id: videoId },
        ...(mongoose.Types.ObjectId.isValid(videoId) ? [{ _id: videoId }] : [])
      ]
    });
    if (!videoExists) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    // Evaluate text using Option A Moderation
    const moderationResult = evaluateComment(text);

    // Severe prohibited content: reject outright
    if (moderationResult.status === 'rejected') {
      return res.status(400).json({
        error: moderationResult.reason,
        code: 'MODERATION_REJECTED',
      });
    }

    // 3. Resolve and deduplicate @mentions
    // Extract mentions from text (e.g. @alice or @john_doe)
    const mentionRegex = /@([a-zA-Z0-9_]{2,30})/g;
    const extractedHandles = new Set();
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      extractedHandles.add(match[1].toLowerCase());
    }

    // Look up mentioned users from database
    const handleArray = Array.from(extractedHandles);
    let resolvedUsers = [];
    if (handleArray.length > 0) {
      resolvedUsers = await User.find({
        isSuspended: { $ne: true },
        $or: [
          { username: { $in: handleArray } },
          { name: { $in: handleArray.map(h => new RegExp(`^${h.replace(/_/g, ' ')}$`, 'i')) } },
        ]
      }).select('_id name username').lean();
    }

    // Combine with any explicitly supplied client mentions (validating they exist)
    if (Array.isArray(clientMentions) && clientMentions.length > 0) {
      const explicitIds = clientMentions
        .map(m => m.userId || m.id)
        .filter(id => mongoose.Types.ObjectId.isValid(id));
      if (explicitIds.length > 0) {
        const explicitUsers = await User.find({
          _id: { $in: explicitIds },
          isSuspended: { $ne: true },
        }).select('_id name username').lean();
        resolvedUsers = [...resolvedUsers, ...explicitUsers];
      }
    }

    // Deduplicate mentioned users by user ID
    const uniqueMentionsMap = new Map();
    for (const u of resolvedUsers) {
      const uIdStr = u._id.toString();
      if (!uniqueMentionsMap.has(uIdStr)) {
        uniqueMentionsMap.set(uIdStr, {
          userId: u._id,
          username: u.username || u.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
          name: u.name,
        });
      }
    }
    const finalMentions = Array.from(uniqueMentionsMap.values());

    // Derive author identity strictly from authenticated user session
    const newComment = new Comment({
      videoId: videoExists.id,
      userId: req.user._id,
      author: req.user.name,
      authorInitials: req.user.initials,
      authorColor: req.user.avatarColor,
      text: text.trim(),
      language: moderationResult.language || 'en',
      parentId: validatedParentId,
      mentions: finalMentions,
      moderationStatus: moderationResult.status, // 'approved' or 'flagged'
      moderationReason: moderationResult.reason || '',
      likedBy: [],
      likesCount: 0,
    });

    await newComment.save();

    // 4. Create in-app notifications if comment is approved
    if (moderationResult.status === 'approved') {
      const senderIdStr = req.user._id.toString();

      // Mention Notifications: Notify each mentioned user (skipping self-mentions)
      for (const m of finalMentions) {
        const recipientIdStr = m.userId.toString();
        if (recipientIdStr !== senderIdStr) {
          try {
            await Notification.create({
              recipient: m.userId,
              sender: req.user._id,
              senderName: req.user.name,
              senderInitials: req.user.initials,
              senderColor: req.user.avatarColor,
              type: 'mention',
              videoId: videoExists.id,
              videoTitle: videoExists.title || '',
              commentId: newComment._id,
              commentText: newComment.text.slice(0, 150),
            });
          } catch (notifErr) {
            // Unique index prevents duplicate notifications; ignore duplicate key errors
            if (notifErr.code !== 11000) {
              console.warn('[Notification Create Error]', notifErr.message);
            }
          }
        }
      }

      // Reply Notification: If replying to a parent comment, notify parent author
      if (parentComment && parentComment.userId) {
        const parentAuthorIdStr = parentComment.userId.toString();
        // Do not notify if replying to own comment or already notified via mention
        if (parentAuthorIdStr !== senderIdStr && !uniqueMentionsMap.has(parentAuthorIdStr)) {
          try {
            await Notification.create({
              recipient: parentComment.userId,
              sender: req.user._id,
              senderName: req.user.name,
              senderInitials: req.user.initials,
              senderColor: req.user.avatarColor,
              type: 'reply',
              videoId: videoExists.id,
              videoTitle: videoExists.title || '',
              commentId: newComment._id,
              commentText: newComment.text.slice(0, 150),
            });
          } catch (replyNotifErr) {
            if (replyNotifErr.code !== 11000) {
              console.warn('[Reply Notification Create Error]', replyNotifErr.message);
            }
          }
        }
      }
    }

    // If flagged, it is saved for review and will NOT appear in public feed
    if (moderationResult.status === 'flagged') {
      return res.status(201).json({
        flagged: true,
        message: 'Your comment was submitted and is pending automated review before appearing publicly.',
        comment: {
          id: newComment._id.toString(),
          moderationStatus: 'flagged',
        },
      });
    }

    // Approved comment: return safe object for immediate display
    res.status(201).json({
      flagged: false,
      comment: newComment.toSafeObject(req.user._id),
    });
  } catch (err) {
    console.error('[Post Comment Error]', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

/**
 * PUT /api/comments/:commentId/like
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Concurrency-safe atomic toggle:
 * - Uses atomic findOneAndUpdate with conditional filter
 * - Prevents duplicate likes from the same user even under simultaneous requests
 * - Verifies the resulting count
 */
router.put('/comments/:commentId/like', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { action } = req.body || {}; // optional 'like' | 'unlike' | 'toggle'

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.' });
    }

    const userId = req.user._id;

    // Check if comment exists
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    let updatedDoc;
    const isCurrentlyLiked = Array.isArray(comment.likedBy) &&
      comment.likedBy.some(id => id.toString() === userId.toString());

    if (action === 'like') {
      if (isCurrentlyLiked) {
        return res.json({
          liked: true,
          likesCount: comment.likedBy.length,
          commentId: comment._id.toString(),
        });
      }
      updatedDoc = await Comment.findOneAndUpdate(
        { _id: commentId, likedBy: { $ne: userId } },
        { $addToSet: { likedBy: userId } },
        { new: true }
      );
    } else if (action === 'unlike') {
      if (!isCurrentlyLiked) {
        return res.json({
          liked: false,
          likesCount: comment.likedBy ? comment.likedBy.length : 0,
          commentId: comment._id.toString(),
        });
      }
      updatedDoc = await Comment.findOneAndUpdate(
        { _id: commentId, likedBy: userId },
        { $pull: { likedBy: userId } },
        { new: true }
      );
    } else {
      // Toggle mode: atomic conditional toggle
      if (!isCurrentlyLiked) {
        updatedDoc = await Comment.findOneAndUpdate(
          { _id: commentId, likedBy: { $ne: userId } },
          { $addToSet: { likedBy: userId } },
          { new: true }
        );
      } else {
        updatedDoc = await Comment.findOneAndUpdate(
          { _id: commentId, likedBy: userId },
          { $pull: { likedBy: userId } },
          { new: true }
        );
      }
    }

    if (!updatedDoc) {
      updatedDoc = await Comment.findById(commentId);
    }

    // Re-verify exact count consistency with likedBy array length
    const actualCount = updatedDoc.likedBy ? updatedDoc.likedBy.length : 0;
    if (updatedDoc.likesCount !== actualCount) {
      await Comment.updateOne({ _id: commentId }, { $set: { likesCount: actualCount } });
    }

    const hasLiked = updatedDoc.likedBy
      ? updatedDoc.likedBy.some(id => id.toString() === userId.toString())
      : false;

    return res.json({
      liked: hasLiked,
      likesCount: actualCount,
      commentId: updatedDoc._id.toString(),
    });
  } catch (err) {
    console.error('[Like Comment Error]', err);
    res.status(500).json({ error: 'Failed to update like status' });
  }
});

/**
 * PUT /api/comments/:commentId/dislike
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Concurrency-safe atomic toggle for comment dislikes.
 */
router.put('/comments/:commentId/dislike', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { action } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.' });
    }

    let updatedDoc;
    if (action === 'undislike') {
      updatedDoc = await Comment.findOneAndUpdate(
        { _id: commentId, dislikedBy: userId },
        { $pull: { dislikedBy: userId } },
        { new: true }
      );
    } else {
      updatedDoc = await Comment.findOneAndUpdate(
        { _id: commentId, dislikedBy: { $ne: userId } },
        {
          $addToSet: { dislikedBy: userId },
          $pull: { likedBy: userId }
        },
        { new: true }
      );
    }

    if (!updatedDoc) {
      updatedDoc = await Comment.findById(commentId);
    }

    const actualDislikes = updatedDoc.dislikedBy ? updatedDoc.dislikedBy.length : 0;
    const actualLikes = updatedDoc.likedBy ? updatedDoc.likedBy.length : 0;

    await Comment.updateOne(
      { _id: commentId },
      { $set: { dislikesCount: actualDislikes, likesCount: actualLikes } }
    );

    const hasDisliked = updatedDoc.dislikedBy
      ? updatedDoc.dislikedBy.some(id => id.toString() === userId.toString())
      : false;
    const hasLiked = updatedDoc.likedBy
      ? updatedDoc.likedBy.some(id => id.toString() === userId.toString())
      : false;

    return res.json({
      disliked: hasDisliked,
      dislikesCount: actualDislikes,
      liked: hasLiked,
      likesCount: actualLikes,
      commentId: updatedDoc._id.toString(),
    });
  } catch (err) {
    console.error('[Dislike Comment Error]', err);
    return res.status(500).json({ error: 'Failed to update dislike status.' });
  }
});

/**
 * PUT /api/comments/:commentId
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Ownership: User can only edit their own comments.
 * Moderation: Evaluates updated text before committing.
 */
router.put('/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { text } = req.body;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.' });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Comment text cannot be empty.' });
    }

    if (text.trim().length > 1000) {
      return res.status(400).json({ error: 'Comment cannot exceed 1000 characters.' });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    // Ownership and 15-minute window check
    const isAuthor = comment.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ error: 'You are not authorized to edit this comment.' });
    }

    if (!isAdmin) {
      const elapsedMs = Date.now() - new Date(comment.createdAt).getTime();
      if (elapsedMs > 15 * 60 * 1000) {
        return res.status(403).json({
          error: 'Comments can only be edited within 15 minutes of posting.',
          code: 'TIME_LIMIT_EXCEEDED',
          elapsedMinutes: Math.floor(elapsedMs / 60000),
        });
      }
    }

    // Moderation evaluation
    const moderationResult = evaluateComment(text);
    if (moderationResult.status === 'rejected') {
      return res.status(400).json({
        error: moderationResult.reason,
        code: 'MODERATION_REJECTED',
      });
    }

    comment.text = text.trim();
    comment.language = moderationResult.language || 'en';
    comment.moderationStatus = moderationResult.status;
    comment.moderationReason = moderationResult.reason || '';
    comment.isEdited = true;
    comment.editedAt = new Date();

    // Re-evaluate mentions on edit
    const mentionRegex = /@([a-zA-Z0-9_]{2,30})/g;
    const extractedHandles = new Set();
    let mMatch;
    while ((mMatch = mentionRegex.exec(text)) !== null) {
      extractedHandles.add(mMatch[1].toLowerCase());
    }

    if (extractedHandles.size > 0) {
      const handleArray = Array.from(extractedHandles);
      const mentionedUsers = await User.find({
        isSuspended: { $ne: true },
        $or: [
          { username: { $in: handleArray } },
          { name: { $in: handleArray.map(h => new RegExp(`^${h.replace(/_/g, ' ')}$`, 'i')) } },
        ]
      }).select('_id name username').lean();

      const newMentionsMap = new Map();
      mentionedUsers.forEach(u => {
        newMentionsMap.set(u._id.toString(), {
          userId: u._id,
          username: u.username || u.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
          name: u.name,
        });
      });
      comment.mentions = Array.from(newMentionsMap.values());

      // If approved, notify newly mentioned users
      if (moderationResult.status === 'approved') {
        const senderIdStr = req.user._id.toString();
        for (const m of comment.mentions) {
          const recIdStr = m.userId.toString();
          if (recIdStr !== senderIdStr) {
            try {
              await Notification.create({
                recipient: m.userId,
                sender: req.user._id,
                senderName: req.user.name,
                senderInitials: req.user.initials,
                senderColor: req.user.avatarColor,
                type: 'mention',
                videoId: comment.videoId,
                commentId: comment._id,
                commentText: comment.text.slice(0, 150),
              });
            } catch (nErr) {
              // Ignore duplicate notifications
            }
          }
        }
      }
    }

    await comment.save();

    return res.json({
      success: true,
      message: moderationResult.status === 'flagged'
        ? 'Comment updated and pending automated review.'
        : 'Comment updated successfully.',
      comment: comment.toSafeObject(req.user._id),
    });
  } catch (err) {
    console.error('[Edit Comment Error]', err);
    return res.status(500).json({ error: 'Failed to edit comment.' });
  }
});

/**
 * DELETE /api/comments/:commentId
 *
 * Protected access: Requires authenticated user (requireAuth).
 * Ownership: User can only delete their own comments.
 */
router.delete('/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.' });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    // Ownership and 15-minute window check: author within 15 mins or admin anytime
    const isAuthor = comment.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ error: 'You are not authorized to delete this comment.' });
    }

    if (!isAdmin) {
      const elapsedMs = Date.now() - new Date(comment.createdAt).getTime();
      if (elapsedMs > 15 * 60 * 1000) {
        return res.status(403).json({
          error: 'Comments can only be deleted within 15 minutes of posting.',
          code: 'TIME_LIMIT_EXCEEDED',
          elapsedMinutes: Math.floor(elapsedMs / 60000),
        });
      }
    }

    // Check if this comment has existing replies
    const existingRepliesCount = await Comment.countDocuments({
      parentId: commentId,
      moderationStatus: 'approved',
    });

    if (existingRepliesCount > 0) {
      // Soft-delete to preserve reply thread continuity
      comment.isDeleted = true;
      comment.deletedAt = new Date();
      comment.text = '[This comment has been deleted]';
      comment.author = '[Deleted]';
      comment.authorInitials = 'D';
      comment.authorColor = '#666666';
      await comment.save();

      // Clean up notifications pointing to this deleted comment
      await Notification.deleteMany({ commentId });

      return res.json({
        success: true,
        message: 'Comment deleted successfully.',
        deletedCommentId: commentId,
        softDeleted: true,
      });
    }

    // No replies: hard-delete comment and remove any pending reports/notifications
    await Comment.findByIdAndDelete(commentId);
    await Notification.deleteMany({ commentId });
    await CommentReport.deleteMany({ commentId });

    return res.json({
      success: true,
      message: 'Comment deleted successfully.',
      deletedCommentId: commentId,
    });
  } catch (err) {
    console.error('[Delete Comment Error]', err);
    return res.status(500).json({ error: 'Failed to delete comment.' });
  }
});

// Scoped dictionary for high-frequency Hinglish and colloquial phrases
const HINGLISH_DICTIONARY = {
  'bahut badhiya': 'Very good',
  'bahut badhiya video': 'Very good video',
  'bahut accha': 'Very good',
  'bahut accha video': 'Very good video',
  'kya haal hai': 'How are you?',
  'kya hal hai': 'How are you?',
  'kya baat hai': 'Awesome!',
  'shukriya bhai': 'Thank you brother',
  'shukriya': 'Thank you',
  'dhanyawad': 'Thank you',
  'dhanyavaad': 'Thank you',
  'mast video': 'Awesome video',
  'mast hai': 'It is awesome',
  'ekdum mast': 'Completely awesome',
  'ekdum mast video': 'Completely awesome video',
  'zabardast video': 'Fantastic video',
  'shandar video': 'Splendid video',
  'zabardast': 'Fantastic',
  'shandar': 'Splendid',
  'gazab': 'Incredible',
  'lajawab': 'Unmatched',
  'maza aa gaya': 'Enjoyed it thoroughly',
  'bhai kya video hai': 'Brother, what an amazing video!',
  'kya video hai bhai': 'Brother, what an amazing video!',
  'kya video hai': 'What a video!',
  'yeh video bahut accha hai': 'This video is very good',
  'aapka video mast hai': 'Your video is awesome',
  'mujhe yeh bahut pasand aaya': 'I really liked this',
  // Devanagari Hindi phrases
  'बहुत बढ़िया': 'Very good',
  'बहुत अच्छा': 'Very good',
  'बहुत अच्छा वीडियो': 'Very good video',
  'नमस्ते': 'Hello',
  'क्या हाल है': 'How are you?',
  'शुक्रिया': 'Thank you',
  'शुक्रिया भाई': 'Thank you brother',
  'धन्यवाद': 'Thank you',
  'मस्त वीडियो': 'Awesome video',
  'कमाल का वीडियो': 'Wonderful video',
  'ज़बरदस्त': 'Fantastic',
  'शानदार': 'Splendid',
};

// Scoped dictionary for high-frequency Bengali (Banglish & Bengali script) phrases
const BENGALI_DICTIONARY = {
  'ami tomako': 'Incomplete phrase — more context needed',
  'ami tomake': 'Incomplete phrase — more context needed',
  'ami tomake bhalobashi': 'I love you',
  'ami tomake bhalobasi': 'I love you',
  'khub bhalo video': 'Very good video',
  'khub bhalo': 'Very good',
  'onek bhalo': 'Very good',
  'kemon acho': 'How are you?',
  'kemon achis': 'How are you?',
  'bhalo achi': 'I am fine',
  'dhonnobad': 'Thank you',
  'dhonnobaad': 'Thank you',
  'onek dhonnobad': 'Thank you very much',
  'ki khobor': 'How are you?',
  'shob thik ache': 'Everything is fine',
  'darun video': 'Awesome video',
  'darun': 'Awesome',
  'osadharon video': 'Extraordinary video',
  'osadharon': 'Extraordinary',
  'bhalo laglo': 'Liked it',
  // Bengali script
  'অনেক ধন্যবাদ': 'Thank you very much',
  'ধন্যবাদ': 'Thank you',
  'খুব ভালো': 'Very good',
  'খুব ভালো ভিডিও': 'Very good video',
  'দারুণ ভিডিও': 'Awesome video',
  'দারুণ': 'Awesome',
  'অসাধারণ': 'Extraordinary',
  'আমি তোমাকে ভালোবাসি': 'I love you',
  'আমি তোমাকে': 'Incomplete phrase — more context needed',
  'কেমন আছো': 'How are you?',
  'ভালো আছি': 'I am fine',
};

// Regional Indic & Portuguese phrases dictionary
const REGIONAL_INDIC_DICTIONARY = {
  ta: {
    'மிக்க நன்றி': 'Thank you very much',
    'நன்றி': 'Thank you',
    'ரொம்ப நல்லா இருக்கு': 'It is very good',
    'சூப்பர் வீடியோ': 'Super video',
    'romba nalla irukku': 'It is very good',
    'romba nalla iruku': 'It is very good',
    'mikka nandri': 'Thank you very much',
    'nandri': 'Thank you',
    'super video': 'Super video',
  },
  te: {
    'చాలా ధన్యవాదాలు': 'Thank you very much',
    'ధన్యవాదాలు': 'Thank you',
    'చాలా బాగుంది': 'It is very good',
    'సూపర్ వీడియో': 'Super video',
    'chala bagundi': 'It is very good',
    'chala dhanyavadalu': 'Thank you very much',
    'dhanyavadalu': 'Thank you',
  },
  ml: {
    'വളരെ നന്ദി': 'Thank you very much',
    'നന്ദി': 'Thank you',
    'വളരെ നല്ല വീഡിയോ': 'Very good video',
  },
  mr: {
    'खूप छान व्हिडिओ': 'Very nice video',
    'खूप छान': 'Very nice',
    'धन्यवाद': 'Thank you',
    'lay bhari': 'Super awesome',
    'khup chan video': 'Very nice video',
    'khup chan': 'Very nice',
  },
  gu: {
    'ખૂબ આભાર': 'Thank you very much',
    'આભાર': 'Thank you',
    'ખૂબ સરસ': 'Very nice',
    'ખૂબ સરસ વિડીયો': 'Very nice video',
  },
  pa: {
    'ਬਹੁਤ ਧੰਨਵਾਦ': 'Thank you very much',
    'ਬਹੁਤ ਵਧੀਆ': 'Very good',
    'ਧੰਨਵਾਦ': 'Thank you',
    'bahut vadiya': 'Very good',
    'bahut vadiya video': 'Very good video',
    'sat sri akal': 'Greetings / Hello',
  },
  pt: {
    'muito obrigado': 'Thank you very much',
    'muito obrigada': 'Thank you very much',
    'obrigado': 'Thank you',
    'obrigada': 'Thank you',
    'muito bom': 'Very good',
    'otimo video': 'Great video',
    'bom dia': 'Good morning',
    'boa tarde': 'Good afternoon',
    'boa noite': 'Good night',
    'tudo bem': 'Everything is good',
  },
};

// Common unaccented expressions fallback dictionary
const COMMON_PHRASES_DICTIONARY = {
  es: {
    'hola amigo': 'Hello friend',
    'hola amigos': 'Hello friends',
    'buenos dias': 'Good morning',
    'buenas tardes': 'Good afternoon',
    'buenas noches': 'Good evening',
    'muchas gracias': 'Thank you very much',
    'muchos gracias': 'Thank you very much',
    'de nada': "You're welcome",
    'por favor': 'Please',
  },
  fr: {
    'merci beaucoup': 'Thank you very much',
    'merci': 'Thank you',
    'bonjour a tous': 'Hello everyone',
    'bonjour': 'Hello',
    'de rien': "You're welcome",
  },
  de: {
    'guten tag': 'Good day / Hello',
    'guten morgen': 'Good morning',
    'guten abend': 'Good evening',
    'vielen dank': 'Thank you very much',
    'danke sehr': 'Thank you very much',
    'danke': 'Thank you',
  },
};

// Bengali normalization helper
function normalizeBengali(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(tomak[eo])\b/g, 'tomake')
    .replace(/\b(bhalobasi)\b/g, 'bhalobashi')
    .replace(/\b(dhonnobaad)\b/g, 'dhonnobad');
}

// Bengali transliteration map for Roman Bengali -> Bengali script
const BENGALI_TRANSLITERATION_MAP = {
  ami: 'আমি',
  tomake: 'তোমাকে',
  tomako: 'তোমাকে',
  bhalobashi: 'ভালোবাসি',
  bhalobasi: 'ভালোবাসি',
  khub: 'খুব',
  bhalo: 'ভালো',
  video: 'ভিডিও',
  onek: 'অনেক',
  kemon: 'কেমন',
  acho: 'আছো',
  achi: 'আছি',
  dhonnobad: 'ধন্যবাদ',
  darun: 'দারুণ',
  osadharon: 'অসাধারণ',
  shob: 'সব',
  thik: 'ঠিক',
  ache: 'আছে',
};

function transliterateBengali(text) {
  return text.replace(/\b([a-zA-Z]+)\b/g, (match, word) => {
    return BENGALI_TRANSLITERATION_MAP[word.toLowerCase()] || match;
  });
}

// Hinglish normalization helper
function normalizeHinglish(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(bhut|bohot|bhot)\b/g, 'bahut')
    .replace(/\b(badiya)\b/g, 'badhiya')
    .replace(/\b(achha|acha)\b/g, 'accha')
    .replace(/\b(ye)\b/g, 'yeh')
    .replace(/\b(apka)\b/g, 'aapka');
}

// Hinglish to Devanagari transliteration helper for calling MyMemory
const HINGLISH_TRANSLITERATION_MAP = {
  bahut: 'बहुत',
  bhut: 'बहुत',
  bohot: 'बहुत',
  bhot: 'बहुत',
  badhiya: 'बढ़िया',
  badiya: 'बढ़िया',
  accha: 'अच्छा',
  achha: 'अच्छा',
  acha: 'अच्छा',
  kya: 'क्या',
  haal: 'हाल',
  hal: 'हाल',
  hai: 'है',
  hain: 'हैं',
  bhai: 'भाई',
  shukriya: 'शुक्रिया',
  dhanyawad: 'धन्यवाद',
  dhanyavaad: 'धन्यवाद',
  video: 'वीडियो',
  aapka: 'आपका',
  apka: 'आपका',
  yeh: 'यह',
  ye: 'यह',
  woh: 'वह',
  wo: 'वह',
  zabardast: 'ज़बरदस्त',
  shandar: 'शानदार',
  dost: 'दोस्त',
  yaar: 'यार',
  pasand: 'पसंद',
  aaya: 'आया',
  kamaal: 'कमाल',
  sahi: 'सही',
  khoob: 'खूब',
  mast: 'मस्त',
};

function transliterateHinglish(text) {
  return text.replace(/\b([a-zA-Z]+)\b/g, (match, word) => {
    return HINGLISH_TRANSLITERATION_MAP[word.toLowerCase()] || match;
  });
}

/**
 * GET /api/comments/:commentId/translate
 *
 * Public access: Translate a comment into target language (default: 'en').
 * Graceful handling:
 *   - Re-evaluates source script/language dynamically on current text
 *   - Checks if legitimately already in target language
 *   - Uses curated dictionaries for Bengali, Hindi/Hinglish, Indic, and European phrases
 *   - Performs transliteration before remote translation when appropriate
 *   - Never returns fake or unchanged text as successful translation
 *   - Respects user privacy: only the single text string is sent over HTTPS to MyMemory
 */
/**
 * Helper to compute translation via dictionaries or external API
 */
async function computeCommentTranslation(sourceText, target) {
  // Re-evaluate language directly on sourceText as the authoritative source of truth
  const sourceLang = detectLanguage(sourceText);

  // If legitimately already in target language (genuine English comment targeting English)
  if (sourceLang === target) {
    return {
      translated: false,
      alreadyTargetLanguage: true,
      sourceLanguage: sourceLang,
      targetLanguage: target,
      message: `Comment is already in ${target === 'en' ? 'English' : target}.`,
    };
  }

  // 1. Check scoped Bengali dictionary (Roman Bengali & Bengali script)
  if (sourceLang === 'bn' && target === 'en') {
    const normBengali = normalizeBengali(sourceText);
    const dictMatch = BENGALI_DICTIONARY[normBengali] || BENGALI_DICTIONARY[sourceText];
    if (dictMatch) {
      return {
        translated: true,
        translatedText: dictMatch,
        sourceLanguage: 'bn',
        targetLanguage: 'en',
        provider: 'VideoVerse Bengali Dictionary',
        privacyNote: 'Comment processed locally. No user identifiable data or author information is shared.',
        limitations: 'Curated colloquial translation dictionary.',
      };
    }
  }

  // 2. Check scoped Hinglish / Hindi dictionary if source is Hindi targeting English
  if (sourceLang === 'hi' && target === 'en') {
    const normHinglish = normalizeHinglish(sourceText);
    const dictMatch = HINGLISH_DICTIONARY[normHinglish] || HINGLISH_DICTIONARY[sourceText];
    if (dictMatch) {
      return {
        translated: true,
        translatedText: dictMatch,
        sourceLanguage: 'hi',
        targetLanguage: 'en',
        provider: 'VideoVerse Hinglish Dictionary',
        privacyNote: 'Comment processed locally. No user identifiable data or author information is shared.',
        limitations: 'Curated colloquial translation dictionary.',
      };
    }
  }

  // 3. Check Regional Indic dictionary (Tamil, Telugu, Malayalam, Marathi, Gujarati, Punjabi, Portuguese)
  if (REGIONAL_INDIC_DICTIONARY[sourceLang] && target === 'en') {
    const normText = sourceText.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    const regionalMatch = REGIONAL_INDIC_DICTIONARY[sourceLang][normText] || REGIONAL_INDIC_DICTIONARY[sourceLang][sourceText];
    if (regionalMatch) {
      return {
        translated: true,
        translatedText: regionalMatch,
        sourceLanguage: sourceLang,
        targetLanguage: 'en',
        provider: 'VideoVerse Regional Dictionary',
        privacyNote: 'Comment processed locally. No user identifiable data or author information is shared.',
        limitations: 'Curated colloquial translation dictionary.',
      };
    }
  }

  // 4. Check common European unaccented phrase fallbacks
  if (COMMON_PHRASES_DICTIONARY[sourceLang] && target === 'en') {
    const normPhrase = sourceText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const phraseMatch = COMMON_PHRASES_DICTIONARY[sourceLang][normPhrase];
    if (phraseMatch) {
      return {
        translated: true,
        translatedText: phraseMatch,
        sourceLanguage: sourceLang,
        targetLanguage: 'en',
        provider: 'VideoVerse Phrase Dictionary',
        privacyNote: 'Comment processed locally. No user identifiable data or author information is shared.',
        limitations: 'Curated colloquial translation dictionary.',
      };
    }
  }

  // 5. Determine query string for remote translation
  let queryText = sourceText;
  if (sourceLang === 'hi' && !/[\u0900-\u097F]/.test(sourceText)) {
    queryText = transliterateHinglish(sourceText);
  } else if (sourceLang === 'bn' && !/[\u0980-\u09FF]/.test(sourceText)) {
    queryText = transliterateBengali(sourceText);
  }

  // Call external translation service with a strict timeout (4 seconds)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(queryText)}&langpair=${sourceLang}|${target}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!response.ok) {
      return {
        translated: false,
        error: 'Translation service is temporarily unavailable.',
      };
    }

    const data = await response.json();
    const rawTranslated = data.responseData?.translatedText;

    // Filter out quota warning messages and ensure authentic translation
    const isQuotaWarning = typeof rawTranslated === 'string' &&
      (rawTranslated.toUpperCase().includes('MYMEMORY WARNING') ||
       data.responseDetails?.toUpperCase().includes('MYMEMORY WARNING') ||
       data.responseStatus === 403 ||
       data.responseStatus === 429);

    if (
      !isQuotaWarning &&
      rawTranslated &&
      typeof rawTranslated === 'string' &&
      rawTranslated.trim() &&
      rawTranslated.trim().toLowerCase() !== sourceText.toLowerCase() &&
      rawTranslated.trim().toLowerCase() !== queryText.toLowerCase()
    ) {
      return {
        translated: true,
        translatedText: rawTranslated.trim(),
        sourceLanguage: sourceLang,
        targetLanguage: target,
        provider: 'MyMemory (Translated.net)',
        privacyNote: 'Comment snippet processed over HTTPS for translation via MyMemory API. No user identifiable data or author information is shared.',
        limitations: 'Free-tier public translation service subject to rate limits and community memory quality.',
      };
    } else {
      return {
        translated: false,
        error: isQuotaWarning
          ? 'Translation rate limit reached for today. Displaying original text.'
          : 'No reliable translation could be determined for this text.',
      };
    }
  } catch (networkErr) {
    console.warn('[Translation Service Network/Timeout]', networkErr.message);
    return {
      translated: false,
      error: 'Translation service timed out or is currently unreachable.',
    };
  }
}

/**
 * GET /api/comments/:commentId/translate
 *
 * Public access: Translate a comment into target language (default: 'en').
 * Graceful handling:
 *   - Re-evaluates source script/language dynamically on current text
 *   - Checks if legitimately already in target language
 *   - Uses curated dictionaries for Bengali, Hindi/Hinglish, Indic, and European phrases
 *   - Performs transliteration before remote translation when appropriate
 *   - In-memory cache + concurrent request coalescing
 *   - Never returns fake or unchanged text as successful translation
 *   - Respects user privacy: only the single text string is sent over HTTPS to MyMemory
 */
router.get('/comments/:commentId/translate', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { target = 'en' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.' });
    }

    const comment = await Comment.findById(commentId).lean();
    if (!comment || comment.moderationStatus !== 'approved') {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    const sourceText = comment.text.trim();
    const cacheKey = `${commentId}:${target}`;

    // 1. Return immediately from cache if available
    if (translationCache.has(cacheKey)) {
      return res.json({ ...translationCache.get(cacheKey), cached: true });
    }

    // 2. Coalesce concurrent identical requests using in-flight promise
    let translationPromise = inFlightTranslations.get(cacheKey);
    if (!translationPromise) {
      translationPromise = (async () => {
        try {
          const result = await computeCommentTranslation(sourceText, target);
          // Only cache positive results (not transient errors or rate limits)
          if (result && (result.translated || result.alreadyTargetLanguage)) {
            translationCache.set(cacheKey, result);
            // 1 hour TTL
            setTimeout(() => {
              translationCache.delete(cacheKey);
            }, 3600000);
          }
          return result;
        } finally {
          inFlightTranslations.delete(cacheKey);
        }
      })();
      inFlightTranslations.set(cacheKey, translationPromise);
    }

    const responseData = await translationPromise;
    return res.json(responseData);
  } catch (err) {
    console.error('[Translate Comment Error]', err);
    res.status(500).json({ error: 'Failed to process translation request.' });
  }
});

/**
 * Format timestamp into relative human-readable string
 */
function formatTimeAgo(date) {
  if (!date) return 'just now';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Moderation & Reporting Endpoints (Phase 2, Step 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/comments/:commentId/report
 *
 * Allows authenticated users to report inappropriate comments for administrator review.
 * Predefined reasons: spam, harassment, hate_speech, misinformation, offensive, other.
 * Edge cases handled:
 * - Duplicate report prevention (one report per user per comment)
 * - Flags comment for admin review rather than auto-deleting on reports
 * - Maintains complete audit record in CommentReport
 */
router.post('/comments/:commentId/report', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { reason, details } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID format.', code: 'INVALID_ID' });
    }

    const validReasons = ['spam', 'harassment', 'hate_speech', 'misinformation', 'offensive', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({
        error: `Please select a valid report reason: ${validReasons.join(', ')}`,
        code: 'INVALID_REASON',
      });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.', code: 'NOT_FOUND' });
    }

    // Check duplicate report by same user
    const existingReport = await CommentReport.findOne({
      commentId,
      reportedBy: req.user._id,
    });
    if (existingReport) {
      return res.status(409).json({
        error: 'You have already reported this comment. An administrator is reviewing it.',
        code: 'ALREADY_REPORTED',
      });
    }

    // Create report record
    const report = await CommentReport.create({
      commentId,
      videoId: comment.videoId,
      reportedBy: req.user._id,
      reason,
      details: details ? String(details).slice(0, 500) : '',
      status: 'pending',
    });

    // Increment comment report count and flag for review if currently approved
    const updateOps = { $inc: { reportCount: 1 } };
    if (comment.moderationStatus === 'approved') {
      updateOps.$set = {
        moderationStatus: 'flagged',
        moderationReason: `Reported by user for: ${reason}`,
      };
    }
    const updatedComment = await Comment.findByIdAndUpdate(commentId, updateOps, { returnDocument: 'after' });

    return res.status(201).json({
      success: true,
      message: 'Comment has been reported for administrator review.',
      reportId: report._id.toString(),
      reportCount: updatedComment.reportCount,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'You have already reported this comment.',
        code: 'ALREADY_REPORTED',
      });
    }
    console.error('[Report Comment Error]', err);
    return res.status(500).json({ error: 'Failed to report comment.' });
  }
});

/**
 * GET /api/admin/moderation/comments
 *
 * Admin only: Lists comments flagged or reported for review.
 * Query: ?status=flagged|pending|all&page=1&limit=20
 */
router.get('/admin/moderation/comments', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status = 'flagged', page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status !== 'all') {
      filter.moderationStatus = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const comments = await Comment.find(filter)
      .sort({ reportCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Comment.countDocuments(filter);

    // Fetch reports for these comments
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
      comments: queue,
    });
  } catch (err) {
    console.error('[Admin Moderation Queue Error]', err);
    return res.status(500).json({ error: 'Failed to load moderation review queue.' });
  }
});

/**
 * POST /api/admin/moderation/comments/:commentId/resolve
 *
 * Admin only: Resolves a reported/flagged comment.
 * Actions:
 * - 'approve': Approves comment, returning it to public feed. Dismisses pending reports.
 * - 'reject': Rejects comment, keeping it hidden from public feed. Action taken on reports.
 * - 'delete': Permanently deletes comment and associated replies. Action taken on reports.
 */
router.post('/admin/moderation/comments/:commentId/resolve', requireAuth, requireRole('admin'), async (req, res) => {
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

    if (action === 'delete') {
      await Comment.deleteMany({
        $or: [{ _id: commentId }, { parentId: commentId }],
      });
    } else {
      comment.moderationStatus = action === 'approve' ? 'approved' : 'rejected';
      comment.moderationReason = note || `Resolved by admin: ${action}`;
      await comment.save();
    }

    // Resolve all associated pending reports
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

    return res.json({
      success: true,
      action,
      commentId,
      message: `Comment moderation resolved: ${action}.`,
    });
  } catch (err) {
    console.error('[Admin Resolve Error]', err);
    return res.status(500).json({ error: 'Failed to resolve moderation action.' });
  }
});

module.exports = router;
