/**
 * VideoVerse — WebRTC Signaling Gateway (Socket.IO)
 *
 * Phase 6.1: Real-time video calling signaling foundation.
 *
 * Capabilities:
 * - JWT Handshake Authentication (HTTP-only 'vv_token' cookie or Bearer auth token)
 * - Room identifier validation (unguessable alphanumeric strings)
 * - 1-to-1 Room Capacity Enforcement (maximum 2 participants per room)
 * - Single-room membership enforcement per active socket
 * - Validated signaling events: join-room, offer, answer, ice-candidate, leave-room
 * - Automatic empty room and participant disconnect cleanup
 * - Safe logging without credential or token leakage
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const COOKIE_NAME = 'vv_token';
const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{6,64}$/;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ROOM_CREATIONS_PER_WINDOW = 5;
const MAX_ACTIVE_ROOMS_PER_CREATOR = 3;

// creationRateLimits: Map<userId, number[]> (sliding window timestamps)
const creationRateLimits = new Map();

// ── In-Memory Room & Session Management ─────────────────────────────────────
// rooms: Map<roomId, Map<socketId, ParticipantInfo>>
const rooms = new Map();

// socketToRoom: Map<socketId, roomId>
const socketToRoom = new Map();

/**
 * Parses HTTP cookie header into an object of key-value pairs
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      cookies[key] = decodeURIComponent(val);
    }
  });
  return cookies;
}

/**
 * Extracts JWT token from socket handshake (cookie primary, Bearer auth fallback)
 */
function extractSocketToken(handshake) {
  // 1. Primary: HTTP-only cookie
  const cookieHeader = handshake.headers?.cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies[COOKIE_NAME]) {
      return cookies[COOKIE_NAME];
    }
  }

  // 2. Fallback: auth object token (e.g. io(url, { auth: { token } }))
  if (handshake.auth && typeof handshake.auth.token === 'string') {
    const raw = handshake.auth.token.trim();
    if (raw.startsWith('Bearer ')) return raw.slice(7).trim();
    return raw;
  }

  // 3. Fallback: Authorization header
  if (handshake.headers?.authorization && typeof handshake.headers.authorization === 'string') {
    const raw = handshake.headers.authorization.trim();
    if (raw.startsWith('Bearer ')) return raw.slice(7).trim();
    return raw;
  }

  return null;
}

/**
 * Validates a room identifier for security and format
 * Unguessable, 6-64 chars, alphanumeric, hyphens, underscores
 */
function isValidRoomId(roomId) {
  if (typeof roomId !== 'string') return false;
  const trimmed = roomId.trim();
  if (!ROOM_ID_REGEX.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (['default', 'admin', 'null', 'undefined', 'room'].includes(lower)) return false;
  return true;
}

/**
 * Generates a cryptographically random, unguessable room ID
 */
function generateRoomId() {
  const rand = crypto.randomBytes(9).toString('base64url');
  return `call-${rand}`;
}

/**
 * Socket.IO Handshake Authentication Middleware
 * Enforces authenticated sessions using VideoVerse JWT tokens
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const token = extractSocketToken(socket.handshake);
    if (!token) {
      const err = new Error('AUTHENTICATION_ERROR: Authentication required');
      err.data = { code: 'AUTH_REQUIRED' };
      return next(err);
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      const err = new Error('SERVER_ERROR: JWT_SECRET not configured');
      return next(err);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      const err = new Error('AUTHENTICATION_ERROR: Invalid or expired token');
      err.data = { code: 'INVALID_TOKEN' };
      return next(err);
    }

    if (!decoded || !decoded.id) {
      const err = new Error('AUTHENTICATION_ERROR: Malformed token payload');
      err.data = { code: 'INVALID_PAYLOAD' };
      return next(err);
    }

    const user = await User.findById(decoded.id).select('_id name email avatar avatarColor initials');
    if (!user) {
      const err = new Error('AUTHENTICATION_ERROR: User account no longer exists');
      err.data = { code: 'USER_NOT_FOUND' };
      return next(err);
    }

    socket.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      avatarColor: user.avatarColor,
      initials: user.initials,
    };

    next();
  } catch (err) {
    console.error('[SocketAuth] Authentication error:', err.message);
    const authErr = new Error('AUTHENTICATION_ERROR: Internal auth failure');
    return next(authErr);
  }
}

const MAX_SDP_LENGTH = 65536; // 64 KB
const MAX_CANDIDATE_LENGTH = 2048; // 2 KB

/**
 * Removes socket from its current room and cleans up empty rooms
 */
function leaveCurrentRoom(socket, io) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) return null;

  socketToRoom.delete(socket.id);
  socket.leave(roomId);

  const room = rooms.get(roomId);
  if (room) {
    room.participants.delete(socket.id);

    // Notify remaining room participant
    io.to(roomId).emit('peer-left', {
      peerId: socket.id,
      userId: socket.user.id,
      name: socket.user.name,
      roomId,
    });
    io.to(roomId).emit('user-left', {
      peerId: socket.id,
      userId: socket.user.id,
      roomId,
    });

    if (room.participants.size === 0) {
      rooms.delete(roomId);
    }
  }

  return roomId;
}

/**
 * Initializes real-time signaling on the Socket.IO instance
 */
function initSignaling(io) {
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    // Safe logging without exposing tokens or cookies
    console.log(`[Socket.io] User connected: ${socket.user.id} (${socket.user.name}) [Socket ID: ${socket.id}]`);

    // ── 0. CREATE ROOM (Authenticated Server-Authoritative Room Lifecycle) ────
    socket.on('create-room', async (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};

      // 1. Invitee ID format validation (24-character hexadecimal ObjectId)
      const rawInviteeId = data?.inviteeId;
      if (!rawInviteeId || typeof rawInviteeId !== 'string' || !OBJECT_ID_REGEX.test(rawInviteeId.trim())) {
        return ack({
          success: false,
          error: 'INVALID_INVITEE_ID',
          message: 'inviteeId must be a valid 24-character hexadecimal MongoDB ObjectId.',
        });
      }

      const inviteeId = String(rawInviteeId).trim();
      const creatorId = String(socket.user.id);

      // 2. Reject self-invites
      if (inviteeId === creatorId) {
        return ack({
          success: false,
          error: 'SELF_INVITE_NOT_ALLOWED',
          message: 'You cannot invite yourself to a video call room.',
        });
      }

      // 3. Verify invitee exists in MongoDB
      try {
        const inviteeUser = await User.findById(inviteeId).select('_id name');
        if (!inviteeUser) {
          return ack({
            success: false,
            error: 'INVITEE_NOT_FOUND',
            message: 'The specified invitee account does not exist.',
          });
        }
      } catch (err) {
        console.error('[Socket.io] Error verifying invitee in MongoDB:', err.message);
        return ack({
          success: false,
          error: 'DB_ERROR',
          message: 'Failed to verify invitee account.',
        });
      }

      // 4. Per-authenticated-user room creation rate limiting
      const now = Date.now();
      const userTimestamps = (creationRateLimits.get(creatorId) || []).filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS
      );
      if (userTimestamps.length >= MAX_ROOM_CREATIONS_PER_WINDOW) {
        return ack({
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Room creation rate limit exceeded. Please wait a minute before creating another room.',
        });
      }

      // 5. Maximum active rooms per creator safeguard (pruning stale empty rooms first)
      const STALE_ROOM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      let activeCreatorRooms = 0;
      for (const [rId, r] of rooms.entries()) {
        if (r.participants.size === 0 && now - r.createdAt > STALE_ROOM_TIMEOUT_MS) {
          rooms.delete(rId);
          continue;
        }
        if (r.creatorId === creatorId) {
          activeCreatorRooms++;
        }
      }
      if (activeCreatorRooms >= MAX_ACTIVE_ROOMS_PER_CREATOR) {
        return ack({
          success: false,
          error: 'MAX_ACTIVE_ROOMS_EXCEEDED',
          message: `Active room limit reached (${MAX_ACTIVE_ROOMS_PER_CREATOR}). Please leave or wait for existing rooms to close.`,
        });
      }

      // Record rate limit timestamp
      userTimestamps.push(now);
      creationRateLimits.set(creatorId, userTimestamps);

      // Generate cryptographically secure unguessable room ID
      const roomId = generateRoomId();

      // Track ownership and authorized participant IDs in memory
      const allowedUserIds = new Set([creatorId, inviteeId]);

      const room = {
        roomId,
        creatorId,
        allowedUserIds,
        participants: new Map(),
        createdAt: now,
      };

      rooms.set(roomId, room);

      ack({
        success: true,
        roomId,
        creatorId,
        allowedUserIds: Array.from(allowedUserIds),
      });
    });

    // ── 1. JOIN ROOM ────────────────────────────────────────────────────────
    socket.on('join-room', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};

      const rawRoomId = typeof data === 'string' ? data : data?.roomId;
      const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : '';

      if (!isValidRoomId(roomId)) {
        return ack({
          success: false,
          error: 'INVALID_ROOM_ID',
          message: 'Invalid room identifier. Must be 6-64 alphanumeric characters, underscores, or hyphens.',
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return ack({
          success: false,
          error: 'ROOM_NOT_FOUND',
          message: 'Room does not exist or has already been closed.',
        });
      }

      // Authorization check: User must be creator or explicitly authorized invitee
      if (!room.allowedUserIds.has(String(socket.user.id))) {
        return ack({
          success: false,
          error: 'ROOM_ACCESS_DENIED',
          message: 'You are not authorized to join this call room.',
        });
      }

      // If user is already in a different room, leave it first (prevents multi-room leaking)
      const existingRoomId = socketToRoom.get(socket.id);
      if (existingRoomId && existingRoomId !== roomId) {
        leaveCurrentRoom(socket, io);
      }

      // Enforce 1-on-1 capacity (max 2 participants)
      if (!room.participants.has(socket.id) && room.participants.size >= 2) {
        return ack({
          success: false,
          error: 'ROOM_FULL',
          message: 'This video call room is full (maximum 2 participants).',
        });
      }

      const participantInfo = {
        socketId: socket.id,
        userId: socket.user.id,
        name: socket.user.name,
        avatar: socket.user.avatar,
        avatarColor: socket.user.avatarColor,
        initials: socket.user.initials,
        joinedAt: Date.now(),
      };

      room.participants.set(socket.id, participantInfo);
      socketToRoom.set(socket.id, roomId);
      socket.join(roomId);

      // Notify existing peer in the room
      socket.to(roomId).emit('peer-joined', {
        peerId: socket.id,
        user: socket.user,
        roomId,
      });
      socket.to(roomId).emit('user-joined', {
        peerId: socket.id,
        userId: socket.user.id,
        name: socket.user.name,
        avatarColor: socket.user.avatarColor,
        initials: socket.user.initials,
        roomId,
      });

      const participants = Array.from(room.participants.values()).map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        name: p.name,
        avatar: p.avatar,
        avatarColor: p.avatarColor,
        initials: p.initials,
        isSelf: p.socketId === socket.id,
      }));

      ack({
        success: true,
        roomId,
        participants,
        peerCount: room.participants.size,
      });
    });

    // ── 2. OFFER ────────────────────────────────────────────────────────────
    socket.on('offer', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!data || typeof data !== 'object') {
        return ack({ success: false, error: 'INVALID_PAYLOAD', message: 'Offer payload must be an object.' });
      }

      const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!roomId || !room || !room.participants.has(socket.id)) {
        return ack({ success: false, error: 'UNAUTHORIZED_ROOM', message: 'You must join the room before sending an offer.' });
      }

      if (!data.sdp) {
        return ack({ success: false, error: 'INVALID_SDP', message: 'Offer must include session description (SDP).' });
      }

      // Explicit exact SDP type matching
      const sdpType = typeof data.sdp === 'object' ? data.sdp.type : (typeof data.type === 'string' ? data.type : null);
      if (sdpType !== 'offer') {
        return ack({ success: false, error: 'INVALID_SDP_TYPE', message: 'Offer SDP type must be explicitly "offer".' });
      }

      // Extract and validate SDP string
      const sdpString = typeof data.sdp === 'string' ? data.sdp : data.sdp.sdp;
      if (!sdpString || typeof sdpString !== 'string' || sdpString.trim() === '') {
        return ack({ success: false, error: 'INVALID_SDP', message: 'SDP content must be a non-empty string.' });
      }

      if (Buffer.byteLength(sdpString, 'utf8') > MAX_SDP_LENGTH) {
        return ack({ success: false, error: 'SDP_TOO_LARGE', message: `SDP exceeds maximum size of ${MAX_SDP_LENGTH} bytes.` });
      }

      const payload = {
        type: 'offer',
        sdp: sdpString,
      };

      socket.to(roomId).emit('offer', {
        sdp: payload,
        from: socket.id,
        fromUser: socket.user,
        roomId,
      });

      ack({ success: true });
    });

    // ── 3. ANSWER ───────────────────────────────────────────────────────────
    socket.on('answer', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!data || typeof data !== 'object') {
        return ack({ success: false, error: 'INVALID_PAYLOAD', message: 'Answer payload must be an object.' });
      }

      const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!roomId || !room || !room.participants.has(socket.id)) {
        return ack({ success: false, error: 'UNAUTHORIZED_ROOM', message: 'You must join the room before sending an answer.' });
      }

      if (!data.sdp) {
        return ack({ success: false, error: 'INVALID_SDP', message: 'Answer must include session description (SDP).' });
      }

      // Explicit exact SDP type matching
      const sdpType = typeof data.sdp === 'object' ? data.sdp.type : (typeof data.type === 'string' ? data.type : null);
      if (sdpType !== 'answer') {
        return ack({ success: false, error: 'INVALID_SDP_TYPE', message: 'Answer SDP type must be explicitly "answer".' });
      }

      // Extract and validate SDP string
      const sdpString = typeof data.sdp === 'string' ? data.sdp : data.sdp.sdp;
      if (!sdpString || typeof sdpString !== 'string' || sdpString.trim() === '') {
        return ack({ success: false, error: 'INVALID_SDP', message: 'SDP content must be a non-empty string.' });
      }

      if (Buffer.byteLength(sdpString, 'utf8') > MAX_SDP_LENGTH) {
        return ack({ success: false, error: 'SDP_TOO_LARGE', message: `SDP exceeds maximum size of ${MAX_SDP_LENGTH} bytes.` });
      }

      const payload = {
        type: 'answer',
        sdp: sdpString,
      };

      socket.to(roomId).emit('answer', {
        sdp: payload,
        from: socket.id,
        fromUser: socket.user,
        roomId,
      });

      ack({ success: true });
    });

    // ── 4. ICE CANDIDATE ────────────────────────────────────────────────────
    socket.on('ice-candidate', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!data || typeof data !== 'object') {
        return ack({ success: false, error: 'INVALID_PAYLOAD', message: 'ICE candidate payload must be an object.' });
      }

      const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!roomId || !room || !room.participants.has(socket.id)) {
        return ack({ success: false, error: 'UNAUTHORIZED_ROOM', message: 'You must join the room before sending an ICE candidate.' });
      }

      const cand = data.candidate;
      if (!cand || typeof cand !== 'object') {
        return ack({ success: false, error: 'INVALID_CANDIDATE', message: 'Candidate payload must be an object.' });
      }

      // candidate string must be string; allows empty string for end-of-candidates
      if (typeof cand.candidate !== 'string') {
        return ack({ success: false, error: 'INVALID_CANDIDATE', message: 'candidate.candidate must be a string.' });
      }

      if (Buffer.byteLength(cand.candidate, 'utf8') > MAX_CANDIDATE_LENGTH) {
        return ack({ success: false, error: 'CANDIDATE_TOO_LARGE', message: `Candidate exceeds maximum length of ${MAX_CANDIDATE_LENGTH} bytes.` });
      }

      // sdpMid validation (string or null/undefined)
      if (cand.sdpMid !== undefined && cand.sdpMid !== null && typeof cand.sdpMid !== 'string') {
        return ack({ success: false, error: 'INVALID_SDP_MID', message: 'sdpMid must be a string or null.' });
      }
      if (typeof cand.sdpMid === 'string' && cand.sdpMid.length > 256) {
        return ack({ success: false, error: 'INVALID_SDP_MID', message: 'sdpMid exceeds maximum length.' });
      }

      // sdpMLineIndex validation (non-negative integer or null/undefined)
      if (cand.sdpMLineIndex !== undefined && cand.sdpMLineIndex !== null) {
        if (!Number.isInteger(cand.sdpMLineIndex) || cand.sdpMLineIndex < 0) {
          return ack({ success: false, error: 'INVALID_SDP_MLINE_INDEX', message: 'sdpMLineIndex must be a non-negative integer or null.' });
        }
      }

      const candidatePayload = {
        candidate: cand.candidate,
        sdpMid: cand.sdpMid !== undefined ? cand.sdpMid : null,
        sdpMLineIndex: cand.sdpMLineIndex !== undefined ? cand.sdpMLineIndex : null,
      };

      socket.to(roomId).emit('ice-candidate', {
        candidate: candidatePayload,
        from: socket.id,
        fromUser: socket.user,
        roomId,
      });

      ack({ success: true });
    });

    // ── 5. CLOSE / CANCEL ROOM ──────────────────────────────────────────────
    socket.on('close-room', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = typeof data === 'string' ? data : data?.roomId;
      const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.creatorId !== String(socket.user.id)) {
        return ack({ success: false, error: 'NOT_ROOM_CREATOR', message: 'Only the room creator can close this room.' });
      }

      // Notify and clean up
      io.to(roomId).emit('peer-left', { roomId, peerId: socket.id, userId: socket.user.id, reason: 'room-closed' });
      for (const sId of room.participants.keys()) {
        socketToRoom.delete(sId);
      }
      rooms.delete(roomId);
      ack({ success: true, roomId });
    });

    // ── 5b. RESET USER ROOMS (Test isolation & stale room recovery) ──────────
    socket.on('reset-user-rooms', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const creatorId = String(socket.user.id);
      for (const [rId, r] of rooms.entries()) {
        if (r.creatorId === creatorId) {
          rooms.delete(rId);
        }
      }
      creationRateLimits.delete(creatorId);
      ack({ success: true });
    });

    // ── 6. LEAVE ROOM ───────────────────────────────────────────────────────
    socket.on('leave-room', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const leftRoomId = leaveCurrentRoom(socket, io);
      ack({ success: true, roomId: leftRoomId });
    });

    // ── 7. DISCONNECT CLEANUP ───────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const leftRoomId = leaveCurrentRoom(socket, io);
      // Clean up any unjoined empty rooms created by this user
      for (const [rId, r] of rooms.entries()) {
        if (r.creatorId === String(socket.user.id) && r.participants.size === 0) {
          rooms.delete(rId);
        }
      }
      console.log(`[Socket.io] User disconnected: ${socket.user.id} (${socket.user.name}) [Reason: ${reason}]${leftRoomId ? ` [Left room: ${leftRoomId}]` : ''}`);
    });
  });
}

module.exports = {
  initSignaling,
  socketAuthMiddleware,
  extractSocketToken,
  isValidRoomId,
  generateRoomId,
  MAX_ROOM_CREATIONS_PER_WINDOW,
  MAX_ACTIVE_ROOMS_PER_CREATOR,
  _testRooms: rooms,
  _testSocketToRoom: socketToRoom,
  _testCreationRateLimits: creationRateLimits,
};
