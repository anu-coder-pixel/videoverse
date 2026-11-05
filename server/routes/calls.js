/**
 * VideoVerse — Video Calls API Routes
 *
 * Phase 6.3.1: Backend foundation for production-ready WebRTC TURN authentication.
 *
 * Endpoints:
 * - GET /api/calls/ice-servers: Authenticated endpoint returning STUN and ephemeral
 *   HMAC-SHA1 TURN credentials (RFC 5766 / RFC 7635).
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getIceServerConfig } = require('../utils/turnCredentials');

/**
 * GET /api/calls/ice-servers
 *
 * Requirements:
 * - Requires verified JWT authentication (requireAuth middleware).
 * - Derives user ID strictly from req.user (authenticated identity).
 * - Client cannot override or inject user identity via query/body.
 * - Returns STUN configuration and ephemeral TURN credentials if configured.
 * - Never returns or leaks the backend TURN_SHARED_SECRET.
 * - Returns 401 for unauthenticated requests.
 */
router.get('/ice-servers', requireAuth, (req, res) => {
  try {
    // Derive user ID strictly from verified server-side session
    const currentUserId = req.user?._id ? req.user._id.toString() : req.user?.id;
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        error: 'AUTH_REQUIRED',
        message: 'Valid user session required.',
      });
    }

    // Generate safe ICE configuration
    const config = getIceServerConfig({ userId: currentUserId });

    return res.status(200).json(config);
  } catch (err) {
    console.error('[calls/ice-servers] Error generating ICE configuration:', err.message);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to generate ICE server configuration.',
    });
  }
});

module.exports = router;
