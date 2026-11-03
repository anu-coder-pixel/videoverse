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
  if (/[\u0980-\u09FF]/.test(clean)) return 'bn'; // Bengali / Assamese
  if (/[\u0900-\u097F]/.test(clean)) {
    // Check if specifically Marathi Devanagari markers exist (using Unicode boundaries)
    if (/(?:^|[^\p{L}\p{M}\p{N}])(आहे|आहेत|नाही|नाहीत|खूप|छान|कसा|कशी|कसे|झाला|झाली|झाले|फार|करायचे|बघितला)(?:[^\p{L}\p{M}\p{N}]|$)/u.test(clean)) return 'mr';
    // Check if specifically Hindi Devanagari markers exist
    if (/(?:^|[^\p{L}\p{M}\p{N}])(है|हैं|था|थी|थे|हूँ|हूं|हो|का|की|के|को|में|से|पर|और|नमस्ते|बहुत|अच्छा|क्या|क्यों|धन्यवाद)(?:[^\p{L}\p{M}\p{N}]|$)/u.test(clean)) return 'hi';
    return 'hi'; // Standard Devanagari default
  }
  if (/[\u0B80-\u0BFF]/.test(clean)) return 'ta'; // Tamil
  if (/[\u0C00-\u0C7F]/.test(clean)) return 'te'; // Telugu
  if (/[\u0D00-\u0D7F]/.test(clean)) return 'ml'; // Malayalam
  if (/[\u0A80-\u0AFF]/.test(clean)) return 'gu'; // Gujarati
  if (/[\u0A00-\u0A7F]/.test(clean)) return 'pa'; // Punjabi (Gurmukhi)
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(clean)) {
    // Urdu-specific characters
    if (/[\u0679\u0686\u0688\u0698\u0691\u06BA\u06BE\u06C1\u06D2]/.test(clean)) return 'ur';
    // Urdu-distinctive vocabulary
    if (/(?:^|[^\p{L}\p{M}\p{N}])(شکریہ|بہت|اچھا|کیسے|کیا|ہیں|تھا|تھی|آپ|ہم|نہیں)(?:[^\p{L}\p{M}\p{N}]|$)/u.test(clean)) return 'ur';
    // Arabic-distinctive vocabulary / definite article
    if (/(?:^|[^\p{L}\p{M}\p{N}])(شكرا|مرحبا|ممتاز|جميل|جدا|السلام|عليكم|هذا|هذه|في|من|على|نعم|لا)(?:[^\p{L}\p{M}\p{N}]|$)/u.test(clean) || /(?:^|\s)ال[\u0600-\u06FF]+/u.test(clean)) return 'ar';
    return 'ar'; // Standard Arabic script default
  }
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(clean)) return 'ja'; // Japanese Hiragana/Katakana
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(clean)) return 'ko'; // Korean Hangul
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(clean)) return 'zh'; // Chinese CJK
  if (/[\u0400-\u04FF]/.test(clean)) return 'ru'; // Cyrillic (Russian, etc.)

  // 2. Diacritics
  if (/[ãõ]/i.test(clean)) return 'pt'; // Portuguese specific nasal vowels
  if (/[áéíóúñ¿¡]/i.test(clean)) return 'es'; // Spanish
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(clean)) return 'fr'; // French
  if (/[äöüß]/i.test(clean)) return 'de'; // German

  const lower = clean.toLowerCase();

  // 3. Roman Bengali (Banglish) phrases & compounds
  const bengaliPhrases = /\b(ami\s+toma[ke]o?(\s+bhalobash[ie])?|khub\s+bhalo(\s+video)?|onek\s+bhalo|kemon\s+ach[oe]|bhalo\s+ach[ie]|onek\s+dhonnobad|ki\s+khobor|shob\s+thik\s+ache|darun\s+video|osadharon\s+video|bhalo\s+laglo)\b/i;
  if (bengaliPhrases.test(lower)) {
    return 'bn';
  }

  // Standalone unique Bengali words (never appear in standard English)
  const uniqueBengaliWords = /\b(dhonnobad|dhonnobaad|bhalobashi|bhalobasi|osadharon|darun|kemon)\b/i;
  if (uniqueBengaliWords.test(lower)) {
    return 'bn';
  }

  // Multi-marker Bengali check (requires at least 2 distinct tokens)
  const bengaliMarkers = ['ami', 'tumi', 'tomake', 'tomako', 'bhalo', 'achi', 'acho', 'khub', 'kemon', 'kintu', 'ekhon', 'shob', 'thik', 'korcho', 'koro', 'korchi', 'dekho', 'onek', 'apnar', 'amader', 'shobaike'];
  let bHits = 0;
  for (const m of bengaliMarkers) {
    if (new RegExp('\\b' + m + '\\b', 'i').test(lower)) {
      bHits++;
      if (bHits >= 2) return 'bn';
    }
  }

  // 4. Roman Hindi / Hinglish phrases and compounds
  const hinglishPhrases = /\b((bhut|bahut|bohot|bhot)\s+(badhiya|badiya|achha|accha|acha|mast|sahi|kamaal|khoob|pyara|sundar)|kya\s+(baat|haal|hal|scene|khoob)|kya\s+hi\s+(baat|video)|shukriya\s+(bhai|dost|yaar|sir|aapka|apka)?|dhanyawad\s+(bhai|dost|yaar)?|dhanyavaad|mast\s+(video|hai|bhai|content|laga)|ekdum\s+(mast|badhiya|badiya|sahi|jhakaas)|maza\s+aa\s+gaya|maje\s+aa\s+gaye|bhai\s+kya\s+video|apka\s+video|aapka\s+video|yeh?\s+video\s+(bohot|bahut|bhut|accha|achha|mast)|mujhe\s+(ye|yeh|bohot|bahut)|kya\s+video\s+hai)\b/i;
  if (hinglishPhrases.test(lower)) {
    return 'hi';
  }

  // Standalone unique Hindi words
  const uniqueHindiWords = /\b(badhiya|badiya|shukriya|dhanyawad|dhanyavaad|zabardast|jhakaas|lajawab)\b/i;
  if (uniqueHindiWords.test(lower)) {
    return 'hi';
  }

  // Multi-marker threshold: 2 or more distinct Hinglish markers to avoid false positives on English
  // Note: common English words like 'main' and 'hum' are intentionally excluded to prevent false positives
  const hinglishMarkers = ['bhut', 'bahut', 'bohot', 'bhot', 'achha', 'accha', 'acha', 'kya', 'haal', 'hal', 'hai', 'hain', 'bhai', 'yaar', 'nahi', 'nahin', 'mera', 'meri', 'aapka', 'apka', 'mai', 'suno', 'dekho', 'karo', 'kare', 'raho', 'maza'];
  let markerHits = 0;
  for (const marker of hinglishMarkers) {
    if (new RegExp('\\b' + marker + '\\b', 'i').test(lower)) {
      markerHits++;
      if (markerHits >= 2) return 'hi';
    }
  }

  // 5. Other Romanized Indic phrases
  if (/\b(khup\s+(chan|sundar|bhari)(\s+video)?|lay\s+bhari|kasa\s+kay)\b/i.test(lower)) return 'mr'; // Marathi
  if (/\b(romba\s+(nalla|nalladhu|azhagu|azhaga|super)(\s+irukku|\s+iruku)?|mikka\s+nandri|nandri\s+nanba|vanakkam)\b/i.test(lower)) return 'ta'; // Tamil
  if (/\b(chala\s+(bagundi|bagundhi|manchi)(\s+video)?|chala\s+dhanyavadalu|dhanyavadalu\s+andi|namaskaram)\b/i.test(lower)) return 'te'; // Telugu
  if (/\b(bahut\s+vadiya|bohot\s+vadiya|bada\s+vadiya|sat\s+sri\s+akal|sat\s+shri\s+akal|lakh\s+lakh\s+vadhaiyan|dhanvaad|dhanwad)\b/i.test(lower)) return 'pa'; // Punjabi

  // 6. Unaccented European phrases / compounds
  if (/\b(hola\s+amig[oa]s?|buenos\s+dias|buenas\s+tardes|buenas\s+noches|por\s+favor|muchas\s+gracias|muchos\s+gracias|de\s+nada|hasta\s+luego|como\s+estas|que\s+tal|muy\s+buen[oa]|muy\s+bien)\b/i.test(lower)) {
    return 'es';
  }
  if (/\b(merci\s+beaucoup|s'?il\s+vous\s+pla[iî]t|de\s+rien|bonjour\s+[aà]\s+tous|bonne\s+journ[eé]e|c'?est\s+magnifique|tr[eè]s\s+bien|mon\s+ami)\b/i.test(lower)) {
    return 'fr';
  }
  if (/\b(guten\s+tag|guten\s+morgen|guten\s+abend|vielen\s+dank|danke\s+sehr|danke\s+sch[oö]n|auf\s+wiedersehen|sehr\s+gut|alles\s+gut|wie\s+geht'?s)\b/i.test(lower)) {
    return 'de';
  }
  if (/\b(muito\s+obrigad[oa]|por\s+favor|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|ate\s+logo)\b/i.test(lower)) {
    return 'pt';
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
