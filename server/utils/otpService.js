/**
 * VideoVerse — Secure OTP Generation, Hashing & Delivery Service
 *
 * Implements:
 * - crypto.randomInt(100000, 1000000) for uniform 6-digit codes
 * - Per-session random salt + HMAC-SHA256 hashing
 * - 5-minute expiry, max 5 attempts, 60s cooldown, rate limiting
 * - Development test helper (strictly disabled in production)
 * - Safe error handling if SMTP is missing or fails
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const OtpSession = require('../models/OtpSession');

// In-memory registry for local development test helper ONLY (never used in production)
const devOtpRegistry = new Map();

/**
 * Periodically purge expired dev OTP registry entries
 */
setInterval(() => {
  if (process.env.NODE_ENV === 'production') {
    devOtpRegistry.clear();
    return;
  }
  const now = Date.now();
  for (const [sessionId, entry] of devOtpRegistry.entries()) {
    if (entry.expiresAt < now) {
      devOtpRegistry.delete(sessionId);
    }
  }
}, 60000);

/**
 * Generates a uniformly distributed 6-digit numeric OTP code.
 * Range: 100000 to 999999 inclusive.
 * @returns {string}
 */
function generateOtp() {
  const code = crypto.randomInt(100000, 1000000);
  return code.toString();
}

/**
 * Hashes an OTP code using a per-session random salt and HMAC-SHA256.
 * @param {string} otp
 * @param {string} salt
 * @returns {string}
 */
function hashOtp(otp, salt) {
  return crypto.createHmac('sha256', salt).update(otp.toString().trim()).digest('hex');
}

/**
 * Computes SHA-256 hash of a string (used for tokens).
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Checks if production SMTP email is configured.
 * @returns {boolean}
 */
function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

/**
 * Dispatches an OTP to the user's email via SMTP or development fallback.
 *
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<{ sent: boolean, provider: string, error?: string }>}
 */
async function dispatchOtp(email, otp) {
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Production SMTP Delivery
  if (isSmtpConfigured()) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"VideoVerse Security" <security@videoverse.com>',
        to: email,
        subject: 'VideoVerse Verification Code: ' + otp,
        text: `Your VideoVerse verification code is: ${otp}\n\nThis code will expire in 5 minutes.\nIf you did not attempt to sign in to your VideoVerse account, please secure your password immediately.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #ff0000; margin-top: 0;">VideoVerse Device Verification</h2>
            <p style="font-size: 14px; color: #333;">We detected a sign-in attempt from a new browser or device. Use the following verification code to complete your login:</p>
            <div style="background: #f4f4f4; padding: 16px; border-radius: 6px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 24px 0; color: #111;">
              ${otp}
            </div>
            <p style="font-size: 12px; color: #666;">This code is valid for 5 minutes. Never share this code with anyone.</p>
          </div>
        `,
      });

      return { sent: true, provider: 'smtp' };
    } catch (smtpErr) {
      console.error('[SMTP Delivery Error]', smtpErr.message);
      if (isProduction) {
        return { sent: false, provider: 'smtp', error: 'SMTP transmission failed' };
      }
    }
  }

  // 2. Development Mode Fallback
  if (!isProduction) {
    // In local development, log to terminal for pair debugging
    console.log(`\n======================================================`);
    console.log(`🔑 [DEV OTP] Code for ${email}: ${otp}`);
    console.log(`======================================================\n`);
    return { sent: true, provider: 'dev-console' };
  }

  // In production with no SMTP configured:
  console.warn('[AUTH] Production email delivery is not configured. Set SMTP_* environment variables in server/.env.');
  return { sent: false, provider: 'none', error: 'SMTP not configured in production' };
}

/**
 * Creates and registers a new OTP session.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.userId
 * @param {string} params.email
 * @param {string} params.tempToken
 * @param {object} params.deviceContext
 * @returns {Promise<{ sessionId: string, resendAvailableAt: Date, expiresAt: Date, delivery: object }>}
 */
async function createOtpSession({ sessionId, userId, email, tempToken, deviceContext }) {
  // Check rate limiting: max 5 OTP requests per 15 minutes for this user
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const recentCount = await OtpSession.countDocuments({
    userId,
    createdAt: { $gt: fifteenMinutesAgo },
  });

  if (recentCount >= 5) {
    throw new Error('Too many verification requests. Please wait 15 minutes before trying again.');
  }

  // Generate 6-digit code and unique per-session salt
  const otpCode = generateOtp();
  const salt = crypto.randomBytes(16).toString('hex');
  const otpHash = hashOtp(otpCode, salt);
  const tempTokenHash = hashToken(tempToken);

  const now = Date.now();
  const expiresAt = new Date(now + 5 * 60 * 1000); // 5 minutes
  const resendAvailableAt = new Date(now + 60 * 1000); // 60 seconds

  // Persist session (status: 'pending')
  const sessionData = {
    userId,
    tempTokenHash,
    salt,
    otpHash,
    attempts: 0,
    maxAttempts: 5,
    resendAvailableAt,
    expiresAt,
    status: 'pending',
    deviceContext,
  };
  if (sessionId) sessionData._id = sessionId;
  const session = await OtpSession.create(sessionData);

  const finalSessionId = session._id.toString();

  // Register in dev helper map strictly when NOT in production
  if (process.env.NODE_ENV !== 'production') {
    devOtpRegistry.set(finalSessionId, {
      otp: otpCode,
      tempTokenHash,
      userId: userId.toString(),
      expiresAt: expiresAt.getTime(),
    });
  }

  // Dispatch OTP
  const delivery = await dispatchOtp(email, otpCode);

  return {
    sessionId: finalSessionId,
    resendAvailableAt,
    expiresAt,
    delivery,
  };
}

/**
 * Retrieves the OTP code for development test verification ONLY.
 * Strictly disabled in production.
 *
 * @param {string} sessionId
 * @param {string} tempToken
 * @param {string} [userId]
 * @returns {string|null}
 */
function getDevOtp(sessionId, tempToken, userId) {
  if (process.env.NODE_ENV === 'production') return null;
  let entry = sessionId ? devOtpRegistry.get(sessionId) : null;
  if (!entry && userId) {
    for (const item of devOtpRegistry.values()) {
      if (item.userId === userId.toString()) {
        entry = item;
        break;
      }
    }
  }
  if (!entry) return null;

  const currentTokenHash = hashToken(tempToken);
  if (entry.tempTokenHash !== currentTokenHash) return null;
  if (entry.expiresAt < Date.now()) {
    if (sessionId) devOtpRegistry.delete(sessionId);
    return null;
  }

  return entry.otp;
}

module.exports = {
  generateOtp,
  hashOtp,
  hashToken,
  isSmtpConfigured,
  dispatchOtp,
  createOtpSession,
  getDevOtp,
};
