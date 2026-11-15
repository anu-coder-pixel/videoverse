/**
 * VideoVerse — Rate Limiting Middleware
 *
 * Implements granular, route-specific rate limiting using express-rate-limit.
 * - Protects authentication, registration, OTP, and payment creation routes.
 * - Consistent JSON 429 responses matching application API standards.
 * - Uses MemoryStore for single-instance in-memory tracking.
 */

const rateLimit = require('express-rate-limit');

/**
 * Standard handler for consistent JSON 429 responses
 */
function createRateLimitHandler(errorMessage, errorCode) {
  return (req, res, next, options) => {
    res.status(options.statusCode || 429).json({
      error: errorMessage,
      code: errorCode,
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    });
  };
}

/**
 * 1. IP-based Login Limiter (Volumetric protection)
 * Max 20 requests per 15 minutes per IP.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: true,
  statusCode: 429,
  handler: createRateLimitHandler(
    'Too many login attempts from this network. Please try again later.',
    'TOO_MANY_REQUESTS'
  ),
});

/**
 * 2. Email-based Login Limiter (Targeted account brute-force protection)
 * Max 5 failed attempts per 15 minutes per email.
 * - Uses skipSuccessfulRequests: true so successful logins do not consume the quota.
 * - Normalizes email to prevent case/whitespace bypass.
 */
const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: true,
  keyGenerator: (req) => {
    const rawEmail = req.body?.email;
    if (rawEmail && typeof rawEmail === 'string') {
      return `email:${rawEmail.toLowerCase().trim()}`;
    }
    return `ip:${req.ip}`;
  },
  statusCode: 429,
  handler: createRateLimitHandler(
    'Too many failed login attempts for this account. Please try again in 15 minutes.',
    'TOO_MANY_FAILED_LOGINS'
  ),
});

/**
 * 3. Registration Limiter (Bot and spam account creation protection)
 * Max 5 account registrations per hour per IP.
 * Safe pass-through in test environment (same pattern as commentPostLimiter).
 */
const registerLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 5,
      standardHeaders: 'draft-7',
      legacyHeaders: true,
      statusCode: 429,
      handler: createRateLimitHandler(
        'Too many accounts created from this IP. Please try again later.',
        'TOO_MANY_REGISTRATIONS'
      ),
    });

/**
 * 4. OTP Verification Limiter
 * Max 10 verification requests per 15 minutes.
 * - Mounted after requireTempAuth so req.tempAuth.sessionId is available.
 * - Keys by session ID to avoid blocking other users sharing a public IP.
 */
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: true,
  keyGenerator: (req) => {
    if (req.tempAuth?.sessionId) {
      return `otp_verify:${req.tempAuth.sessionId}`;
    }
    return `ip:${req.ip}`;
  },
  statusCode: 429,
  handler: createRateLimitHandler(
    'Too many verification attempts. Please request a new code.',
    'OTP_RATE_LIMITED'
  ),
});

/**
 * 5. OTP Resend Limiter
 * Max 5 resend requests per 15 minutes.
 * - Complements the in-route 60-second cooldown timer.
 */
const otpResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: true,
  keyGenerator: (req) => {
    if (req.tempAuth?.userId) {
      return `otp_resend:${req.tempAuth.userId}`;
    }
    return `ip:${req.ip}`;
  },
  statusCode: 429,
  handler: createRateLimitHandler(
    'Too many verification code requests. Please wait before trying again.',
    'TOO_MANY_RESENDS'
  ),
});

/**
 * 6. Payment Order Creation Limiter
 * Max 10 order creation requests per 15 minutes per authenticated user.
 */
const paymentOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: true,
  keyGenerator: (req) => {
    if (req.user?._id) {
      return `payment_order:${req.user._id}`;
    }
    return `ip:${req.ip}`;
  },
  statusCode: 429,
  handler: createRateLimitHandler(
    'Too many payment orders created. Please try again later.',
    'PAYMENT_RATE_LIMITED'
  ),
});

/**
 * 7. Comment Posting Rate Limiter
 * Max 15 comments per minute per authenticated user (or IP).
 * Safe pass-through in test environment.
 */
const commentPostLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 15,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => {
        if (req.user?._id) {
          return `comment_user:${req.user._id}`;
        }
        return `comment_ip:${req.ip}`;
      },
      statusCode: 429,
      handler: createRateLimitHandler(
        'Too many comments posted in a short period. Please slow down.',
        'COMMENT_RATE_LIMITED'
      ),
    });

module.exports = {
  loginIpLimiter,
  loginEmailLimiter,
  registerLimiter,
  otpVerifyLimiter,
  otpResendLimiter,
  paymentOrderLimiter,
  commentPostLimiter,
};
