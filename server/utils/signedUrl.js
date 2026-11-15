/**
 * VideoVerse — Secure Cryptographic Download Token & Signed URL Service
 *
 * Provides:
 * 1. Short-lived signed download authorization tokens (HMAC-SHA256).
 * 2. URL tampering and forgery protection using constant-time comparison.
 * 3. Single-use and replay tracking via token hashing.
 * 4. Offline playback authorization tokens with configurable expiration.
 */

const crypto = require('crypto');

const SIGNING_SECRET = process.env.DOWNLOAD_SIGNING_SECRET || process.env.JWT_SECRET || 'vv_download_secure_signing_secret_key_2026';

/**
 * Computes a SHA-256 hash of a token for indexing/matching in MongoDB.
 */
function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates an HMAC-SHA256 signature for a given payload string.
 */
function createSignature(payloadString, secret = SIGNING_SECRET) {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('base64url');
}

/**
 * Generates a signed download authorization token.
 *
 * @param {object} params
 * @param {string} params.downloadId
 * @param {string} params.videoId
 * @param {string} params.userId
 * @param {number} [params.expiresInSeconds=900] (Default 15 minutes)
 * @returns {{ token: string, expiresAt: Date, downloadTokenHash: string }}
 */
function generateDownloadToken({ downloadId, videoId, userId, expiresInSeconds = 900 }) {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const nonce = crypto.randomBytes(12).toString('hex');

  const payload = {
    dId: downloadId.toString(),
    vId: String(videoId),
    uId: userId.toString(),
    exp: expiresAt.getTime(),
    nonce,
    type: 'download',
  };

  const payloadString = JSON.stringify(payload);
  const signature = createSignature(payloadString);
  const token = `${Buffer.from(payloadString).toString('base64url')}.${signature}`;
  const downloadTokenHash = hashToken(token);

  return {
    token,
    expiresAt,
    downloadTokenHash,
  };
}

/**
 * Verifies a signed download token.
 *
 * @param {string} tokenString
 * @param {string} [secret]
 * @returns {{ valid: boolean, payload?: object, error?: string, code?: string }}
 */
function verifyDownloadToken(tokenString, secret = SIGNING_SECRET) {
  if (!tokenString || typeof tokenString !== 'string') {
    return { valid: false, error: 'Token is missing or invalid format.', code: 'INVALID_TOKEN' };
  }

  const parts = tokenString.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token structure.', code: 'MALFORMED_TOKEN' };
  }

  const [encodedPayload, providedSignature] = parts;

  let payloadString;
  try {
    payloadString = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch (err) {
    return { valid: false, error: 'Invalid token payload encoding.', code: 'MALFORMED_TOKEN' };
  }

  const expectedSignature = createSignature(payloadString, secret);

  // Constant-time signature verification to prevent timing attacks
  const sigBufferA = Buffer.from(providedSignature);
  const sigBufferB = Buffer.from(expectedSignature);

  if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
    return { valid: false, error: 'Invalid token signature. URL tampering detected.', code: 'INVALID_SIGNATURE' };
  }

  let payload;
  try {
    payload = JSON.parse(payloadString);
  } catch (err) {
    return { valid: false, error: 'Invalid token JSON payload.', code: 'MALFORMED_TOKEN' };
  }

  if (payload.type !== 'download') {
    return { valid: false, error: 'Invalid token type.', code: 'INVALID_TOKEN_TYPE' };
  }

  // Check expiration
  if (!payload.exp || Date.now() > payload.exp) {
    return { valid: false, error: 'Download link has expired.', code: 'TOKEN_EXPIRED' };
  }

  return {
    valid: true,
    payload: {
      downloadId: payload.dId,
      videoId: payload.vId,
      userId: payload.uId,
      expiresAt: new Date(payload.exp),
      nonce: payload.nonce,
    },
  };
}

/**
 * Generates an offline playback authorization token for downloaded video content.
 *
 * @param {object} params
 * @param {string} params.downloadId
 * @param {string} params.videoId
 * @param {string} params.userId
 * @param {number} [params.expiresInSeconds=172800] (Default 48 hours)
 */
function generateOfflinePlaybackToken({ downloadId, videoId, userId, expiresInSeconds = 48 * 3600 }) {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const nonce = crypto.randomBytes(12).toString('hex');

  const payload = {
    dId: downloadId.toString(),
    vId: String(videoId),
    uId: userId.toString(),
    exp: expiresAt.getTime(),
    nonce,
    type: 'offline_playback',
  };

  const payloadString = JSON.stringify(payload);
  const signature = createSignature(payloadString);
  const token = `${Buffer.from(payloadString).toString('base64url')}.${signature}`;
  const tokenHash = hashToken(token);

  return {
    token,
    expiresAt,
    tokenHash,
  };
}

/**
 * Verifies an offline playback authorization token.
 */
function verifyOfflinePlaybackToken(tokenString, secret = SIGNING_SECRET) {
  if (!tokenString || typeof tokenString !== 'string') {
    return { valid: false, error: 'Offline token is missing.', code: 'INVALID_TOKEN' };
  }

  const parts = tokenString.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed offline token.', code: 'MALFORMED_TOKEN' };
  }

  const [encodedPayload, providedSignature] = parts;

  let payloadString;
  try {
    payloadString = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch (err) {
    return { valid: false, error: 'Invalid offline token encoding.', code: 'MALFORMED_TOKEN' };
  }

  const expectedSignature = createSignature(payloadString, secret);
  const sigBufferA = Buffer.from(providedSignature);
  const sigBufferB = Buffer.from(expectedSignature);

  if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
    return { valid: false, error: 'Invalid offline token signature.', code: 'INVALID_SIGNATURE' };
  }

  let payload;
  try {
    payload = JSON.parse(payloadString);
  } catch (err) {
    return { valid: false, error: 'Invalid offline token JSON.', code: 'MALFORMED_TOKEN' };
  }

  if (payload.type !== 'offline_playback') {
    return { valid: false, error: 'Invalid token type.', code: 'INVALID_TOKEN_TYPE' };
  }

  if (!payload.exp || Date.now() > payload.exp) {
    return { valid: false, error: 'Offline playback authorization has expired.', code: 'AUTH_EXPIRED' };
  }

  return {
    valid: true,
    payload: {
      downloadId: payload.dId,
      videoId: payload.vId,
      userId: payload.uId,
      expiresAt: new Date(payload.exp),
    },
  };
}

module.exports = {
  hashToken,
  generateDownloadToken,
  verifyDownloadToken,
  generateOfflinePlaybackToken,
  verifyOfflinePlaybackToken,
};

