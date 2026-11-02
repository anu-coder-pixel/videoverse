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
// Scoped dictionary for high-frequency Hinglish and colloquial phrases
const HINGLISH_DICTIONARY = {
  'bahut badhiya': 'Very good',
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
 *   - Uses curated dictionary for Hinglish & colloquial phrases
 *   - Performs transliteration before remote translation when appropriate
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

    // Re-evaluate language directly on sourceText to never blindly trust a stale stored value
    const freshDetected = detectLanguage(sourceText);
    const sourceLang = freshDetected !== 'en' ? freshDetected : (comment.language || 'en');

    // If legitimately already in target language (genuine English comment targeting English)
    if (sourceLang === target) {
      return res.json({
        translated: false,
        alreadyTargetLanguage: true,
        sourceLanguage: sourceLang,
        targetLanguage: target,
        message: `Comment is already in ${target === 'en' ? 'English' : target}.`,
      });
    }

    // 1. Check scoped Hinglish dictionary if source is Hindi/Hinglish targeting English
    if (sourceLang === 'hi' && target === 'en') {
      const normHinglish = normalizeHinglish(sourceText);
      const dictMatch = HINGLISH_DICTIONARY[normHinglish];
      if (dictMatch) {
        return res.json({
          translated: true,
          translatedText: dictMatch,
          sourceLanguage: 'hi',
          targetLanguage: 'en',
          provider: 'VideoVerse Hinglish Dictionary',
          privacyNote: 'Comment processed locally. No user identifiable data or author information is shared.',
          limitations: 'Curated colloquial translation dictionary.',
        });
      }
    }

    // 2. Check common European unaccented phrase fallbacks
    if (COMMON_PHRASES_DICTIONARY[sourceLang] && target === 'en') {
      const normPhrase = sourceText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      const phraseMatch = COMMON_PHRASES_DICTIONARY[sourceLang][normPhrase];
      if (phraseMatch) {
        return res.json({
          translated: true,
          translatedText: phraseMatch,
          sourceLanguage: sourceLang,
          targetLanguage: 'en',
          provider: 'VideoVerse Phrase Dictionary',
          privacyNote: 'Comment processed locally. No user identifiable data or author information is shared.',
          limitations: 'Curated colloquial translation dictionary.',
        });
      }
    }

    // 3. Determine query string for remote translation
    // If source is Latin Hindi, transliterate recognized tokens to Devanagari so MyMemory can translate accurately
    const isLatinHindi = sourceLang === 'hi' && !/[\u0900-\u097F]/.test(sourceText);
    const queryText = isLatinHindi ? transliterateHinglish(sourceText) : sourceText;

    // Call external translation service with a strict timeout (4 seconds)
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(queryText)}&langpair=${sourceLang}|${target}`;
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
        rawTranslated.trim().toLowerCase() !== sourceText.toLowerCase() &&
        rawTranslated.trim().toLowerCase() !== queryText.toLowerCase()
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
