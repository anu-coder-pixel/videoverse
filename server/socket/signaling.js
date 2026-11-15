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
const MAX_GROUP_CAPACITY = 5;
const MAX_DIRECT_CAPACITY = 2;

// creationRateLimits: Map<userId, number[]> (sliding window timestamps)
const creationRateLimits = new Map();

// ── In-Memory Room & Session Management ─────────────────────────────────────
// rooms: Map<roomId, Map<socketId, ParticipantInfo>>
const rooms = new Map();

// socketToRoom: Map<socketId, roomId>
const socketToRoom = new Map();

// pendingInvitations: Map<roomId, { roomId, creatorId, inviteeId, timer, createdAt }>
const pendingInvitations = new Map();
let globalIoRef = null;

// userSockets: Map<userId, Set<socketId>> (Authenticated Socket.IO presence tracking across tabs/devices)
const userSockets = new Map();

/**
 * Checks whether an authenticated user has at least one active socket connected
 */
function isUserOnline(userId) {
  if (!userId) return false;
  const sSet = userSockets.get(String(userId));
  return Boolean(sSet && sSet.size > 0);
}

const INVITATION_TIMEOUT_MS = 30 * 1000; // 30-second unanswered call timeout

/**
 * Checks whether a user is currently participating in an active call
 */
function isUserInCall(userId) {
  const uId = String(userId);
  for (const room of rooms.values()) {
    for (const participant of room.participants.values()) {
      if (String(participant.userId) === uId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether a user is the host or an authorized co-host of a room
 */
function isHostOrCoHost(room, userId) {
  if (!room || !userId) return false;
  const uId = String(userId);
  return room.creatorId === uId || room.hostId === uId || (room.coHostIds && room.coHostIds.has(uId));
}

/**
 * Checks whether a user is currently receiving an active call invitation from another user
 */
function isUserReceivingCall(userId, excludeCreatorId = null) {
  const uId = String(userId);
  for (const inv of pendingInvitations.values()) {
    if (inv.inviteeId === uId) {
      if (!excludeCreatorId || inv.creatorId !== String(excludeCreatorId)) {
        return true;
      }
    }
  }
  return false;
}

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
const MAX_CHAT_MESSAGE_LENGTH = 1000; // 1000 characters

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
  globalIoRef = io;
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = String(socket.user.id);
    const wasOnline = isUserOnline(userId);
    let sSet = userSockets.get(userId);
    if (!sSet) {
      sSet = new Set();
      userSockets.set(userId, sSet);
    }
    sSet.add(socket.id);

    // If first connected socket for this user, broadcast real-time online presence update
    if (!wasOnline) {
      io.emit('user-presence', {
        userId,
        status: 'online',
      });
    }

    // Authenticated Socket.IO private room for user-to-user notification routing
    socket.join(`user:${userId}`);

    // Safe logging without exposing tokens or cookies
    console.log(`[Socket.io] User connected: ${userId} (${socket.user.name}) [Socket ID: ${socket.id}]`);

    // ── PRESENCE: GET ONLINE USERS ──────────────────────────────────────────
    socket.on('get-online-users', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      // Return only authenticated user IDs to ensure minimal information disclosure
      ack({
        success: true,
        onlineUserIds: Array.from(userSockets.keys()),
      });
    });

    // ── 0. CREATE ROOM (Authenticated Server-Authoritative Room Lifecycle) ────
    socket.on('create-room', async (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const creatorId = String(socket.user.id);
      const callType = data?.callType === 'group' ? 'group' : 'direct';
      const maxParticipants = callType === 'group' ? MAX_GROUP_CAPACITY : MAX_DIRECT_CAPACITY;

      const allowedUserIds = new Set([creatorId]);

      if (callType === 'group') {
        // ── Group Room: accept inviteeIds array or single inviteeId ──
        let rawInviteeIds = [];
        if (Array.isArray(data?.inviteeIds)) {
          rawInviteeIds = data.inviteeIds;
        } else if (typeof data?.inviteeId === 'string') {
          rawInviteeIds = [data.inviteeId];
        }

        if (rawInviteeIds.length === 0) {
          return ack({
            success: false,
            error: 'INVALID_INVITEE_IDS',
            message: 'Group call requires at least one invitee.',
          });
        }

        const validInviteeIds = [];
        for (const rawId of rawInviteeIds) {
          if (!rawId || typeof rawId !== 'string' || !OBJECT_ID_REGEX.test(rawId.trim())) {
            return ack({
              success: false,
              error: 'INVALID_INVITEE_ID',
              message: 'Each inviteeId must be a valid 24-character hexadecimal MongoDB ObjectId.',
            });
          }
          const trimmed = rawId.trim();
          if (trimmed === creatorId) {
            return ack({
              success: false,
              error: 'SELF_INVITE_NOT_ALLOWED',
              message: 'You cannot invite yourself to a video call room.',
            });
          }
          if (!validInviteeIds.includes(trimmed)) {
            validInviteeIds.push(trimmed);
          }
        }

        if (validInviteeIds.length > MAX_GROUP_CAPACITY - 1) {
          return ack({
            success: false,
            error: 'MAX_INVITEES_EXCEEDED',
            message: `Group call allows a maximum of ${MAX_GROUP_CAPACITY - 1} invitees (${MAX_GROUP_CAPACITY} participants total).`,
          });
        }

        // Verify all invitees exist in MongoDB
        try {
          const foundUsers = await User.find({ _id: { $in: validInviteeIds } }).select('_id name');
          if (foundUsers.length !== validInviteeIds.length) {
            return ack({
              success: false,
              error: 'INVITEE_NOT_FOUND',
              message: 'One or more invitee accounts do not exist.',
            });
          }
        } catch (err) {
          console.error('[Socket.io] Error verifying group invitees in MongoDB:', err.message);
          return ack({
            success: false,
            error: 'DB_ERROR',
            message: 'Failed to verify invitee accounts.',
          });
        }

        for (const id of validInviteeIds) {
          allowedUserIds.add(id);
        }
      } else {
        // ── Direct 1-to-1 Room: single invitee with busy check and timeout ──
        const rawInviteeId = data?.inviteeId;
        if (!rawInviteeId || typeof rawInviteeId !== 'string' || !OBJECT_ID_REGEX.test(rawInviteeId.trim())) {
          return ack({
            success: false,
            error: 'INVALID_INVITEE_ID',
            message: 'inviteeId must be a valid 24-character hexadecimal MongoDB ObjectId.',
          });
        }

        const inviteeId = String(rawInviteeId).trim();

        if (inviteeId === creatorId) {
          return ack({
            success: false,
            error: 'SELF_INVITE_NOT_ALLOWED',
            message: 'You cannot invite yourself to a video call room.',
          });
        }

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

        if (isUserInCall(inviteeId) || isUserReceivingCall(inviteeId, creatorId)) {
          return ack({
            success: false,
            error: 'INVITEE_BUSY',
            message: 'The contact is currently in another call or unavailable.',
          });
        }

        for (const [prevRoomId, inv] of pendingInvitations.entries()) {
          if (inv.creatorId === creatorId) {
            clearTimeout(inv.timer);
            pendingInvitations.delete(prevRoomId);
            io.to(`user:${inv.inviteeId}`).emit('call-cancelled', {
              roomId: prevRoomId,
              creatorId,
              reason: 'superseded',
            });
          }
        }

        allowedUserIds.add(inviteeId);
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

      const room = {
        roomId,
        creatorId,
        hostId: creatorId,
        coHostIds: new Set(),
        isLocked: false,
        callType,
        maxParticipants,
        allowedUserIds,
        participants: new Map(),
        createdAt: now,
      };

      rooms.set(roomId, room);

      // Caller details derived EXCLUSIVELY from authenticated server-side socket.user
      const caller = {
        id: socket.user.id,
        name: socket.user.name,
        avatar: socket.user.avatar,
        avatarColor: socket.user.avatarColor,
        initials: socket.user.initials,
      };

      if (callType === 'direct') {
        const inviteeId = Array.from(allowedUserIds).find((id) => id !== creatorId);
        const inviteeOnline = isUserOnline(inviteeId);

        const timer = setTimeout(() => {
          const inv = pendingInvitations.get(roomId);
          if (inv) {
            pendingInvitations.delete(roomId);
            io.to(`user:${inv.creatorId}`).emit('call-timeout', { roomId, inviteeId: inv.inviteeId });
            io.to(`user:${inv.inviteeId}`).emit('call-timeout', { roomId, creatorId: inv.creatorId });
          }
        }, INVITATION_TIMEOUT_MS);

        pendingInvitations.set(roomId, {
          roomId,
          creatorId,
          creatorSocketId: socket.id,
          inviteeId,
          timer,
          createdAt: now,
        });

        io.to(`user:${inviteeId}`).emit('incoming-call', {
          roomId,
          caller,
          callType: 'direct',
          createdAt: now,
        });

        ack({
          success: true,
          roomId,
          creatorId,
          callType: 'direct',
          maxParticipants: 2,
          allowedUserIds: Array.from(allowedUserIds),
          inviteeOnline,
        });
      } else {
        // Group Call: emit incoming-call to all invitees
        const inviteeIds = Array.from(allowedUserIds).filter((id) => id !== creatorId);
        const inviteeStatuses = {};
        for (const invId of inviteeIds) {
          inviteeStatuses[invId] = {
            online: isUserOnline(invId),
            inCall: isUserInCall(invId),
          };
          io.to(`user:${invId}`).emit('incoming-call', {
            roomId,
            caller,
            callType: 'group',
            createdAt: now,
          });
        }

        ack({
          success: true,
          roomId,
          creatorId,
          callType: 'group',
          maxParticipants: MAX_GROUP_CAPACITY,
          allowedUserIds: Array.from(allowedUserIds),
          inviteeStatuses,
        });
      }
    });

    // ── 0b. INVITE TO ACTIVE GROUP ROOM ────────────────────────────────────
    socket.on('invite-to-room', async (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const roomId = typeof data?.roomId === 'string' ? data.roomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !room.participants.has(socket.id)) {
        return ack({ success: false, error: 'UNAUTHORIZED_ROOM', message: 'You must be in the room to invite others.' });
      }
      if (room.callType !== 'group') {
        return ack({ success: false, error: 'DIRECT_CALL_CANNOT_INVITE', message: 'Cannot add invitees to a direct 1-to-1 call.' });
      }
      const rawInviteeId = data?.inviteeId;
      if (!rawInviteeId || typeof rawInviteeId !== 'string' || !OBJECT_ID_REGEX.test(rawInviteeId.trim())) {
        return ack({ success: false, error: 'INVALID_INVITEE_ID', message: 'inviteeId must be a valid 24-character hexadecimal MongoDB ObjectId.' });
      }
      const inviteeId = rawInviteeId.trim();
      if (room.allowedUserIds.has(inviteeId)) {
        return ack({ success: false, error: 'ALREADY_ALLOWED', message: 'User is already authorized for this room.' });
      }
      if (room.allowedUserIds.size >= room.maxParticipants) {
        return ack({ success: false, error: 'ROOM_CAPACITY_REACHED', message: `Cannot authorize more than ${room.maxParticipants} participants.` });
      }
      try {
        const inviteeUser = await User.findById(inviteeId).select('_id name');
        if (!inviteeUser) {
          return ack({ success: false, error: 'INVITEE_NOT_FOUND', message: 'Invitee user not found.' });
        }
      } catch (err) {
        return ack({ success: false, error: 'DB_ERROR', message: 'Failed to verify invitee.' });
      }
      room.allowedUserIds.add(inviteeId);
      io.to(`user:${inviteeId}`).emit('incoming-call', {
        roomId,
        caller: {
          id: socket.user.id,
          name: socket.user.name,
          avatar: socket.user.avatar,
          avatarColor: socket.user.avatarColor,
          initials: socket.user.initials,
        },
        callType: 'group',
        createdAt: Date.now(),
      });
      io.to(roomId).emit('room-allowed-updated', {
        roomId,
        allowedUserIds: Array.from(room.allowedUserIds),
      });
      ack({ success: true, roomId, allowedUserIds: Array.from(room.allowedUserIds) });
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
          callType: room.callType || 'direct',
          message: room.callType === 'group'
            ? 'Access Denied: You are not on the authorized participant list for this room.'
            : 'Access Denied: You are not authorized to join this room. Only the room creator and designated invitee may enter.',
        });
      }

      // Enforce room lock status (locked rooms prevent new entries)
      if (room.isLocked && !room.participants.has(socket.id) && !isHostOrCoHost(room, socket.user.id)) {
        return ack({
          success: false,
          error: 'ROOM_LOCKED',
          message: 'This video call room has been locked by the host.',
        });
      }

      // If user is already in a different room, leave it first (prevents multi-room leaking)
      const existingRoomId = socketToRoom.get(socket.id);
      if (existingRoomId && existingRoomId !== roomId) {
        leaveCurrentRoom(socket, io);
      }

      const maxParticipants = room.maxParticipants || (room.callType === 'group' ? MAX_GROUP_CAPACITY : MAX_DIRECT_CAPACITY);

      // Enforce room capacity (max 2 for direct, max 5 for group)
      if (!room.participants.has(socket.id) && room.participants.size >= maxParticipants) {
        return ack({
          success: false,
          error: 'ROOM_FULL',
          callType: room.callType || 'direct',
          maxParticipants,
          message: `This video call room is full (maximum ${maxParticipants} participants).`,
        });
      }

      // Existing peers in the room before this socket joined (excluding self)
      const existingPeers = Array.from(room.participants.values())
        .filter((p) => p.socketId !== socket.id)
        .map((p) => ({
          peerId: p.socketId,
          socketId: p.socketId,
          userId: p.userId,
          name: p.name,
          avatar: p.avatar,
          avatarColor: p.avatarColor,
          initials: p.initials,
          joinedAt: p.joinedAt,
        }));

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

      // If designated invitee joins in direct call, clear pending invitation and notify
      const inv = pendingInvitations.get(roomId);
      if (inv && String(socket.user.id) === inv.inviteeId) {
        clearTimeout(inv.timer);
        pendingInvitations.delete(roomId);
        io.to(`user:${inv.inviteeId}`).emit('call-accepted', { roomId, acceptedBy: socket.user.id });
        io.to(`user:${inv.creatorId}`).emit('call-accepted', { roomId, acceptedBy: socket.user.id });
      }

      // Notify existing peers in the room
      socket.to(roomId).emit('peer-joined', {
        peerId: socket.id,
        user: socket.user,
        roomId,
      });
      socket.to(roomId).emit('user-joined', {
        peerId: socket.id,
        userId: socket.user.id,
        name: socket.user.name,
        avatar: socket.user.avatar,
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
        isHost: String(p.userId) === String(room.creatorId),
        isCoHost: Boolean(room.coHostIds && room.coHostIds.has(String(p.userId))),
        isMuted: Boolean(p.isMuted),
        isVideoOff: Boolean(p.isVideoOff),
        isHandRaised: Boolean(p.isHandRaised),
      }));

      const isCreator = room.creatorId === String(socket.user.id);
      const isCoHost = Boolean(room.coHostIds && room.coHostIds.has(String(socket.user.id)));

      ack({
        success: true,
        roomId,
        creatorId: room.creatorId,
        hostId: room.creatorId,
        coHostIds: Array.from(room.coHostIds || []),
        isLocked: Boolean(room.isLocked),
        callType: room.callType || 'direct',
        maxParticipants,
        isCreator,
        isCoHost,
        allowedUserIds: Array.from(room.allowedUserIds || []),
        participants,
        peers: existingPeers,
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

      const targetSocketId = typeof data.to === 'string' ? data.to.trim() : null;

      if (targetSocketId) {
        if (!room.participants.has(targetSocketId)) {
          return ack({
            success: false,
            error: 'TARGET_NOT_IN_ROOM',
            message: 'Target participant is not in this room.',
          });
        }
        if (targetSocketId === socket.id) {
          return ack({
            success: false,
            error: 'INVALID_TARGET',
            message: 'Cannot send signaling offer to yourself.',
          });
        }

        io.to(targetSocketId).emit('offer', {
          sdp: payload,
          to: targetSocketId,
          from: socket.id,
          fromUser: socket.user,
          roomId,
        });
      } else {
        socket.to(roomId).emit('offer', {
          sdp: payload,
          from: socket.id,
          fromUser: socket.user,
          roomId,
        });
      }

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

      const targetSocketId = typeof data.to === 'string' ? data.to.trim() : null;

      if (targetSocketId) {
        if (!room.participants.has(targetSocketId)) {
          return ack({
            success: false,
            error: 'TARGET_NOT_IN_ROOM',
            message: 'Target participant is not in this room.',
          });
        }
        if (targetSocketId === socket.id) {
          return ack({
            success: false,
            error: 'INVALID_TARGET',
            message: 'Cannot send signaling answer to yourself.',
          });
        }

        io.to(targetSocketId).emit('answer', {
          sdp: payload,
          to: targetSocketId,
          from: socket.id,
          fromUser: socket.user,
          roomId,
        });
      } else {
        socket.to(roomId).emit('answer', {
          sdp: payload,
          from: socket.id,
          fromUser: socket.user,
          roomId,
        });
      }

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

      const targetSocketId = typeof data.to === 'string' ? data.to.trim() : null;

      if (targetSocketId) {
        if (!room.participants.has(targetSocketId)) {
          return ack({
            success: false,
            error: 'TARGET_NOT_IN_ROOM',
            message: 'Target participant is not in this room.',
          });
        }
        if (targetSocketId === socket.id) {
          return ack({
            success: false,
            error: 'INVALID_TARGET',
            message: 'Cannot send ICE candidate to yourself.',
          });
        }

        io.to(targetSocketId).emit('ice-candidate', {
          candidate: candidatePayload,
          to: targetSocketId,
          from: socket.id,
          fromUser: socket.user,
          roomId,
        });
      } else {
        socket.to(roomId).emit('ice-candidate', {
          candidate: candidatePayload,
          from: socket.id,
          fromUser: socket.user,
          roomId,
        });
      }

      ack({ success: true });
    });

    // ── 4b. IN-CALL TEXT CHAT (Phase 6.7) ───────────────────────────────────
    socket.on('call-chat-message', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!data || typeof data !== 'object') {
        return ack({
          success: false,
          error: 'INVALID_PAYLOAD',
          message: 'Chat payload must be an object.',
        });
      }

      const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!roomId || !room || !room.participants.has(socket.id)) {
        return ack({
          success: false,
          error: 'UNAUTHORIZED_ROOM',
          message: 'You must join the room before sending chat messages.',
        });
      }

      if (typeof data.text !== 'string') {
        return ack({
          success: false,
          error: 'INVALID_MESSAGE',
          message: 'Message text must be a string.',
        });
      }

      const trimmedText = data.text.trim();
      if (!trimmedText) {
        return ack({
          success: false,
          error: 'EMPTY_MESSAGE',
          message: 'Message text cannot be empty.',
        });
      }

      if (trimmedText.length > MAX_CHAT_MESSAGE_LENGTH) {
        return ack({
          success: false,
          error: 'MESSAGE_TOO_LONG',
          message: `Message exceeds maximum length of ${MAX_CHAT_MESSAGE_LENGTH} characters.`,
        });
      }

      // Sender identity derived EXCLUSIVELY from authenticated server-side socket.user session
      const messagePayload = {
        id: `msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        roomId,
        text: trimmedText,
        senderId: socket.user.id,
        senderName: socket.user.name,
        senderAvatar: socket.user.avatar || null,
        senderAvatarColor: socket.user.avatarColor || '#6366f1',
        senderInitials: socket.user.initials || 'U',
        timestamp: new Date().toISOString(),
      };

      // Broadcast to all participants in the room
      io.to(roomId).emit('call-chat-message', messagePayload);

      ack({ success: true, message: messagePayload });
    });

    // ── 5. CLOSE / CANCEL ROOM ──────────────────────────────────────────────
    socket.on('close-room', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = typeof data === 'string' ? data : data?.roomId;
      const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !isHostOrCoHost(room, socket.user.id)) {
        return ack({ success: false, error: 'NOT_ROOM_CREATOR', message: 'Only the room creator or co-host can close this room.' });
      }

      // Clear any pending invitation for this room and notify invitee
      const inv = pendingInvitations.get(roomId);
      if (inv) {
        clearTimeout(inv.timer);
        pendingInvitations.delete(roomId);
        io.to(`user:${inv.inviteeId}`).emit('call-cancelled', {
          roomId,
          creatorId: inv.creatorId,
          reason: 'room-closed',
        });
      }

      // Notify and clean up
      io.to(roomId).emit('peer-left', { roomId, peerId: socket.id, userId: socket.user.id, reason: 'room-closed' });
      for (const sId of room.participants.keys()) {
        socketToRoom.delete(sId);
      }
      rooms.delete(roomId);
      ack({ success: true, roomId });
    });

    // ── 5c. MODERATION: MUTE PARTICIPANT ────────────────────────────────────
    socket.on('mute-participant', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = data?.roomId || socketToRoom.get(socket.id);
      const targetSocketId = data?.targetSocketId || data?.peerId;
      const targetUserId = data?.targetUserId ? String(data.targetUserId) : null;
      const room = rawRoomId ? rooms.get(rawRoomId) : null;

      if (!room) {
        return ack({ success: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' });
      }

      if (!isHostOrCoHost(room, socket.user.id)) {
        return ack({ success: false, error: 'FORBIDDEN', message: 'Host or co-host permission required to mute participants.' });
      }

      let target = null;
      if (targetSocketId && room.participants.has(targetSocketId)) {
        target = room.participants.get(targetSocketId);
      } else if (targetUserId) {
        for (const p of room.participants.values()) {
          if (String(p.userId) === targetUserId) {
            target = p;
            break;
          }
        }
      }

      if (!target) {
        return ack({ success: false, error: 'PARTICIPANT_NOT_FOUND', message: 'Target participant not found in this room.' });
      }

      io.to(target.socketId).emit('moderation-mute', {
        roomId: room.roomId,
        mutedBy: socket.user.id,
        audio: data?.audio !== false,
        video: Boolean(data?.video),
      });

      io.to(room.roomId).emit('participant-muted', {
        roomId: room.roomId,
        peerId: target.socketId,
        userId: target.userId,
        mutedBy: socket.user.id,
      });

      ack({ success: true, message: 'Participant muted successfully.' });
    });

    // ── 5d. MODERATION: REMOVE PARTICIPANT ──────────────────────────────────
    socket.on('remove-participant', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = data?.roomId || socketToRoom.get(socket.id);
      const targetSocketId = data?.targetSocketId || data?.peerId;
      const targetUserId = data?.targetUserId ? String(data.targetUserId) : null;
      const room = rawRoomId ? rooms.get(rawRoomId) : null;

      if (!room) {
        return ack({ success: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' });
      }

      if (!isHostOrCoHost(room, socket.user.id)) {
        return ack({ success: false, error: 'FORBIDDEN', message: 'Host or co-host permission required to remove participants.' });
      }

      let targetInfo = null;
      if (targetSocketId && room.participants.has(targetSocketId)) {
        targetInfo = room.participants.get(targetSocketId);
      } else if (targetUserId) {
        for (const p of room.participants.values()) {
          if (String(p.userId) === targetUserId) {
            targetInfo = p;
            break;
          }
        }
      }

      if (!targetInfo) {
        return ack({ success: false, error: 'PARTICIPANT_NOT_FOUND', message: 'Target participant not found in this room.' });
      }

      if (String(targetInfo.userId) === String(room.creatorId)) {
        return ack({ success: false, error: 'CANNOT_REMOVE_HOST', message: 'The room creator/host cannot be removed.' });
      }

      room.allowedUserIds.delete(String(targetInfo.userId));
      room.participants.delete(targetInfo.socketId);
      socketToRoom.delete(targetInfo.socketId);

      const targetSocket = io.sockets.sockets.get(targetInfo.socketId);
      if (targetSocket) {
        targetSocket.leave(room.roomId);
        targetSocket.emit('moderation-removed', {
          roomId: room.roomId,
          reason: 'removed_by_host',
          removedBy: socket.user.id,
        });
      }

      io.to(room.roomId).emit('peer-left', {
        peerId: targetInfo.socketId,
        userId: targetInfo.userId,
        name: targetInfo.name,
        roomId: room.roomId,
        reason: 'removed_by_host',
      });

      ack({ success: true, message: 'Participant removed successfully.' });
    });

    // ── 5e. MODERATION: LOCK ROOM ───────────────────────────────────────────
    socket.on('lock-room', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = data?.roomId || socketToRoom.get(socket.id);
      const room = rawRoomId ? rooms.get(rawRoomId) : null;

      if (!room) {
        return ack({ success: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' });
      }

      if (!isHostOrCoHost(room, socket.user.id)) {
        return ack({ success: false, error: 'FORBIDDEN', message: 'Host or co-host permission required to lock or unlock this room.' });
      }

      room.isLocked = typeof data?.locked === 'boolean' ? data.locked : !room.isLocked;

      io.to(room.roomId).emit('room-lock-changed', {
        roomId: room.roomId,
        isLocked: room.isLocked,
        updatedBy: socket.user.id,
      });

      ack({ success: true, isLocked: room.isLocked });
    });

    // ── 5f. MODERATION: ASSIGN CO-HOST ──────────────────────────────────────
    socket.on('assign-cohost', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = data?.roomId || socketToRoom.get(socket.id);
      const targetUserId = String(data?.targetUserId || '').trim();
      const room = rawRoomId ? rooms.get(rawRoomId) : null;

      if (!room) {
        return ack({ success: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' });
      }

      if (String(room.creatorId) !== String(socket.user.id)) {
        return ack({ success: false, error: 'FORBIDDEN', message: 'Only the room creator can assign or revoke co-hosts.' });
      }

      if (!targetUserId) {
        return ack({ success: false, error: 'INVALID_USER_ID', message: 'targetUserId is required.' });
      }

      if (!room.coHostIds) room.coHostIds = new Set();
      const shouldAssign = data?.action !== 'revoke';

      if (shouldAssign) {
        room.coHostIds.add(targetUserId);
      } else {
        room.coHostIds.delete(targetUserId);
      }

      io.to(room.roomId).emit('cohost-updated', {
        roomId: room.roomId,
        targetUserId,
        isCoHost: shouldAssign,
        updatedBy: socket.user.id,
      });

      ack({ success: true, targetUserId, isCoHost: shouldAssign });
    });

    // ── 5g. MEDIA STATE SYNC (Microphone & Camera Status Across Peers) ───────
    socket.on('media-state-changed', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = data?.roomId || socketToRoom.get(socket.id);
      const room = rawRoomId ? rooms.get(rawRoomId) : null;

      if (!room || !room.participants.has(socket.id)) {
        return ack({ success: false, error: 'NOT_IN_ROOM' });
      }

      const participant = room.participants.get(socket.id);
      if (participant) {
        if (typeof data.isMuted === 'boolean') participant.isMuted = data.isMuted;
        if (typeof data.isVideoOff === 'boolean') participant.isVideoOff = data.isVideoOff;
        if (typeof data.isScreenSharing === 'boolean') participant.isScreenSharing = data.isScreenSharing;
        if (typeof data.isSpeaking === 'boolean') participant.isSpeaking = data.isSpeaking;
        if (typeof data.isHandRaised === 'boolean') participant.isHandRaised = data.isHandRaised;
      }

      // Broadcast media state change to all participants in the room
      socket.to(room.roomId).emit('peer-media-state', {
        roomId: room.roomId,
        peerId: socket.id,
        userId: socket.user.id,
        isMuted: data.isMuted,
        isVideoOff: data.isVideoOff,
        isScreenSharing: data.isScreenSharing,
        isSpeaking: data.isSpeaking,
        isHandRaised: data.isHandRaised,
      });

      ack({ success: true });
    });

    // ── 5h. RAISE / LOWER HAND ───────────────────────────────────────────────
    socket.on('raise-hand', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = data?.roomId || socketToRoom.get(socket.id);
      const room = rawRoomId ? rooms.get(rawRoomId) : null;

      if (!room || !room.participants.has(socket.id)) {
        return ack({ success: false, error: 'NOT_IN_ROOM' });
      }

      const isHandRaised = typeof data?.isHandRaised === 'boolean' ? data.isHandRaised : true;
      const participant = room.participants.get(socket.id);
      if (participant) {
        participant.isHandRaised = isHandRaised;
      }

      io.to(room.roomId).emit('peer-hand-raised', {
        roomId: room.roomId,
        peerId: socket.id,
        userId: socket.user.id,
        name: socket.user.name,
        isHandRaised,
      });

      ack({ success: true, isHandRaised });
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
      for (const [rId, inv] of pendingInvitations.entries()) {
        if (inv.creatorId === creatorId || inv.inviteeId === creatorId) {
          clearTimeout(inv.timer);
          pendingInvitations.delete(rId);
          io.to(`user:${inv.inviteeId}`).emit('call-cancelled', { roomId: rId, creatorId: inv.creatorId });
        }
      }
      creationRateLimits.delete(creatorId);
      ack({ success: true });
    });

    // ── 5b2. TEST TRIGGER TIMEOUT (Deterministic testing of 30s timeout) ────
    socket.on('test-trigger-timeout', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = typeof data === 'string' ? data : data?.roomId;
      const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : '';
      const inv = pendingInvitations.get(roomId);
      if (!inv) {
        return ack({ success: false, error: 'INVITATION_NOT_FOUND' });
      }
      clearTimeout(inv.timer);
      pendingInvitations.delete(roomId);
      io.to(`user:${inv.creatorId}`).emit('call-timeout', { roomId, inviteeId: inv.inviteeId });
      io.to(`user:${inv.inviteeId}`).emit('call-timeout', { roomId, creatorId: inv.creatorId });
      ack({ success: true, roomId });
    });

    // ── 5c. REJECT CALL (Invitee declines incoming invitation) ────────────────
    socket.on('reject-call', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = typeof data === 'string' ? data : data?.roomId;
      const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : '';

      if (!isValidRoomId(roomId)) {
        return ack({
          success: false,
          error: 'INVALID_ROOM_ID',
          message: 'Invalid room identifier.',
        });
      }

      const inv = pendingInvitations.get(roomId);
      if (!inv) {
        return ack({
          success: false,
          error: 'INVITATION_NOT_FOUND',
          message: 'Call invitation not found or already expired.',
        });
      }

      // Authorization check: Only designated invitee can reject the call
      if (inv.inviteeId !== String(socket.user.id)) {
        return ack({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Only the invited recipient may reject this call.',
        });
      }

      clearTimeout(inv.timer);
      pendingInvitations.delete(roomId);

      // Emit call-rejected to creator
      io.to(`user:${inv.creatorId}`).emit('call-rejected', {
        roomId,
        inviteeId: socket.user.id,
        inviteeName: socket.user.name,
      });

      // Dismiss popup on any other tabs of invitee
      io.to(`user:${inv.inviteeId}`).emit('call-rejected', {
        roomId,
        inviteeId: socket.user.id,
      });

      ack({ success: true, roomId });
    });

    // ── 5d. CANCEL CALL (Creator cancels outgoing call while ringing) ─────────
    socket.on('cancel-call', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      const rawRoomId = typeof data === 'string' ? data : data?.roomId;
      const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : '';

      if (!isValidRoomId(roomId)) {
        return ack({
          success: false,
          error: 'INVALID_ROOM_ID',
          message: 'Invalid room identifier.',
        });
      }

      const inv = pendingInvitations.get(roomId);
      if (!inv) {
        return ack({
          success: false,
          error: 'INVITATION_NOT_FOUND',
          message: 'Call invitation not found or already expired.',
        });
      }

      // Authorization check: Only creator can cancel the call
      if (inv.creatorId !== String(socket.user.id)) {
        return ack({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Only the call initiator may cancel this call.',
        });
      }

      clearTimeout(inv.timer);
      pendingInvitations.delete(roomId);

      // Emit call-cancelled to invitee
      io.to(`user:${inv.inviteeId}`).emit('call-cancelled', {
        roomId,
        creatorId: socket.user.id,
      });

      // Also dismiss on creator's other tabs
      io.to(`user:${inv.creatorId}`).emit('call-cancelled', {
        roomId,
        creatorId: socket.user.id,
      });

      ack({ success: true, roomId });
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

      // Clean up any pending invitations initiated by this disconnecting socket
      for (const [rId, inv] of pendingInvitations.entries()) {
        if (inv.creatorSocketId === socket.id) {
          clearTimeout(inv.timer);
          pendingInvitations.delete(rId);
          io.to(`user:${inv.inviteeId}`).emit('call-cancelled', {
            roomId: rId,
            creatorId: inv.creatorId,
            reason: 'caller-disconnected',
          });
        }
      }

      // Multi-tab/device presence tracking cleanup
      const userId = String(socket.user.id);
      const sSet = userSockets.get(userId);
      if (sSet) {
        sSet.delete(socket.id);
        if (sSet.size === 0) {
          userSockets.delete(userId);
          // Only broadcast offline status once ALL tabs/devices for this user disconnect
          io.emit('user-presence', {
            userId,
            status: 'offline',
          });
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
  isUserInCall,
  isUserReceivingCall,
  isUserOnline,
  INVITATION_TIMEOUT_MS,
  MAX_ROOM_CREATIONS_PER_WINDOW,
  MAX_ACTIVE_ROOMS_PER_CREATOR,
  MAX_GROUP_CAPACITY,
  MAX_DIRECT_CAPACITY,
  _testRooms: rooms,
  _testSocketToRoom: socketToRoom,
  _testCreationRateLimits: creationRateLimits,
  _testPendingInvitations: pendingInvitations,
  _testUserSockets: userSockets,
  _testTriggerTimeout: (roomId, ioInstance = null) => {
    const inv = pendingInvitations.get(roomId);
    if (!inv) return false;
    clearTimeout(inv.timer);
    pendingInvitations.delete(roomId);
    const targetIo = ioInstance || globalIoRef;
    if (targetIo) {
      targetIo.to(`user:${inv.creatorId}`).emit('call-timeout', { roomId, inviteeId: inv.inviteeId });
      targetIo.to(`user:${inv.inviteeId}`).emit('call-timeout', { roomId, creatorId: inv.creatorId });
    }
    return true;
  },
};
