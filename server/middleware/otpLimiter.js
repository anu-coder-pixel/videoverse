// OTP verification rate limiter middleware
// In test environment we bypass rate limiting to keep tests fast and deterministic.
// In production/development we apply a reasonable limit to prevent brute‑force attempts.

const rateLimit = require('express-rate-limit');

let otpVerifyLimiter;

if (process.env.NODE_ENV === 'test') {
  // No‑op middleware for test runs
  otpVerifyLimiter = (req, res, next) => next();
} else {
  otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each identifier to 5 verification attempts per window
    keyGenerator: (req) => {
      // Prefer email (or temp token) as identifier, fallback to IP
      return req.body?.email || req.ip;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: 'Too many OTP verification attempts. Please try again later.',
      code: 'OTP_VERIFY_RATE_LIMIT',
    },
  });
}

module.exports = { otpVerifyLimiter };

