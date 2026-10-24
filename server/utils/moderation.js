/**
 * Moderation and Language Utilities for VideoVerse
 *
 * Implements Option A:
 * 1. REJECT: Clearly severe prohibited content (hate speech, severe threats, dangerous scams).
 *    Result: { allowed: false, status: 'rejected', reason: '...' }
 * 2. FLAG: Borderline content (promotional spam, sub4sub, excessive repetition, borderline toxicity).
 *    Result: { allowed: true, status: 'flagged', reason: '...' }
 * 3. APPROVE: Standard safe, constructive, or multilingual user comments.
 *    Result: { allowed: true, status: 'approved', reason: '' }
 */

// Severe prohibited terms (normalized lowercase matching)
const SEVERE_PATTERNS = [
  /\bkill\s+your\s*self\b/i,
  /\bi\s+will\s+kill\s+you\b/i,
  /\b(bomb|terrorist|shoot\s+up)\s+(threat|attack|school|building)\b/i,
  /\b(nazi|hitler\s+was\s+right|white\s+supremac)\b/i,
  /\b(fag|faggot|nigger|nigga|kike|chink|spic)\b/i, // Explicit severe slurs
  /\b(child\s*porn|cp\s+links)\b/i,
  /(claim-crypto|free-bitcoin|airdrop-eth|click-to-claim)\.[\w.]+/i,
  /\b(hack\s+account|free\s+robux\s+generator|password\s+stealer)\b/i,
];

// Borderline / spam patterns (flagged for review, not rejected, hidden from public feed)
const BORDERLINE_PATTERNS = [
  /\b(sub4sub|sub\s*4\s*sub|subscribe\s+to\s+my\s+channel|check\s+out\s+my\s+channel)\b/i,
  /\b(earn\s+\$?\d+\s+(daily|weekly|a\s+day)|work\s+from\s+home\s+guaranteed)\b/i,
  /\b(whatsapp\s+me|telegram\s+me|dm\s+me\s+on\s+telegram|t\.me\/)\b/i,
  /\b(you\s+(are\s+a\s+|'re\s+a\s+)?(trash|garbage|scumbag|moron|idiot|loser))\b/i,
  /\b(fake\s+news\s+scam|this\s+is\s+pure\s+garbage)\b/i,
  /https?:\/\/[^\s]+/i, // Generic links in comments are flagged by default to prevent spam drops
];

/**
 * Detect primary language script from text
 */
function detectLanguage(text) {
  if (!text) return 'en';

  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Devanagari (Hindi, Marathi, Sanskrit)
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'; // Arabic / Urdu
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja'; // Japanese Hiragana/Katakana
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'; // Korean Hangul
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'; // Chinese CJK
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'; // Cyrillic (Russian, etc.)
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es'; // Spanish
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr'; // French
  if (/[äöüß]/i.test(text)) return 'de'; // German

  return 'en'; // Standard Latin / English
}

/**
 * Evaluate a comment text according to Option A Moderation
 *
 * @param {string} rawText
 * @returns {{ allowed: boolean, status: 'approved'|'flagged'|'rejected', reason: string, language: string }}
 */
function evaluateComment(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      allowed: false,
      status: 'rejected',
      reason: 'Comment text is required.',
      language: 'en',
    };
  }

  const text = rawText.trim();
  if (text.length === 0) {
    return {
      allowed: false,
      status: 'rejected',
      reason: 'Comment cannot be blank.',
      language: 'en',
    };
  }

  if (text.length > 1000) {
    return {
      allowed: false,
      status: 'rejected',
      reason: 'Comment cannot exceed 1000 characters.',
      language: 'en',
    };
  }

  const detectedLang = detectLanguage(text);

  // 1. Check severe prohibited patterns
  for (const pattern of SEVERE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        allowed: false,
        status: 'rejected',
        reason: 'Comment violates community safety guidelines and contains prohibited content.',
        language: detectedLang,
      };
    }
  }

  // 2. Check borderline / spam patterns
  for (const pattern of BORDERLINE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        allowed: true,
        status: 'flagged',
        reason: 'Comment has been flagged for automated moderation review due to promotional patterns or sensitive keywords.',
        language: detectedLang,
      };
    }
  }

  // 3. Check for excessive shouting (all caps) if length is substantial
  if (text.length >= 25) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 15) {
      const upperCount = (letters.match(/[A-Z]/g) || []).length;
      if (upperCount / letters.length > 0.85) {
        return {
          allowed: true,
          status: 'flagged',
          reason: 'Comment has been flagged for review due to excessive capitalisation.',
          language: detectedLang,
        };
      }
    }
  }

  // 4. Check for extreme repeated characters (e.g. "loooooooool", "aaaaaaaa")
  if (/(.)\1{9,}/.test(text)) {
    return {
      allowed: true,
      status: 'flagged',
      reason: 'Comment has been flagged for review due to excessive character repetition.',
      language: detectedLang,
    };
  }

  // 5. Approved clean comment
  return {
    allowed: true,
    status: 'approved',
    reason: '',
    language: detectedLang,
  };
}

module.exports = {
  detectLanguage,
  evaluateComment,
};
