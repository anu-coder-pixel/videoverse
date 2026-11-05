/**
 * VideoVerse — Secure Dynamic TURN Credential Service
 *
 * Phase 6.3.1: Backend foundation for production-ready WebRTC TURN authentication.
 * Implements the standard TURN REST API HMAC credential mechanism (RFC 5766 / RFC 7635).
 *
 * Security Principles:
 * - Credentials are ephemeral with strict, bounded TTL (default 15 minutes).
 * - Username format: <expiry_timestamp>:<user_id>
 * - Credential format: Base64(HMAC-SHA1(TURN_SHARED_SECRET, username))
 * - User identity is derived exclusively from verified server-side authentication.
 * - Shared secrets and credentials are never logged or persisted.
 */

const crypto = require('crypto');

// Default and boundary constants for TTL
const DEFAULT_TTL_SECONDS = 900; // 15 minutes
const MIN_TTL_SECONDS = 60; // 1 minute minimum
const MAX_TTL_SECONDS = 86400; // 24 hours maximum

/**
 * Validates and clamps the TTL value within safe operational bounds.
 * Prevents negative, NaN, or excessively long lifetimes.
 *
 * @param {number|string} ttlInput - Raw TTL value
 * @returns {number} Clamped TTL in seconds
 */
function sanitizeTtl(ttlInput) {
  if (ttlInput === undefined || ttlInput === null || ttlInput === '') {
    return DEFAULT_TTL_SECONDS;
  }
  const parsed = parseInt(ttlInput, 10);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_SECONDS;
  }
  if (parsed < MIN_TTL_SECONDS) {
    return MIN_TTL_SECONDS;
  }
  if (parsed > MAX_TTL_SECONDS) {
    return MAX_TTL_SECONDS;
  }
  return parsed;
}

/**
 * Generates an ephemeral TURN username and HMAC-SHA1 credential.
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user's database ID
 * @param {string} params.secret - Backend TURN shared secret (RFC 5766)
 * @param {number|string} [params.ttlSeconds] - Desired lifetime in seconds
 * @param {number} [params.nowSeconds] - Optional timestamp injection for deterministic testing
 * @returns {{ username: string, credential: string, ttl: number, expiresAt: number }}
 */
function generateTurnCredentials({ userId, secret, ttlSeconds, nowSeconds }) {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Valid userId is required for TURN credential generation.');
  }
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('Valid shared secret is required for TURN credential generation.');
  }

  const cleanUserId = userId.trim();
  const cleanSecret = secret.trim();
  const clampedTtl = sanitizeTtl(ttlSeconds);

  // Expiry timestamp in Unix seconds
  const currentUnixSeconds = typeof nowSeconds === 'number' && Number.isFinite(nowSeconds)
    ? Math.floor(nowSeconds)
    : Math.floor(Date.now() / 1000);

  const expiresAt = currentUnixSeconds + clampedTtl;
  const username = `${expiresAt}:${cleanUserId}`;

  // Standard HMAC-SHA1 Base64 credential
  const credential = crypto
    .createHmac('sha1', cleanSecret)
    .update(username)
    .digest('base64');

  return {
    username,
    credential,
    ttl: clampedTtl,
    expiresAt,
  };
}

/**
 * Builds the complete ICE server configuration for an authenticated user.
 * Returns public STUN servers and dynamic TURN credentials if configured.
 * If TURN is unconfigured, returns safe STUN-only configuration without leaking secrets.
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user's database ID
 * @param {Object} [params.env=process.env] - Environment variables source
 * @param {number} [params.nowSeconds] - Optional timestamp for deterministic testing
 * @returns {Object} Safe configuration payload suitable for JSON API response
 */
function getIceServerConfig({ userId, env = process.env, nowSeconds }) {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Authenticated user identity required for ICE configuration.');
  }

  const cleanUserId = userId.trim();
  const stunUrl = (env.STUN_SERVER_URL && typeof env.STUN_SERVER_URL === 'string' && env.STUN_SERVER_URL.trim())
    ? env.STUN_SERVER_URL.trim()
    : 'stun:stun.l.google.com:19302';

  const iceServers = [{ urls: stunUrl }];

  const turnServerUrl = env.TURN_SERVER_URL && typeof env.TURN_SERVER_URL === 'string'
    ? env.TURN_SERVER_URL.trim()
    : null;
  const turnSharedSecret = env.TURN_SHARED_SECRET && typeof env.TURN_SHARED_SECRET === 'string'
    ? env.TURN_SHARED_SECRET.trim()
    : null;

  // If TURN is configured with server URL and shared secret
  if (turnServerUrl && turnSharedSecret) {
    const creds = generateTurnCredentials({
      userId: cleanUserId,
      secret: turnSharedSecret,
      ttlSeconds: env.TURN_CREDENTIAL_TTL_SECONDS,
      nowSeconds,
    });

    // Support comma-separated URLs if multiple protocols/ports configured
    const turnUrls = turnServerUrl.includes(',')
      ? turnServerUrl.split(',').map((u) => u.trim()).filter(Boolean)
      : turnServerUrl;

    iceServers.push({
      urls: turnUrls,
      username: creds.username,
      credential: creds.credential,
    });

    return {
      success: true,
      iceServers,
      turnConfigured: true,
      ttl: creds.ttl,
      expiresAt: creds.expiresAt,
    };
  }

  // Safe STUN-only fallback when TURN is unconfigured
  return {
    success: true,
    iceServers,
    turnConfigured: false,
    message: 'STUN-only configuration active. TURN relay server is not configured.',
  };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  sanitizeTtl,
  generateTurnCredentials,
  getIceServerConfig,
};
