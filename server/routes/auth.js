const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const LoginHistory = require('../models/LoginHistory');
const TrustedDevice = require('../models/TrustedDevice');
const OtpSession = require('../models/OtpSession');
const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  setDeviceCookie,
  extractDeviceToken,
  clearDeviceCookie,
  signTempToken,
  requireTempAuth,
} = require('../middleware/auth');
const { parseClientContext } = require('../utils/deviceDetector');
const { createOtpSession, hashOtp, getDevOtp } = require('../utils/otpService');
const { resolveTheme } = require('../utils/istTime');

const router = express.Router();

/**
 * Helper: Masks email for safe on-screen display (e.g. j***n@example.com)
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

/**
 * Helper: Safely clean and deduplicate an array of string IDs
 */
function cleanIdArray(arr) {
  if (!Array.isArray(arr)) return [];
  const valid = arr.filter(item => typeof item === 'string' && item.trim().length > 0);
  return Array.from(new Set(valid.map(id => id.trim())));
}

/**
 * Helper: Safely merge guest data into user account without duplicates
 */
function mergeGuestDataIntoUser(user, guestData) {
  if (!guestData || typeof guestData !== 'object') return;

  if (Array.isArray(guestData.likedVideos)) {
    const combined = [...(user.likedVideos || []), ...cleanIdArray(guestData.likedVideos)];
    user.likedVideos = Array.from(new Set(combined));
  }

  if (Array.isArray(guestData.dislikedVideos)) {
    const combined = [...(user.dislikedVideos || []), ...cleanIdArray(guestData.dislikedVideos)];
    user.dislikedVideos = Array.from(new Set(combined));
  }

  if (Array.isArray(guestData.watchLater)) {
    const combined = [...(user.watchLater || []), ...cleanIdArray(guestData.watchLater)];
    user.watchLater = Array.from(new Set(combined));
  }

  if (Array.isArray(guestData.subscribedChannels)) {
    const combined = [...(user.subscribedChannels || []), ...cleanIdArray(guestData.subscribedChannels)];
    user.subscribedChannels = Array.from(new Set(combined));
  }

  if (Array.isArray(guestData.watchHistory)) {
    const guestHistory = cleanIdArray(guestData.watchHistory);
    const existing = user.watchHistory || [];
    // Combine preserving recent order without duplicates
    const historySet = new Set(guestHistory);
    for (const id of existing) {
      historySet.add(id);
    }
    user.watchHistory = Array.from(historySet);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Creates a new user account, starting strictly on the Free tier.
 * Registers and trusts the initial registration device.
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, guestData } = req.body;
    const context = parseClientContext(req);

    // Basic validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing account
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.',
        code: 'EMAIL_ALREADY_EXISTS',
      });
    }

    // Hash password with salt cost factor of 10
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user (strictly Free tier)
    const newUser = new User({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      subscriptionTier: 'free',
      themePreference: 'auto',
    });

    // Merge any existing guest activity seamlessly
    if (guestData) {
      mergeGuestDataIntoUser(newUser, guestData);
    }

    await newUser.save();

    // Register initial device as trusted
    const rawDeviceToken = crypto.randomBytes(32).toString('hex');
    const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');

    await TrustedDevice.create({
      userId: newUser._id,
      deviceTokenHash,
      deviceName: context.deviceName,
      browser: context.browser,
      browserVersion: context.browserVersion,
      os: context.os,
      osVersion: context.osVersion,
      deviceType: context.deviceType,
      deviceModel: context.deviceModel,
      lastIp: context.ip,
      lastLocation: context.location,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trust
      isRevoked: false,
    });

    // Record login history
    await LoginHistory.create({
      userId: newUser._id,
      ip: context.ip,
      browser: context.browser,
      browserVersion: context.browserVersion,
      os: context.os,
      osVersion: context.osVersion,
      deviceType: context.deviceType,
      deviceModel: context.deviceModel,
      location: context.location,
      status: 'success',
      userAgent: context.userAgent,
    });

    // Issue 30-day device cookie and 7-day auth session cookie
    setDeviceCookie(res, rawDeviceToken);
    const token = signToken(newUser._id);
    setAuthCookie(res, token);

    const resolvedTheme = resolveTheme(newUser.themePreference);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: newUser.toSafeObject(),
      resolvedTheme,
    });
  } catch (err) {
    console.error('[Auth Register Error]:', err.message);
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    return res.status(500).json({ error: 'Server error while creating your account. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Validates credentials and evaluates device trust:
 * - If device is trusted and unrevoked: signs in directly via HTTP-only cookie.
 * - If untrusted/new: gates login with step-up OTP and returns tempToken.
 * - Anti-enumeration: uniform error for non-existent email or wrong password.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password, guestData } = req.body;
    const context = parseClientContext(req);

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide both email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Query user and explicitly select passwordHash
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

    // Anti-enumeration: simulate compare if user not found to prevent timing discovery
    if (!user) {
      await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr');
      return res.status(401).json({
        error: 'Invalid email or password. Please check your credentials.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      // Record failed login audit record
      await LoginHistory.create({
        userId: user._id,
        ip: context.ip,
        browser: context.browser,
        browserVersion: context.browserVersion,
        os: context.os,
        osVersion: context.osVersion,
        deviceType: context.deviceType,
        deviceModel: context.deviceModel,
        location: context.location,
        status: 'failed',
        failureReason: 'Invalid password',
        userAgent: context.userAgent,
      }).catch(() => {});

      return res.status(401).json({
        error: 'Invalid email or password. Please check your credentials.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Merge guest activity if provided
    if (guestData) {
      mergeGuestDataIntoUser(user, guestData);
      await user.save();
    }

    // Check trusted device status via cookie
    const rawDeviceCookie = extractDeviceToken(req);
    let isTrusted = false;
    let trustedDeviceDoc = null;

    if (rawDeviceCookie) {
      const incomingHash = crypto.createHash('sha256').update(rawDeviceCookie).digest('hex');
      trustedDeviceDoc = await TrustedDevice.findOne({
        userId: user._id,
        deviceTokenHash: incomingHash,
        isRevoked: { $ne: true },
        expiresAt: { $gt: new Date() },
      });

      if (trustedDeviceDoc) {
        isTrusted = true;
      }
    }

    // ── Trusted Device Path: Direct Sign-in ───────────────────────────────────
    if (isTrusted && trustedDeviceDoc) {
      // Roll forward 30-day expiry and update last-used metadata
      trustedDeviceDoc.lastUsedAt = new Date();
      trustedDeviceDoc.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      trustedDeviceDoc.lastIp = context.ip;
      trustedDeviceDoc.lastLocation = context.location;
      await trustedDeviceDoc.save();

      // Refresh device cookie (30 days) and session cookie (7 days)
      setDeviceCookie(res, rawDeviceCookie);
      const token = signToken(user._id);
      setAuthCookie(res, token);

      // Record successful login audit
      await LoginHistory.create({
        userId: user._id,
        ip: context.ip,
        browser: context.browser,
        browserVersion: context.browserVersion,
        os: context.os,
        osVersion: context.osVersion,
        deviceType: context.deviceType,
        deviceModel: context.deviceModel,
        location: context.location,
        status: 'success',
        userAgent: context.userAgent,
      });

      const resolvedTheme = resolveTheme(user.themePreference);

      return res.status(200).json({
        success: true,
        message: 'Signed in successfully',
        user: user.toSafeObject(),
        resolvedTheme,
      });
    }

    // ── Untrusted Context: Step-Up OTP Gating ─────────────────────────────────
    // Never issue the normal authenticated session cookie (vv_token) here!
    const sessionId = new mongoose.Types.ObjectId().toString();
    const tempToken = signTempToken(user._id, sessionId);

    let sessionResult;
    try {
      sessionResult = await createOtpSession({
        sessionId,
        userId: user._id,
        email: user.email,
        tempToken,
        deviceContext: context,
      });
    } catch (sessionErr) {
      return res.status(429).json({
        error: sessionErr.message,
        code: 'TOO_MANY_REQUESTS',
      });
    }

    // Production SMTP failure resilience: if in production and email failed to dispatch
    if (process.env.NODE_ENV === 'production' && !sessionResult.delivery.sent) {
      await LoginHistory.create({
        userId: user._id,
        ip: context.ip,
        browser: context.browser,
        browserVersion: context.browserVersion,
        os: context.os,
        osVersion: context.osVersion,
        deviceType: context.deviceType,
        deviceModel: context.deviceModel,
        location: context.location,
        status: 'failed',
        failureReason: 'Email delivery failed',
        userAgent: context.userAgent,
      }).catch(() => {});

      return res.status(502).json({
        success: false,
        requiresOtp: true,
        tempToken,
        sessionId: sessionResult.sessionId,
        error: 'Verification code could not be sent. Please check your connection or click Resend Code.',
        code: 'EMAIL_DELIVERY_FAILED',
        canResendIn: 60,
      });
    }

    // Record OTP required login attempt
    await LoginHistory.create({
      userId: user._id,
      ip: context.ip,
      browser: context.browser,
      browserVersion: context.browserVersion,
      os: context.os,
      osVersion: context.osVersion,
      deviceType: context.deviceType,
      deviceModel: context.deviceModel,
      location: context.location,
      status: 'otp_required',
      userAgent: context.userAgent,
    });

    return res.status(200).json({
      success: false,
      requiresOtp: true,
      tempToken,
      sessionId: sessionResult.sessionId,
      destinationMasked: maskEmail(user.email),
      expiresIn: 300,
      resendAvailableIn: 60,
      message: 'New device detected. A 6-digit verification code has been sent to your registered email.',
    });
  } catch (err) {
    console.error('[Auth Login Error]:', err.message);
    return res.status(500).json({ error: 'Server error during sign in. Please try again.' });
  }
});

/**
 * POST /api/auth/verify-otp
 * Verifies submitted 6-digit OTP code with per-session salting and atomic verification.
 * Constraints enforced:
 * - Incorrect OTPs increment attempts without verifying.
 * - On 5th failure, atomically exhaust session.
 * - Concurrent valid submissions cannot both succeed (atomic conditional transition).
 * - Safe error handling: never report success if trusted device / session cannot be persisted.
 */
router.post('/verify-otp', requireTempAuth, async (req, res) => {
  try {
    const { otp, deviceName } = req.body;
    const { user, userId, sessionId } = req.tempAuth;

    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      return res.status(400).json({
        error: 'Please provide a valid 6-digit verification code.',
        code: 'INVALID_OTP_FORMAT',
      });
    }

    const cleanOtp = otp.trim();

    // 1. Locate the active OTP session
    const session = await OtpSession.findOne({
      userId,
      status: 'pending',
    }).sort({ createdAt: -1 });

    if (!session) {
      return res.status(400).json({
        error: 'No active verification session found. Please sign in again.',
        code: 'SESSION_NOT_FOUND',
      });
    }

    // 2. Check expiration
    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      return res.status(400).json({
        error: 'Verification code has expired. Please request a new code.',
        code: 'OTP_EXPIRED',
      });
    }

    // 3. Check attempt limit
    if (session.attempts >= 5) {
      session.status = 'exhausted';
      await session.save();
      return res.status(400).json({
        error: 'Maximum verification attempts exceeded. Please request a new code.',
        code: 'OTP_EXHAUSTED',
      });
    }

    // 4. Verify candidate OTP hash against per-session salt
    // Constraint: Verify hash before atomically consuming. Incorrect OTPs increment attempts.
    const candidateHash = hashOtp(cleanOtp, session.salt);

    if (candidateHash !== session.otpHash) {
      // Atomically increment attempts; if 5th attempt, atomically exhaust
      const updatedSession = await OtpSession.findOneAndUpdate(
        { _id: session._id, status: 'pending' },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' }
      );

      if (updatedSession && updatedSession.attempts >= 5) {
        await OtpSession.updateOne(
          { _id: session._id, status: 'pending' },
          { $set: { status: 'exhausted' } }
        );
      }

      const attemptsLeft = Math.max(0, 5 - (updatedSession?.attempts || (session.attempts + 1)));

      return res.status(400).json({
        error: attemptsLeft === 0
          ? 'Maximum verification attempts exceeded. Please request a new code.'
          : `Incorrect verification code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`,
        code: attemptsLeft === 0 ? 'OTP_EXHAUSTED' : 'INCORRECT_OTP',
        attemptsRemaining: attemptsLeft,
      });
    }

    // 5. Code is correct! Atomically transition status 'pending' -> 'verified'
    // Constraint: Concurrent valid submissions cannot both succeed.
    const atomicVerified = await OtpSession.findOneAndUpdate(
      {
        _id: session._id,
        userId,
        status: 'pending',
        expiresAt: { $gt: new Date() },
        attempts: { $lt: 5 },
      },
      {
        $set: {
          status: 'verified',
          verifiedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!atomicVerified) {
      return res.status(409).json({
        error: 'Verification session was already completed or expired.',
        code: 'OTP_ALREADY_USED',
      });
    }

    // 6. Safe state persistence
    // Constraint: Never report successful login if required auth state could not be persisted.
    try {
      const context = parseClientContext(req);
      const rawDeviceToken = crypto.randomBytes(32).toString('hex');
      const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');

      await TrustedDevice.create({
        userId,
        deviceTokenHash,
        deviceName: deviceName || context.deviceName,
        browser: context.browser,
        browserVersion: context.browserVersion,
        os: context.os,
        osVersion: context.osVersion,
        deviceType: context.deviceType,
        deviceModel: context.deviceModel,
        lastIp: context.ip,
        lastLocation: context.location,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trust
        isRevoked: false,
      });

      // Set cookies
      setDeviceCookie(res, rawDeviceToken);
      const sessionToken = signToken(userId);
      setAuthCookie(res, sessionToken);

      // Record successful login in audit trail
      await LoginHistory.create({
        userId,
        ip: context.ip,
        browser: context.browser,
        browserVersion: context.browserVersion,
        os: context.os,
        osVersion: context.osVersion,
        deviceType: context.deviceType,
        deviceModel: context.deviceModel,
        location: context.location,
        status: 'success',
        userAgent: context.userAgent,
      });

      const resolvedTheme = resolveTheme(user.themePreference);

      return res.status(200).json({
        success: true,
        message: 'Device verified and signed in successfully.',
        user: user.toSafeObject(),
        resolvedTheme,
      });
    } catch (persistErr) {
      console.error('[Device trust persistence error]', persistErr.message);
      clearAuthCookie(res);
      clearDeviceCookie(res);
      return res.status(500).json({
        error: 'Failed to establish trusted device session. Please try again.',
        code: 'SESSION_CREATION_FAILED',
      });
    }
  } catch (err) {
    console.error('[Verify OTP Error]', err.message);
    return res.status(500).json({ error: 'Failed to verify code. Please try again.' });
  }
});

/**
 * POST /api/auth/resend-otp
 * Generates and resends a fresh OTP adhering to server-enforced 60s cooldown.
 */
router.post('/resend-otp', requireTempAuth, async (req, res) => {
  try {
    const { userId, user, rawToken } = req.tempAuth;
    const context = parseClientContext(req);

    const latestSession = await OtpSession.findOne({ userId }).sort({ createdAt: -1 });

    if (latestSession && latestSession.status === 'pending') {
      if (new Date() < latestSession.resendAvailableAt) {
        const secondsLeft = Math.ceil((latestSession.resendAvailableAt - Date.now()) / 1000);
        return res.status(429).json({
          error: `Please wait ${secondsLeft}s before requesting a new code.`,
          code: 'RESEND_COOLDOWN_ACTIVE',
          canResendIn: secondsLeft,
        });
      }
      latestSession.status = 'expired';
      await latestSession.save();
    }

    let sessionResult;
    try {
      sessionResult = await createOtpSession({
        userId,
        email: user.email,
        tempToken: rawToken,
        deviceContext: context,
      });
    } catch (sessionErr) {
      return res.status(429).json({
        error: sessionErr.message,
        code: 'TOO_MANY_REQUESTS',
      });
    }

    if (process.env.NODE_ENV === 'production' && !sessionResult.delivery.sent) {
      return res.status(502).json({
        error: 'Verification code could not be sent. Please try again in 60s.',
        code: 'EMAIL_DELIVERY_FAILED',
        canResendIn: 60,
      });
    }

    return res.status(200).json({
      success: true,
      sessionId: sessionResult.sessionId,
      destinationMasked: maskEmail(user.email),
      expiresIn: 300,
      resendAvailableIn: 60,
      message: 'A new verification code has been sent to your email.',
    });
  } catch (err) {
    console.error('[Resend OTP Error]', err.message);
    return res.status(500).json({ error: 'Failed to resend verification code.' });
  }
});

/**
 * GET /api/auth/dev/last-otp
 * Local development testing helper ONLY.
 * Strictly disabled in production (returns 404).
 * Token-gated and session-validated.
 */
router.get('/dev/last-otp', requireTempAuth, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).end();
  }

  const { sessionId, rawToken, userId } = req.tempAuth;
  const otp = getDevOtp(sessionId, rawToken, userId);

  if (!otp) {
    return res.status(404).json({
      error: 'No active development OTP found for this session.',
      code: 'DEV_OTP_NOT_FOUND',
    });
  }

  return res.json({
    success: true,
    otp,
    note: 'Development mode only. This endpoint is disabled in production.',
  });
});

/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.status(200).json({
    success: true,
    message: 'Signed out successfully',
  });
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile using HTTP-only cookie session.
 */
router.get('/me', requireAuth, (req, res) => {
  const resolvedTheme = resolveTheme(req.user.themePreference);
  return res.status(200).json({
    success: true,
    user: req.user.toSafeObject(),
    resolvedTheme,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated User Activity Synchronization Endpoints
// (Directly reads and writes to MongoDB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/auth/likes
 * Toggles a video like in the user's MongoDB record
 */
router.put('/likes', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ error: 'videoId is required' });

    const user = req.user;
    const liked = new Set(user.likedVideos || []);
    const disliked = new Set(user.dislikedVideos || []);

    if (liked.has(videoId)) {
      liked.delete(videoId);
    } else {
      liked.add(videoId);
      disliked.delete(videoId); // Liking removes dislike
    }

    user.likedVideos = Array.from(liked);
    user.dislikedVideos = Array.from(disliked);
    await user.save();

    return res.json({
      success: true,
      likedVideos: user.likedVideos,
      dislikedVideos: user.dislikedVideos,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update like status' });
  }
});

/**
 * PUT /api/auth/dislikes
 * Toggles a video dislike in the user's MongoDB record
 */
router.put('/dislikes', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ error: 'videoId is required' });

    const user = req.user;
    const liked = new Set(user.likedVideos || []);
    const disliked = new Set(user.dislikedVideos || []);

    if (disliked.has(videoId)) {
      disliked.delete(videoId);
    } else {
      disliked.add(videoId);
      liked.delete(videoId); // Disliking removes like
    }

    user.likedVideos = Array.from(liked);
    user.dislikedVideos = Array.from(disliked);
    await user.save();

    return res.json({
      success: true,
      likedVideos: user.likedVideos,
      dislikedVideos: user.dislikedVideos,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update dislike status' });
  }
});

/**
 * PUT /api/auth/watch-later
 * Toggles a video in the user's Watch Later list in MongoDB
 */
router.put('/watch-later', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ error: 'videoId is required' });

    const user = req.user;
    const set = new Set(user.watchLater || []);

    if (set.has(videoId)) {
      set.delete(videoId);
    } else {
      set.add(videoId);
    }

    user.watchLater = Array.from(set);
    await user.save();

    return res.json({
      success: true,
      watchLater: user.watchLater,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update Watch Later' });
  }
});

/**
 * POST /api/auth/history
 * Appends a video to the user's watch history in MongoDB
 */
router.post('/history', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ error: 'videoId is required' });

    const user = req.user;
    const current = (user.watchHistory || []).filter(id => id !== videoId);
    // Add to front of history list (most recent first)
    user.watchHistory = [videoId, ...current].slice(0, 100);
    await user.save();

    return res.json({
      success: true,
      watchHistory: user.watchHistory,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update watch history' });
  }
});

/**
 * DELETE /api/auth/history
 * Clears the user's watch history in MongoDB
 */
router.delete('/history', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    user.watchHistory = [];
    await user.save();

    return res.json({
      success: true,
      watchHistory: [],
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to clear watch history' });
  }
});

/**
 * PUT /api/auth/subscriptions
 * Toggles a channel subscription in the user's MongoDB record
 */
router.put('/subscriptions', requireAuth, async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const user = req.user;
    const set = new Set(user.subscribedChannels || []);

    if (set.has(channelId)) {
      set.delete(channelId);
    } else {
      set.add(channelId);
    }

    user.subscribedChannels = Array.from(set);
    await user.save();

    return res.json({
      success: true,
      subscribedChannels: user.subscribedChannels,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update subscription' });
  }
});

/**
 * PUT /api/auth/profile
 * Updates user name or theme preference in MongoDB
 */
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, themePreference } = req.body;
    const user = req.user;

    if (name && name.trim()) {
      user.name = name.trim();
    }
    if (themePreference && ['dark', 'light', 'auto', 'system'].includes(themePreference)) {
      user.themePreference = themePreference;
    }

    await user.save();
    const resolvedTheme = resolveTheme(user.themePreference);

    return res.json({
      success: true,
      user: user.toSafeObject(),
      resolvedTheme,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Account Security Endpoints (Task 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/security/devices
 * Lists user's active trusted devices and flags current device
 */
router.get('/security/devices', requireAuth, async (req, res) => {
  try {
    const rawDeviceCookie = extractDeviceToken(req);
    const currentHash = rawDeviceCookie
      ? crypto.createHash('sha256').update(rawDeviceCookie).digest('hex')
      : null;

    const devices = await TrustedDevice.find({
      userId: req.user._id,
      isRevoked: { $ne: true },
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .lean();

    const safeDevices = devices.map(d => ({
      id: d._id.toString(),
      deviceName: d.deviceName,
      browser: d.browser,
      browserVersion: d.browserVersion,
      os: d.os,
      osVersion: d.osVersion,
      deviceType: d.deviceType,
      deviceModel: d.deviceModel,
      lastIp: d.lastIp,
      lastLocation: d.lastLocation,
      firstTrustedAt: d.firstTrustedAt,
      lastUsedAt: d.lastUsedAt,
      expiresAt: d.expiresAt,
      isCurrentDevice: currentHash ? d.deviceTokenHash === currentHash : false,
    }));

    return res.json({
      success: true,
      devices: safeDevices,
    });
  } catch (err) {
    console.error('[Get Security Devices Error]', err.message);
    return res.status(500).json({ error: 'Failed to load trusted devices.' });
  }
});

/**
 * DELETE /api/auth/security/devices/:id
 * Revokes a specific trusted device
 */
router.delete('/security/devices/:id', requireAuth, async (req, res) => {
  try {
    const device = await TrustedDevice.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found.' });
    }

    device.isRevoked = true;
    device.revokedAt = new Date();
    await device.save();

    // Check if the revoked device is the current device
    const rawDeviceCookie = extractDeviceToken(req);
    if (rawDeviceCookie) {
      const currentHash = crypto.createHash('sha256').update(rawDeviceCookie).digest('hex');
      if (device.deviceTokenHash === currentHash) {
        clearDeviceCookie(res);
      }
    }

    return res.json({
      success: true,
      message: 'Device revoked successfully.',
    });
  } catch (err) {
    console.error('[Revoke Device Error]', err.message);
    return res.status(500).json({ error: 'Failed to revoke device.' });
  }
});

/**
 * POST /api/auth/security/revoke-others
 * Revokes all trusted devices for user except the current device
 */
router.post('/security/revoke-others', requireAuth, async (req, res) => {
  try {
    const rawDeviceCookie = extractDeviceToken(req);
    let currentHash = null;
    if (rawDeviceCookie) {
      currentHash = crypto.createHash('sha256').update(rawDeviceCookie).digest('hex');
    }

    const filter = {
      userId: req.user._id,
      isRevoked: { $ne: true },
    };

    if (currentHash) {
      filter.deviceTokenHash = { $ne: currentHash };
    }

    const result = await TrustedDevice.updateMany(filter, {
      $set: { isRevoked: true, revokedAt: new Date() },
    });

    return res.json({
      success: true,
      message: `Revoked ${result.modifiedCount} other device(s).`,
      count: result.modifiedCount,
    });
  } catch (err) {
    console.error('[Revoke Others Error]', err.message);
    return res.status(500).json({ error: 'Failed to revoke other devices.' });
  }
});

/**
 * GET /api/auth/security/history
 * Returns user's recent login audit history
 */
router.get('/security/history', requireAuth, async (req, res) => {
  try {
    const history = await LoginHistory.find({ userId: req.user._id })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    const safeHistory = history.map(h => ({
      id: h._id.toString(),
      timestamp: h.timestamp,
      ip: h.ip,
      browser: h.browser,
      browserVersion: h.browserVersion,
      os: h.os,
      osVersion: h.osVersion,
      deviceType: h.deviceType,
      deviceModel: h.deviceModel,
      location: h.location,
      status: h.status,
      failureReason: h.failureReason,
    }));

    return res.json({
      success: true,
      history: safeHistory,
    });
  } catch (err) {
    console.error('[Get Security History Error]', err.message);
    return res.status(500).json({ error: 'Failed to load login history.' });
  }
});

module.exports = router;
