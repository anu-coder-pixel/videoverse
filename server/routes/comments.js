const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Video = require('../models/Video');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { evaluateComment, detectLanguage } = require('../utils/moderation');

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

    const sortOption = sort === 'newest'
      ? { createdAt: -1 }
      : { likesCount: -1, createdAt: -1 };

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

      return {
        id: doc._id.toString(),
        videoId: doc.videoId,
        author: doc.author,
        authorInitials: doc.authorInitials,
        authorColor: doc.authorColor,
        text: doc.text,
        language: doc.language || 'en',
        likesCount: doc.likesCount || (doc.likedBy ? doc.likedBy.length : 0),
        hasLiked: !!hasLiked,
        createdAt: doc.createdAt,
        timeAgo: formatTimeAgo(doc.createdAt),
      };
    });

    res.json({
      total: safeComments.length,
      comments: safeComments,
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
router.post('/videos/:videoId/comments', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { text } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required.' });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Comment text cannot be empty.' });
    }

    if (text.trim().length > 1000) {
      return res.status(400).json({ error: 'Comment cannot exceed 1000 characters.' });
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

    // Derive author identity strictly from authenticated user session
    const newComment = new Comment({
      videoId: videoExists.id,
      userId: req.user._id,
      author: req.user.name,
      authorInitials: req.user.initials,
      authorColor: req.user.avatarColor,
      text: text.trim(),
      language: moderationResult.language || 'en',
      moderationStatus: moderationResult.status, // 'approved' or 'flagged'
      moderationReason: moderationResult.reason || '',
      likedBy: [],
      likesCount: 0,
    });

    await newComment.save();

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
 * GET /api/comments/:commentId/translate
 *
 * Public access: Translate a comment into target language (default: 'en').
 * Graceful handling:
 *   - Detects source script/language
 *   - Checks if already in target language
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
    const sourceLang = comment.language || detectLanguage(sourceText);

    // If already in target language
    if (sourceLang === target) {
      return res.json({
        translated: false,
        alreadyTargetLanguage: true,
        sourceLanguage: sourceLang,
        targetLanguage: target,
        message: `Comment is already in ${target === 'en' ? 'English' : target}.`,
      });
    }

    // Call external translation service with a strict timeout (4 seconds)
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(sourceText)}&langpair=${sourceLang}|${target}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });

      if (!response.ok) {
        return res.json({
          translated: false,
          error: 'Translation service is temporarily unavailable.',
        });
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
        rawTranslated.trim().toLowerCase() !== sourceText.toLowerCase()
      ) {
        return res.json({
          translated: true,
          translatedText: rawTranslated.trim(),
          sourceLanguage: sourceLang,
          targetLanguage: target,
          provider: 'MyMemory (Translated.net)',
          privacyNote: 'Comment snippet processed over HTTPS for translation via MyMemory API. No user identifiable data or author information is shared.',
          limitations: 'Free-tier public translation service subject to rate limits and community memory quality.',
        });
      } else {
        return res.json({
          translated: false,
          error: isQuotaWarning
            ? 'Translation rate limit reached for today. Displaying original text.'
            : 'No reliable translation could be determined for this text.',
        });
      }
    } catch (networkErr) {
      console.warn('[Translation Service Network/Timeout]', networkErr.message);
      return res.json({
        translated: false,
        error: 'Translation service timed out or is currently unreachable.',
      });
    }
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

module.exports = router;
