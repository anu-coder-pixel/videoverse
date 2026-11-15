/**
 * VideoVerse — Centralized Environment Configuration Validator
 *
 * Validates critical environment variables before server starts listening.
 *
 * Security Principles:
 * - Fail fast with clear actionable error messages for missing mandatory config.
 * - Never print secret values or sensitive connection strings in logs or exceptions.
 * - Do not expose secrets through any error return or API response.
 * - Support existing development and test configurations gracefully.
 * - Do not require optional service configuration (SMTP, Razorpay, TURN) unless
 *   specifically enabled or when running in production.
 */

/**
 * Validates environment variables.
 *
 * @param {object} [customEnv=process.env] - Environment object to test against
 * @returns {{ valid: boolean, errors: string[], warnings: string[], config: object }}
 */
function validateEnv(customEnv = process.env) {
  const env = customEnv || {};
  const errors = [];
  const warnings = [];

  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  // 1. Validate NODE_ENV
  if (env.NODE_ENV && !['development', 'production', 'test'].includes(env.NODE_ENV)) {
    warnings.push(`NODE_ENV is set to unrecognized value "${env.NODE_ENV}". Defaulting behavior to development.`);
  }

  // 2. Validate MONGODB_URI
  if (!env.MONGODB_URI || typeof env.MONGODB_URI !== 'string' || !env.MONGODB_URI.trim()) {
    errors.push('MONGODB_URI is required and must be a non-empty string.');
  } else if (!env.MONGODB_URI.startsWith('mongodb://') && !env.MONGODB_URI.startsWith('mongodb+srv://')) {
    errors.push('MONGODB_URI must start with "mongodb://" or "mongodb+srv://".');
  }

  // 3. Validate JWT_SECRET
  if (!env.JWT_SECRET || typeof env.JWT_SECRET !== 'string' || !env.JWT_SECRET.trim()) {
    errors.push('JWT_SECRET is required.');
  } else if (env.JWT_SECRET.trim().length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters long for security (currently ${env.JWT_SECRET.trim().length} chars).`);
  }

  // 4. Validate CLIENT_URL
  if (isProduction) {
    if (!env.CLIENT_URL || typeof env.CLIENT_URL !== 'string' || !env.CLIENT_URL.trim()) {
      errors.push('CLIENT_URL is required in production for CORS and secure cookie isolation.');
    } else {
      try {
        const parsed = new URL(env.CLIENT_URL);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.push('CLIENT_URL must have an http:// or https:// protocol.');
        }
      } catch {
        errors.push('CLIENT_URL is not a valid URL.');
      }
    }
  } else {
    if (!env.CLIENT_URL) {
      warnings.push('CLIENT_URL is unset. Local development will default to http://localhost:5173.');
    }
  }

  // 5. Validate SMTP Configuration (Optional in dev/test, checked if enabled or in production)
  const hasSmtpHost = Boolean(env.SMTP_HOST && env.SMTP_HOST.trim());
  const hasSmtpUser = Boolean(env.SMTP_USER && env.SMTP_USER.trim());
  const hasSmtpPass = Boolean(env.SMTP_PASS && env.SMTP_PASS.trim());

  if (hasSmtpHost || hasSmtpUser || hasSmtpPass) {
    if (!hasSmtpHost) errors.push('SMTP_HOST is required when SMTP email service is enabled.');
    if (!hasSmtpUser) errors.push('SMTP_USER is required when SMTP email service is enabled.');
    if (!hasSmtpPass) errors.push('SMTP_PASS is required when SMTP email service is enabled.');
    if (env.SMTP_PORT && isNaN(parseInt(env.SMTP_PORT, 10))) {
      errors.push('SMTP_PORT must be a valid integer if provided.');
    }
  } else if (isProduction && !isTest) {
    warnings.push('SMTP email delivery is unconfigured in production. New-device OTP verification emails will fail.');
  }

  // 6. Validate Razorpay Configuration (Optional in dev/test, checked if enabled)
  const hasRazorpayKey = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_ID.trim());
  const hasRazorpaySecret = Boolean(env.RAZORPAY_KEY_SECRET && env.RAZORPAY_KEY_SECRET.trim());

  if (hasRazorpayKey || hasRazorpaySecret) {
    if (!hasRazorpayKey) errors.push('RAZORPAY_KEY_ID is required when Razorpay payment gateway is enabled.');
    if (!hasRazorpaySecret) errors.push('RAZORPAY_KEY_SECRET is required when Razorpay payment gateway is enabled.');
  } else if (isProduction && !isTest) {
    warnings.push('Razorpay credentials are not set. Subscription purchases will fail in production.');
  }

  // 7. Validate TURN Server Configuration (Optional, checked if enabled)
  const hasTurnUrl = Boolean(env.TURN_SERVER_URL && env.TURN_SERVER_URL.trim());
  const hasTurnSecret = Boolean(env.TURN_SHARED_SECRET && env.TURN_SHARED_SECRET.trim());

  if (hasTurnUrl || hasTurnSecret) {
    if (!hasTurnUrl) errors.push('TURN_SERVER_URL is required when TURN relay authentication is enabled.');
    if (!hasTurnSecret) errors.push('TURN_SHARED_SECRET is required when TURN relay authentication is enabled.');
    if (env.TURN_CREDENTIAL_TTL_SECONDS) {
      const ttl = parseInt(env.TURN_CREDENTIAL_TTL_SECONDS, 10);
      if (isNaN(ttl) || ttl <= 0) {
        errors.push('TURN_CREDENTIAL_TTL_SECONDS must be a positive integer.');
      }
    }
  }

  // Safe sanitized configuration overview (No secrets leaked)
  const safeConfig = {
    nodeEnv,
    port: parseInt(env.PORT, 10) || 5000,
    mongoConfigured: Boolean(env.MONGODB_URI),
    jwtConfigured: Boolean(env.JWT_SECRET && env.JWT_SECRET.length >= 32),
    clientUrl: env.CLIENT_URL || 'http://localhost:5173',
    smtpConfigured: Boolean(hasSmtpHost && hasSmtpUser && hasSmtpPass),
    razorpayConfigured: Boolean(hasRazorpayKey && hasRazorpaySecret),
    turnConfigured: Boolean(hasTurnUrl && hasTurnSecret),
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config: safeConfig,
  };
}

/**
 * Asserts that the environment is valid.
 * Throws a formatted Error if validation fails.
 *
 * @param {object} [customEnv=process.env]
 * @throws {Error} If mandatory environment requirements are not met
 */
function assertEnv(customEnv = process.env) {
  const result = validateEnv(customEnv);

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`[CONFIG WARNING] ${warning}`);
    }
  }

  if (!result.valid) {
    const message = [
      '❌ Environment Validation Failed with the following errors:',
      ...result.errors.map(err => `  - ${err}`),
      'Please check your .env configuration before starting the server.',
    ].join('\n');

    throw new Error(message);
  }

  return result.config;
}

module.exports = {
  validateEnv,
  assertEnv,
};
