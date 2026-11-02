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
  if (!text || typeof text !== 'string') return 'en';
  const clean = text.trim();
  if (!clean) return 'en';

  // 1. Non-Latin scripts
  if (/[\u0900-\u097F]/.test(clean)) return 'hi'; // Devanagari (Hindi, Marathi, Sanskrit)
  if (/[\u0600-\u06FF]/.test(clean)) return 'ar'; // Arabic / Urdu
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(clean)) return 'ja'; // Japanese Hiragana/Katakana
  if (/[\uAC00-\uD7AF]/.test(clean)) return 'ko'; // Korean Hangul
  if (/[\u4E00-\u9FFF]/.test(clean)) return 'zh'; // Chinese CJK
  if (/[\u0400-\u04FF]/.test(clean)) return 'ru'; // Cyrillic (Russian, etc.)

  // 2. Diacritics
  if (/[áéíóúñ¿¡]/i.test(clean)) return 'es'; // Spanish
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(clean)) return 'fr'; // French
  if (/[äöüß]/i.test(clean)) return 'de'; // German

  const lower = clean.toLowerCase();

  // 3. Unaccented Spanish phrases / compounds
  if (/\b(hola\s+amig[oa]s?|buenos\s+dias|buenas\s+tardes|buenas\s+noches|por\s+favor|muchas\s+gracias|muchos\s+gracias|de\s+nada|hasta\s+luego|como\s+estas|que\s+tal|muy\s+buen[oa]|muy\s+bien)\b/i.test(lower)) {
    return 'es';
  }

  // 4. Unaccented French phrases / compounds
  if (/\b(merci\s+beaucoup|s'?il\s+vous\s+pla[iî]t|de\s+rien|bonjour\s+[aà]\s+tous|bonne\s+journ[eé]e|c'?est\s+magnifique|tr[eè]s\s+bien|mon\s+ami)\b/i.test(lower)) {
    return 'fr';
  }

  // 5. Unaccented German phrases / compounds
  if (/\b(guten\s+tag|guten\s+morgen|guten\s+abend|vielen\s+dank|danke\s+sehr|danke\s+sch[oö]n|auf\s+wiedersehen|sehr\s+gut|alles\s+gut|wie\s+geht'?s)\b/i.test(lower)) {
    return 'de';
  }

  // 6. Romanized Hindi / Hinglish phrases and compounds
  const hinglishPhrases = /\b((bhut|bahut|bohot|bhot)\s+(badhiya|badiya|achha|accha|acha|mast|sahi|kamaal|khoob|pyara|sundar)|kya\s+(baat|haal|hal|scene|khoob)|kya\s+hi\s+(baat|video)|shukriya\s+(bhai|dost|yaar|sir|aapka|apka)?|dhanyawad\s+(bhai|dost|yaar)?|dhanyavaad|mast\s+(video|hai|bhai|content|laga)|ekdum\s+(mast|badhiya|badiya|sahi|jhakaas)|maza\s+aa\s+gaya|maje\s+aa\s+gaye|bhai\s+kya\s+video|apka\s+video|aapka\s+video|yeh?\s+video\s+(bohot|bahut|bhut|accha|achha|mast)|mujhe\s+(ye|yeh|bohot|bahut)|kya\s+video\s+hai)\b/i;
  if (hinglishPhrases.test(lower)) {
    return 'hi';
  }

  // 7. Unambiguous standalone Hindi words
  const uniqueHindiWords = /\b(badhiya|badiya|shukriya|dhanyawad|dhanyavaad|zabardast|jhakaas|lajawab)\b/i;
  if (uniqueHindiWords.test(lower)) {
    return 'hi';
  }

  // 8. Multi-marker threshold: 2 or more distinct Hinglish markers to avoid false positives on English
  const hinglishMarkers = ['bhut', 'bahut', 'bohot', 'bhot', 'achha', 'accha', 'acha', 'kya', 'haal', 'hal', 'hai', 'hain', 'bhai', 'yaar', 'nahi', 'nahin', 'mera', 'meri', 'aapka', 'apka', 'hum', 'mai', 'main', 'suno', 'dekho', 'karo', 'kare', 'raho', 'maza'];
  let markerHits = 0;
  for (const marker of hinglishMarkers) {
    const reg = new RegExp('\\b' + marker + '\\b', 'i');
    if (reg.test(lower)) {
      markerHits++;
      if (markerHits >= 2) return 'hi';
    }
  }

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
