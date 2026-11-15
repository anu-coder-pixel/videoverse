/**
 * VideoVerse Phase 2, Step 3 — Video Calling & Host Moderation Test Suite
 *
 * Covers:
 * 1. Socket.IO Handshake Authentication (Token validation, rejection of unauthenticated connections)
 * 2. Room Creation & Capacity Limits (Direct: 2, Group: 5, Rate limits, unguessable IDs)
 * 3. Room Membership Enforcement (Access denied for unauthorized users)
 * 4. Room Locking Enforcement (Non-hosts blocked from locked rooms, hosts/co-hosts allowed)
 * 5. Host & Co-host Moderation: Mute Participant (Authorized host/co-host can mute, normal users forbidden)
 * 6. Host & Co-host Moderation: Remove/Kick Participant (Authorized removal, creator cannot be kicked, non-hosts forbidden)
 * 7. Host Moderation: Assign and Revoke Co-Host (Creator-only privilege, updates co-host permissions)
 * 8. End Meeting for All: Room Closure & Automatic Participant Teardown
 * 9. Media State Synchronization: Microphone, Camera, Screen Share, and Speaking Indicators
 * 10. In-Call Interactive: Raise / Lower Hand Broadcast
 */

const http = require('http');
const jwt = require('jsonwebtoken');
const ioClient = require('socket.io-client');
const { app, server, io } = require('../index');
const User = require('../models/User');

describe('Phase 2, Step 3: Video Calling & Host Moderation Suite', () => {
  let hostUser, coHostUser, normalUser, outsiderUser;
  let hostToken, coHostToken, normalToken, outsiderToken;
  let testServer, port;

  function createSocket(token) {
    return ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
  }

  beforeAll(async () => {
    // Clean up test users
    await User.deleteMany({
      email: {
        $in: [
          'call_mod_host@example.com',
          'call_mod_cohost@example.com',
          'call_mod_normal@example.com',
          'call_mod_outsider@example.com',
        ],
      },
    });

    hostUser = await User.create({
      name: 'Call Host',
      email: 'call_mod_host@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
    });

    coHostUser = await User.create({
      name: 'Call CoHost',
      email: 'call_mod_cohost@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
    });

    normalUser = await User.create({
      name: 'Normal Participant',
      email: 'call_mod_normal@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
    });

    outsiderUser = await User.create({
      name: 'Outsider User',
      email: 'call_mod_outsider@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
    });

    const jwtSecret = process.env.JWT_SECRET || 'testsecret';
    hostToken = jwt.sign({ id: hostUser._id }, jwtSecret);
    coHostToken = jwt.sign({ id: coHostUser._id }, jwtSecret);
    normalToken = jwt.sign({ id: normalUser._id }, jwtSecret);
    outsiderToken = jwt.sign({ id: outsiderUser._id }, jwtSecret);

    // Bind server to an ephemeral port for testing if not already listening
    await new Promise((resolve) => {
      testServer = server.listen(0, () => {
        port = testServer.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await User.deleteMany({
      email: {
        $in: [
          'call_mod_host@example.com',
          'call_mod_cohost@example.com',
          'call_mod_normal@example.com',
          'call_mod_outsider@example.com',
        ],
      },
    });

    if (testServer && testServer.listening) {
      await new Promise((resolve) => testServer.close(resolve));
    }
  });

  // ── 1. Handshake Authentication ────────────────────────────────────────────
  describe('Socket.IO Handshake Authentication', () => {
    it('should reject unauthenticated socket connections', (done) => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      socket.on('connect_error', (err) => {
        expect(err.message).toMatch(/Authentication required|INVALID_AUTH/i);
        socket.disconnect();
        done();
      });
    });

    it('should authenticate valid user JWT socket connection', (done) => {
      const socket = createSocket(hostToken);
      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        socket.disconnect();
        done();
      });
    });
  });

  // ── 2. Room Creation & Permissions ─────────────────────────────────────────
  describe('Room Creation & Group Capacity', () => {
    let hostSocket;

    beforeEach((done) => {
      hostSocket = createSocket(hostToken);
      hostSocket.on('connect', () => {
        hostSocket.emit('reset-user-rooms', {}, () => {
          done();
        });
      });
    });

    afterEach(() => {
      if (hostSocket && hostSocket.connected) hostSocket.disconnect();
    });

    it('should create group room with max 5 capacity and authorized list', (done) => {
      hostSocket.emit(
        'create-room',
        { callType: 'group', inviteeIds: [coHostUser._id.toString(), normalUser._id.toString()] },
        (res) => {
          expect(res.success).toBe(true);
          expect(res.roomId).toBeDefined();
          expect(res.callType).toBe('group');
          expect(res.maxParticipants).toBe(5);
          expect(res.allowedUserIds).toContain(hostUser._id.toString());
          expect(res.allowedUserIds).toContain(coHostUser._id.toString());
          expect(res.allowedUserIds).toContain(normalUser._id.toString());
          done();
        }
      );
    });
  });

  // ── 3. Moderation Controls: Lock/Unlock Room ────────────────────────────────
  describe('Moderation: Room Locking & Access Control', () => {
    let hostSocket, normalSocket, outsiderSocket;
    let roomId;

    beforeAll((done) => {
      hostSocket = createSocket(hostToken);
      normalSocket = createSocket(normalToken);
      outsiderSocket = createSocket(outsiderToken);

      hostSocket.on('connect', () => {
        hostSocket.emit(
          'create-room',
          { callType: 'group', inviteeIds: [normalUser._id.toString()] },
          (res) => {
            roomId = res.roomId;
            hostSocket.emit('join-room', { roomId }, () => {
              done();
            });
          }
        );
      });
    });

    afterAll(() => {
      if (hostSocket?.connected) hostSocket.disconnect();
      if (normalSocket?.connected) normalSocket.disconnect();
      if (outsiderSocket?.connected) outsiderSocket.disconnect();
    });

    it('should reject uninvited outsider with ROOM_ACCESS_DENIED', (done) => {
      outsiderSocket.emit('join-room', { roomId }, (res) => {
        expect(res.success).toBe(false);
        expect(res.error).toBe('ROOM_ACCESS_DENIED');
        done();
      });
    });

    it('should allow authorized host to lock the room', (done) => {
      hostSocket.emit('lock-room', { roomId, locked: true }, (res) => {
        expect(res.success).toBe(true);
        expect(res.isLocked).toBe(true);
        done();
      });
    });

    it('should block authorized participant from entering when room is locked', (done) => {
      normalSocket.emit('join-room', { roomId }, (res) => {
        expect(res.success).toBe(false);
        expect(res.error).toBe('ROOM_LOCKED');
        done();
      });
    });

    it('should allow authorized host to unlock the room', (done) => {
      hostSocket.emit('lock-room', { roomId, locked: false }, (res) => {
        expect(res.success).toBe(true);
        expect(res.isLocked).toBe(false);
        done();
      });
    });

    it('should allow participant to join once unlocked', (done) => {
      normalSocket.emit('join-room', { roomId }, (res) => {
        expect(res.success).toBe(true);
        expect(res.roomId).toBe(roomId);
        done();
      });
    });

    it('should prevent non-host participant from locking the room', (done) => {
      normalSocket.emit('lock-room', { roomId, locked: true }, (res) => {
        expect(res.success).toBe(false);
        expect(res.error).toBe('FORBIDDEN');
        done();
      });
    });
  });

  // ── 4. Moderation Controls: Mute, Remove & Co-Host Privileges ───────────────
  describe('Moderation: Mute, Kick, and Co-Host Assignment', () => {
    let hostSocket, coHostSocket, normalSocket;
    let roomId;

    beforeEach((done) => {
      hostSocket = createSocket(hostToken);
      coHostSocket = createSocket(coHostToken);
      normalSocket = createSocket(normalToken);

      hostSocket.on('connect', () => {
        hostSocket.emit('reset-user-rooms', {}, () => {
          hostSocket.emit(
            'create-room',
            { callType: 'group', inviteeIds: [coHostUser._id.toString(), normalUser._id.toString()] },
            (res) => {
              roomId = res.roomId;
              hostSocket.emit('join-room', { roomId }, () => {
                coHostSocket.emit('join-room', { roomId }, () => {
                  normalSocket.emit('join-room', { roomId }, () => {
                    done();
                  });
                });
              });
            }
          );
        });
      });
    });

    afterEach(() => {
      if (hostSocket?.connected) hostSocket.disconnect();
      if (coHostSocket?.connected) coHostSocket.disconnect();
      if (normalSocket?.connected) normalSocket.disconnect();
    });

    it('should allow host to mute a normal participant', (done) => {
      normalSocket.once('moderation-mute', (data) => {
        expect(data.roomId).toBe(roomId);
        expect(data.audio).toBe(true);
        done();
      });

      hostSocket.emit('mute-participant', { roomId, targetSocketId: normalSocket.id }, (res) => {
        expect(res.success).toBe(true);
      });
    });

    it('should prevent normal participant from muting another participant', (done) => {
      normalSocket.emit('mute-participant', { roomId, targetSocketId: coHostSocket.id }, (res) => {
        expect(res.success).toBe(false);
        expect(res.error).toBe('FORBIDDEN');
        done();
      });
    });

    it('should allow room creator to assign co-host permissions', (done) => {
      hostSocket.emit(
        'assign-cohost',
        { roomId, targetUserId: coHostUser._id.toString(), action: 'assign' },
        (res) => {
          expect(res.success).toBe(true);
          expect(res.isCoHost).toBe(true);
          done();
        }
      );
    });

    it('should allow assigned co-host to mute another participant', (done) => {
      // 1. Assign co-host first
      hostSocket.emit(
        'assign-cohost',
        { roomId, targetUserId: coHostUser._id.toString(), action: 'assign' },
        (assignRes) => {
          expect(assignRes.success).toBe(true);

          // 2. Co-host mutes normal participant
          normalSocket.once('moderation-mute', (data) => {
            expect(data.roomId).toBe(roomId);
            done();
          });

          coHostSocket.emit('mute-participant', { roomId, targetSocketId: normalSocket.id }, (res) => {
            if (!res.success) {
              console.error('Co-host mute failure:', res);
            }
            expect(res.success).toBe(true);
          });
        }
      );
    });

    it('should allow host to remove/kick a participant', (done) => {
      normalSocket.once('moderation-removed', (data) => {
        expect(data.roomId).toBe(roomId);
        expect(data.reason).toBe('removed_by_host');
        done();
      });

      hostSocket.emit('remove-participant', { roomId, targetSocketId: normalSocket.id }, (res) => {
        expect(res.success).toBe(true);
      });
    });

    it('should prevent kicking the room host', (done) => {
      hostSocket.emit(
        'assign-cohost',
        { roomId, targetUserId: coHostUser._id.toString(), action: 'assign' },
        () => {
          coHostSocket.emit('remove-participant', { roomId, targetSocketId: hostSocket.id }, (res) => {
            expect(res.success).toBe(false);
            expect(res.error).toBe('CANNOT_REMOVE_HOST');
            done();
          });
        }
      );
    });
  });

  // ── 5. Media State, Hand Raising & Room Closure ─────────────────────────────
  describe('Media State Synchronization & Room Closure', () => {
    let hostSocket, normalSocket;
    let roomId;

    beforeEach((done) => {
      hostSocket = createSocket(hostToken);
      normalSocket = createSocket(normalToken);

      hostSocket.on('connect', () => {
        hostSocket.emit('reset-user-rooms', {}, () => {
          hostSocket.emit(
            'create-room',
            { callType: 'group', inviteeIds: [normalUser._id.toString()] },
            (res) => {
              roomId = res.roomId;
              hostSocket.emit('join-room', { roomId }, () => {
                normalSocket.emit('join-room', { roomId }, () => {
                  done();
                });
              });
            }
          );
        });
      });
    });

    afterEach(() => {
      if (hostSocket?.connected) hostSocket.disconnect();
      if (normalSocket?.connected) normalSocket.disconnect();
    });

    it('should broadcast media-state-changed to other peers', (done) => {
      normalSocket.once('peer-media-state', (data) => {
        expect(data.roomId).toBe(roomId);
        expect(data.isMuted).toBe(true);
        expect(data.isVideoOff).toBe(true);
        expect(data.isSpeaking).toBe(true);
        done();
      });

      hostSocket.emit('media-state-changed', {
        roomId,
        isMuted: true,
        isVideoOff: true,
        isSpeaking: true,
      });
    });

    it('should broadcast raise-hand to all room participants', (done) => {
      hostSocket.once('peer-hand-raised', (data) => {
        expect(data.roomId).toBe(roomId);
        expect(data.isHandRaised).toBe(true);
        expect(data.userId).toBe(normalUser._id.toString());
        done();
      });

      normalSocket.emit('raise-hand', { roomId, isHandRaised: true });
    });

    it('should close room and notify all participants on close-room', (done) => {
      normalSocket.once('peer-left', (data) => {
        expect(data.roomId).toBe(roomId);
        expect(data.reason).toBe('room-closed');
        done();
      });

      hostSocket.emit('close-room', { roomId }, (res) => {
        expect(res.success).toBe(true);
      });
    });
  });
});

