const jwt = require('jsonwebtoken');
const User = require('../models/User');

const COOKIE_NAME = 'vv_token';

/**
 * Generate a signed JWT token
 */
function signToken(userId, deviceId = null) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured in environment variables');
  }
  const payload = { id: userId };
  if (deviceId) {
    payload.deviceId = String(deviceId);
  }
  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    algorithm: 'HS256',
  });
}


/**
 * Set HTTP-only auth cookie on response
 */
function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // Prevents client-side JS from accessing the cookie (XSS protection)
    secure: isProduction, // HTTPS only in production; allow HTTP on localhost
    sameSite: isProduction ? 'strict' : 'lax', // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/',
  });
}

/**
 * Clear the HTTP-only auth cookie
 */
function clearAuthCookie(res) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
  });
}

/**
 * Extract token from cookie (primary) or Authorization Bearer header (fallback)
 */
function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
}

/**
 * Middleware: Requires a valid authenticated user
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in.',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id);

    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({
        error: 'The account for this session no longer exists.',
        code: 'USER_NOT_FOUND',
      });
    }

    // Check device revocation if session is bound to a deviceId
    if (decoded.deviceId) {
      const TrustedDevice = require('../models/TrustedDevice');
      const device = await TrustedDevice.findById(decoded.deviceId);
      if (!device || device.isRevoked || (device.expiresAt && new Date() > device.expiresAt)) {
        clearAuthCookie(res);
        clearDeviceCookie(res);
        return res.status(401).json({
          error: 'This device session has been revoked or expired. Please sign in again.',
          code: 'SESSION_REVOKED',
        });
      }
    }

    // Check active device cookie revocation if present
    const rawDeviceCookie = extractDeviceToken(req);
    if (rawDeviceCookie) {
      const crypto = require('crypto');
      const incomingHash = crypto.createHash('sha256').update(rawDeviceCookie).digest('hex');
      const TrustedDevice = require('../models/TrustedDevice');
      const dev = await TrustedDevice.findOne({ userId: user._id, deviceTokenHash: incomingHash });
      if (dev && (dev.isRevoked || (dev.expiresAt && new Date() > dev.expiresAt))) {
        clearAuthCookie(res);
        clearDeviceCookie(res);
        return res.status(401).json({
          error: 'This device has been revoked or expired. Please sign in again.',
          code: 'DEVICE_REVOKED',
        });
      }
    }

    // Phase 2 Step 6: Verify account suspension status
    if (user.isSuspended) {
      clearAuthCookie(res);
      return res.status(403).json({
        error: 'Your account has been suspended by an administrator. Please contact support.',
        code: 'ACCOUNT_SUSPENDED',
        reason: user.suspendedReason || null,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      clearAuthCookie(res);
      return res.status(401).json({
        error: 'Your session has expired. Please sign in again.',
        code: 'SESSION_EXPIRED',
      });
    }
    clearAuthCookie(res);
    return res.status(401).json({
      error: 'Invalid authentication session.',
      code: 'INVALID_TOKEN',
    });
  }
}

/**
 * Middleware: Optional authentication (attaches req.user if valid token present, doesn't block)
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id);
    req.user = user || null;
  } catch (err) {
    req.user = null;
  }
  next();
}

function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    }
    if (req.user.role !== requiredRole) {
      return res.status(403).json({ error: 'Forbidden: insufficient privileges.', code: 'FORBIDDEN' });
    }
    next();
  };
}

const DEVICE_COOKIE_NAME = 'vv_device_token';

/**
 * Set HTTP-only, 30-day device trust cookie
 */
function setDeviceCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });
}

/**
 * Clear device trust cookie
 */
function clearDeviceCookie(res) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie(DEVICE_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
  });
}

/**
 * Extract device token from cookies
 */
function extractDeviceToken(req) {
  if (req.cookies && req.cookies[DEVICE_COOKIE_NAME]) {
    return req.cookies[DEVICE_COOKIE_NAME];
  }
  return null;
}

/**
 * Generate a short-lived temp token for OTP verification (5-minute expiry)
 */
function signTempToken(userId, sessionId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign(
    { id: userId, sessionId, scope: 'otp_pending' },
    secret,
    { expiresIn: '5m' }
  );
}

/**
 * Middleware to require a valid pending OTP temporary token
 */
async function requireTempAuth(req, res, next) {
  let token = null;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.body && req.body.tempToken) {
    token = req.body.tempToken;
  }

  if (!token) {
    return res.status(401).json({
      error: 'Temporary authentication token is required.',
      code: 'TEMP_TOKEN_REQUIRED',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.scope !== 'otp_pending') {
      return res.status(401).json({
        error: 'Invalid token scope.',
        code: 'INVALID_TOKEN_SCOPE',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        error: 'User not found.',
        code: 'USER_NOT_FOUND',
      });
    }

    req.tempAuth = {
      user,
      userId: decoded.id,
      sessionId: decoded.sessionId,
      rawToken: token,
    };
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Temporary session expired or invalid. Please sign in again.',
      code: 'TEMP_TOKEN_EXPIRED',
    });
  }
}

const requireAdmin = requireRole('admin');

module.exports = {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  extractToken,
  requireAuth,
  optionalAuth,
  DEVICE_COOKIE_NAME,
  setDeviceCookie,
  clearDeviceCookie,
  extractDeviceToken,
  signTempToken,
  requireTempAuth,
  requireRole,
  requireAdmin,
};
