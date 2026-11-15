/**
 * VideoVerse — Multi-Peer WebRTC Connection Manager
 *
 * Phase 2: Group Video Calling Multi-Peer WebRTC Hook (useGroupWebRTC).
 *
 * Capabilities:
 * - Manages multi-peer full mesh WebRTC connections (Map<peerId, RTCPeerConnection>)
 * - Maintains independent remote MediaStreams for each connected peer
 * - Independent per-peer ICE candidate queues with automatic flushing on remoteDescription
 * - Deterministic glare-free negotiation using W3C Perfect Negotiation (tie-breaker by socketId)
 * - Targeted signaling: uses data.to for all outgoing offer, answer, and ice-candidate events
 * - Local media acquisition (high-res with basic & audio-only fallback) attached to all peers
 * - Global audio mute and camera toggle across all peer connections via track.enabled
 * - Screen sharing using replaceTrack across all peer senders, restoring camera on stop
 * - Safe per-peer departure: closes only departing peer's connection, preserves other peers
 * - Call generation counters and active flags preventing stale async callbacks from corrupting state
 * - Full call teardown closing all peer connections and stopping owned media tracks
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getIceServers,
  isValidIceServerList,
  fetchIceServers,
  HIGH_RES_CONSTRAINTS,
  BASIC_CONSTRAINTS,
  AUDIO_ONLY_CONSTRAINTS,
} from './useWebRTC.js';

/**
 * Creates an animated canvas video stream track as a fallback when physical camera
 * hardware is locked by another browser tab or application on the same machine.
 */
export function createSimulatedVideoTrack(label = 'Participant', avatarColor = '#6366f1') {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let frameCount = 0;
  const render = () => {
    frameCount++;
    // Dark modern gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.5, '#1e1b4b');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle animated grid effect
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Animated pulsing ring around avatar
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 20;
    const pulseRadius = 75 + Math.sin(frameCount * 0.1) * 8;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(99, 102, 241, 0.18)';
    ctx.fill();

    // Central avatar circle
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.fillStyle = avatarColor || '#6366f1';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Initials in avatar circle
    const initials = (label && label.length > 0) ? label.slice(0, 2).toUpperCase() : 'U';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, cx, cy);

    // Label under avatar
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillText(label, cx, cy + 90);

    // "Virtual Camera Feed" badge
    ctx.fillStyle = 'rgba(34, 197, 94, 0.9)'; // green dot
    ctx.beginPath();
    ctx.arc(cx - 75, cy + 120, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Virtual Video (Hardware in use)', cx - 62, cy + 120);
  };

  render();
  const intervalId = setInterval(render, 100);
  const stream = canvas.captureStream ? canvas.captureStream(15) : null;
  if (!stream) {
    clearInterval(intervalId);
    return null;
  }
  const track = stream.getVideoTracks()[0];
  if (track) {
    const originalStop = track.stop ? track.stop.bind(track) : () => {};
    track.stop = () => {
      clearInterval(intervalId);
      originalStop();
    };
  }
  return track;
}

export function useGroupWebRTC({
  socket,
  roomId,
  initialPeers = [],
  enabled = false,
  showToast = null,
  onPeerLeft = null,
  onPeerJoined = null,
  currentUser = null,
} = {}) {
  // ── Local Media State ───────────────────────────────────────────────────────
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // ── Remote Peers State ──────────────────────────────────────────────────────
  // peers: Array<{ peerId, userId, name, avatar, avatarColor, initials, stream, hasVideo, hasAudio, connectionState }>
  const [peers, setPeers] = useState([]);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'closed'

  // ── Refs for Call Lifecycle & Stable Callbacks ──────────────────────────────
  const onPeerLeftRef = useRef(onPeerLeft);
  onPeerLeftRef.current = onPeerLeft;
  const onPeerJoinedRef = useRef(onPeerJoined);
  onPeerJoinedRef.current = onPeerJoined;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const initialPeersRef = useRef(initialPeers);
  initialPeersRef.current = initialPeers;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const isScreenSharingRef = useRef(false);
  const mediaPromiseRef = useRef(null);

  // Per-peer connection management maps
  const peerConnectionsRef = useRef(new Map()); // Map<peerId, RTCPeerConnection>
  const remoteStreamsRef = useRef(new Map()); // Map<peerId, MediaStream>
  const candidateQueuesRef = useRef(new Map()); // Map<peerId, Array<RTCIceCandidateInit>>
  const peerMetadataRef = useRef(new Map()); // Map<peerId, { peerId, userId, name, avatar, avatarColor, initials }>
  const makingOfferRef = useRef(new Map()); // Map<peerId, boolean>

  // Call lifecycle guards and generation counters
  const isCallActiveRef = useRef(false);
  const callGenerationRef = useRef(0);
  const iceServersRef = useRef(null);
  const iceFetchPromiseRef = useRef(null);

  // ── 1. Acquire Local Media Stream ───────────────────────────────────────────
  const startMedia = useCallback(async () => {
    if (localStreamRef.current && localStreamRef.current.getTracks().some((t) => t.readyState === 'live')) {
      return localStreamRef.current;
    }
    if (mediaPromiseRef.current) {
      return mediaPromiseRef.current;
    }

    const acquireStream = async () => {
      setMediaError(null);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const errText = 'Your browser does not support camera or microphone capture.';
        setMediaError(errText);
        return null;
      }

      let stream = null;
      let audioOnly = false;

      try {
        stream = await navigator.mediaDevices.getUserMedia(HIGH_RES_CONSTRAINTS);
      } catch (err) {
        console.warn('[GroupWebRTC] High-res media constraints failed:', err.name, err.message);

        // Fallback to basic unconstrained video on any failure
        try {
          stream = await navigator.mediaDevices.getUserMedia(BASIC_CONSTRAINTS);
        } catch (basicErr) {
          console.warn('[GroupWebRTC] Basic media constraints failed:', basicErr.name);
        }

        // If camera hardware is locked by another window/tab, attempt virtual video stream
        if (!stream && (err.name === 'NotReadableError' || err.name === 'TrackStartError')) {
          try {
            let audioStream = null;
            try {
              audioStream = await navigator.mediaDevices.getUserMedia(AUDIO_ONLY_CONSTRAINTS);
            } catch {
              // audio might also be unavailable
            }
            const userMeta = currentUserRef.current || {};
            const simTrack = createSimulatedVideoTrack(userMeta.name || 'Participant', userMeta.avatarColor || '#6366f1');
            if (simTrack) {
              const combinedTracks = [...(audioStream ? audioStream.getAudioTracks() : []), simTrack];
              stream = new MediaStream(combinedTracks);
              audioOnly = false;
              setIsAudioOnly(false);
              if (showToastRef.current) {
                showToastRef.current('📷 Camera in use by another tab. Activated virtual camera preview.');
              }
            }
          } catch (simErr) {
            console.warn('[GroupWebRTC] Simulated camera fallback failed:', simErr);
          }
        }

        if (!stream && (
          err.name === 'NotFoundError' ||
          err.name === 'DevicesNotFoundError' ||
          err.name === 'NotReadableError' ||
          err.name === 'TrackStartError' ||
          err.name === 'OverconstrainedError' ||
          err.name === 'ConstraintNotSatisfiedError'
        )) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(AUDIO_ONLY_CONSTRAINTS);
            audioOnly = true;
            setIsAudioOnly(true);
            if (showToastRef.current) {
              showToastRef.current('📷 Camera unavailable. Joined in audio-only mode.');
            }
          } catch (audioErr) {
            console.error('[GroupWebRTC] Audio-only fallback failed:', audioErr.name);
          }
        }

        if (!stream) {
          let msg = 'Failed to access camera and microphone.';
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            msg = 'Permission denied: Please allow camera and microphone access in your browser.';
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            msg = 'No camera or microphone hardware found on this device.';
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            msg = 'Camera or microphone is already in use by another application.';
          }
          setMediaError(msg);
          return null;
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsAudioOnly(audioOnly);

      // Attach tracks to all existing peer connections if any already initialized
      const tracks = stream.getTracks();
      for (const [peerId, pc] of peerConnectionsRef.current.entries()) {
        if (!pc || !pc.getSenders) continue;
        const senders = pc.getSenders();
        tracks.forEach((track) => {
          const sender = senders.find((s) => s.track && s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track).catch((rErr) => {
              console.warn(`[GroupWebRTC] replaceTrack error for peer ${peerId}:`, rErr);
            });
          } else {
            try {
              pc.addTrack(track, stream);
            } catch (addErr) {
              console.warn(`[GroupWebRTC] addTrack to existing pc error for peer ${peerId}:`, addErr);
            }
          }
        });
      }

      if (localVideoRef.current) {
        localVideoRef.current.muted = true;
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      return stream;
    };

    mediaPromiseRef.current = acquireStream().finally(() => {
      mediaPromiseRef.current = null;
    });

    return mediaPromiseRef.current;
  }, []);

  // ── Dynamic ICE Configuration Fetcher ──────────────────────────────────────
  const getOrFetchIceServers = useCallback(async (sessionGen = callGenerationRef.current) => {
    if (iceServersRef.current && isValidIceServerList(iceServersRef.current)) {
      return iceServersRef.current;
    }

    if (!iceFetchPromiseRef.current) {
      const fetchPromise = fetchIceServers({ showToast: showToastRef.current })
        .then((servers) => {
          if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
            iceServersRef.current = servers;
          }
          return servers;
        })
        .finally(() => {
          if (iceFetchPromiseRef.current === fetchPromise && callGenerationRef.current === sessionGen) {
            iceFetchPromiseRef.current = null;
          }
        });

      iceFetchPromiseRef.current = fetchPromise;
    }

    return iceFetchPromiseRef.current;
  }, []);

  // ── 2. Flush Per-Peer ICE Candidate Queue ───────────────────────────────────
  const flushCandidateQueue = useCallback(async (peerId) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc || !pc.remoteDescription) return;

    const queue = candidateQueuesRef.current.get(peerId);
    if (!queue || queue.length === 0) return;

    while (queue.length > 0) {
      const cand = queue.shift();
      if (!cand || !cand.candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn(`[GroupWebRTC] Failed to add buffered candidate for ${peerId}:`, err.message);
      }
    }
  }, []);

  // ── 3. Initialize RTCPeerConnection for a Specific Peer ─────────────────────
  const getOrCreatePeerConnection = useCallback(async (peerId, sessionGen = callGenerationRef.current) => {
    if (!peerId) return null;
    if (peerConnectionsRef.current.has(peerId)) {
      return peerConnectionsRef.current.get(peerId);
    }
    if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) {
      return null;
    }
    if (typeof RTCPeerConnection === 'undefined') {
      setMediaError('WebRTC RTCPeerConnection is not supported by your browser.');
      return null;
    }

    const iceServers = await getOrFetchIceServers(sessionGen);
    if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) {
      return null;
    }
    if (peerConnectionsRef.current.has(peerId)) {
      return peerConnectionsRef.current.get(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: isValidIceServerList(iceServers) ? iceServers : getIceServers(),
      iceCandidatePoolSize: 10,
    });

    peerConnectionsRef.current.set(peerId, pc);

    // Attach local media tracks (screen video track if active, otherwise camera track)
    const local = localStreamRef.current;
    if (local) {
      const audioTrack = local.getAudioTracks()[0];
      const videoTrack = isScreenSharingRef.current && screenStreamRef.current
        ? screenStreamRef.current.getVideoTracks()[0]
        : local.getVideoTracks()[0];

      if (audioTrack) {
        try { pc.addTrack(audioTrack, local); } catch { /* ignore */ }
      }
      if (videoTrack) {
        try { pc.addTrack(videoTrack, local); } catch { /* ignore */ }
      }
    } else {
      // Receive-only fallback when no local camera or microphone is available
      try {
        if (typeof pc.addTransceiver === 'function') {
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.addTransceiver('video', { direction: 'recvonly' });
        }
      } catch {
        /* ignore — offer/answer options offerToReceiveAudio/Video will negotiate */
      }
    }

    // Handle remote track arrivals
    pc.ontrack = (event) => {
      let stream = remoteStreamsRef.current.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreamsRef.current.set(peerId, stream);
      }

      if (!stream.getTracks().some((t) => t.id === event.track.id)) {
        stream.addTrack(event.track);
      }

      const updatePeerState = () => {
        const s = remoteStreamsRef.current.get(peerId);
        const vTracks = s ? s.getVideoTracks() : [];
        const aTracks = s ? s.getAudioTracks() : [];
        const hasLiveVideo = vTracks.some((t) => t.readyState === 'live' && !t.muted);
        const hasLiveAudio = aTracks.some((t) => t.readyState === 'live' && !t.muted);

        setPeers((prevPeers) => {
          const idx = prevPeers.findIndex((p) => p.peerId === peerId);
          const meta = peerMetadataRef.current.get(peerId) || {};
          const updated = {
            peerId,
            userId: meta.userId || null,
            name: meta.name || 'Participant',
            avatar: meta.avatar || null,
            avatarColor: meta.avatarColor || '#6366f1',
            initials: meta.initials || 'P',
            stream: s ? new MediaStream(s.getTracks()) : null,
            hasVideo: hasLiveVideo,
            hasAudio: hasLiveAudio,
            connectionState: pc.connectionState || 'connecting',
          };
          if (idx >= 0) {
            const copy = [...prevPeers];
            copy[idx] = updated;
            return copy;
          }
          return [...prevPeers, updated];
        });
      };

      event.track.onmute = updatePeerState;
      event.track.onunmute = updatePeerState;
      event.track.onended = () => {
        const s = remoteStreamsRef.current.get(peerId);
        if (s) {
          try { s.removeTrack(event.track); } catch { /* ignore */ }
        }
        updatePeerState();
      };

      updatePeerState();
    };

    // Forward ICE candidates targeted to this specific destination peer
    pc.onicecandidate = (event) => {
      if (!socket || !roomId) return;
      if (event.candidate) {
        socket.emit('ice-candidate', {
          roomId,
          to: peerId,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      }
    };

    // Per-peer connection state tracking
    pc.onconnectionstatechange = () => {
      const cState = pc.connectionState;
      setPeers((prev) =>
        prev.map((p) => (p.peerId === peerId ? { ...p, connectionState: cState } : p))
      );
      if (cState === 'connected') {
        setConnectionState('connected');
      } else if (cState === 'failed') {
        console.warn(`[GroupWebRTC] Peer ${peerId} connection failed.`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === 'connected' || iceState === 'completed') {
        setConnectionState('connected');
      }
    };

    return pc;
  }, [socket, roomId, getOrFetchIceServers]);

  // ── 4. Initiate Offer to a Specific Peer ────────────────────────────────────
  const initiateOfferToPeer = useCallback(async (peerId, sessionGen = callGenerationRef.current) => {
    if (!peerId) return;
    if (makingOfferRef.current.get(peerId)) return;
    if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

    try {
      makingOfferRef.current.set(peerId, true);

      let stream = localStreamRef.current;
      if (!stream) {
        try {
          stream = await startMedia();
        } catch {
          // Continue offer creation even if local media is unavailable
        }
      }
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      const pc = await getOrCreatePeerConnection(peerId, sessionGen);
      if (!pc || !isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      await pc.setLocalDescription(offer);
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      socket.emit('offer', {
        roomId,
        to: peerId,
        sdp: {
          type: 'offer',
          sdp: offer.sdp,
        },
      });
    } catch (err) {
      if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
        console.error(`[GroupWebRTC] Failed to dispatch offer to ${peerId}:`, err);
      }
    } finally {
      if (callGenerationRef.current === sessionGen) {
        makingOfferRef.current.delete(peerId);
      }
    }
  }, [socket, roomId, startMedia, getOrCreatePeerConnection]);

  // ── 5. Teardown Single Departing Peer Connection ────────────────────────────
  const removePeerConnection = useCallback((peerId, data = null) => {
    if (!peerId) return;

    // 1. Close RTCPeerConnection and clear handlers
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try { pc.close(); } catch { /* ignore */ }
      peerConnectionsRef.current.delete(peerId);
    }

    // 2. Stop and clear remote stream tracks
    const stream = remoteStreamsRef.current.get(peerId);
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* ignore */ }
      });
      remoteStreamsRef.current.delete(peerId);
    }

    // 3. Clear queues and metadata
    candidateQueuesRef.current.delete(peerId);
    peerMetadataRef.current.delete(peerId);
    makingOfferRef.current.delete(peerId);

    // 4. Update React peers list
    setPeers((prev) => prev.filter((p) => p.peerId !== peerId));

    if (typeof onPeerLeftRef.current === 'function') {
      onPeerLeftRef.current(data || { peerId });
    }
  }, []);

  // ── 6. Full Teardown & Resource Cleanup ──────────────────────────────────────
  const cleanup = useCallback(() => {
    callGenerationRef.current++;
    isCallActiveRef.current = false;
    iceServersRef.current = null;
    iceFetchPromiseRef.current = null;
    mediaPromiseRef.current = null;

    // Stop active screen share
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    isScreenSharingRef.current = false;

    // Stop local media stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // Close all active peer connections
    for (const pc of peerConnectionsRef.current.values()) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try { pc.close(); } catch { /* ignore */ }
    }
    peerConnectionsRef.current.clear();

    // Stop and clear all remote streams
    for (const stream of remoteStreamsRef.current.values()) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
    }
    remoteStreamsRef.current.clear();

    // Clear queues and metadata
    candidateQueuesRef.current.clear();
    peerMetadataRef.current.clear();
    makingOfferRef.current.clear();

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setPeers([]);
    setConnectionState('closed');
  }, []);

  // ── 7. Signaling Listeners & Peer Mesh Lifecycle ────────────────────────────
  useEffect(() => {
    if (!enabled || !socket || !roomId) return;

    const sessionGen = ++callGenerationRef.current;
    isCallActiveRef.current = true;
    setConnectionState('connecting');

    // Pre-fetch ICE servers in parallel
    getOrFetchIceServers(sessionGen);

    // Initial peer discovery from join-room response
    const peersToAdd = [];
    const rawPeers = Array.isArray(initialPeersRef.current) ? initialPeersRef.current : [];
    rawPeers.forEach((p) => {
      const pId = p.peerId || p.socketId;
      if (!pId || (socket && pId === socket.id)) return;
      const meta = {
        peerId: pId,
        userId: p.userId || null,
        name: p.name || 'Participant',
        avatar: p.avatar || null,
        avatarColor: p.avatarColor || '#6366f1',
        initials: p.initials || (p.name ? p.name.slice(0, 2).toUpperCase() : 'P'),
      };
      peerMetadataRef.current.set(pId, meta);
      peersToAdd.push({
        ...meta,
        stream: null,
        hasVideo: false,
        hasAudio: false,
        connectionState: 'connecting',
      });
    });

    if (peersToAdd.length > 0) {
      setPeers((prev) => {
        const existingIds = new Set(prev.map((x) => x.peerId));
        const newPeers = peersToAdd.filter((x) => !existingIds.has(x.peerId));
        return [...prev, ...newPeers];
      });

      for (const p of peersToAdd) {
        getOrCreatePeerConnection(p.peerId, sessionGen);
      }
    }

    // Named Handler: Another participant joins room
    const handlePeerJoined = async (data) => {
      const newPeerId = data?.peerId;
      if (!newPeerId || newPeerId === socket.id) return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      const userMeta = data?.user || {
        id: data?.userId,
        name: data?.name,
        avatar: data?.avatar,
        avatarColor: data?.avatarColor,
        initials: data?.initials,
      };

      peerMetadataRef.current.set(newPeerId, {
        peerId: newPeerId,
        userId: userMeta.id || userMeta._id,
        name: userMeta.name,
        avatar: userMeta.avatar,
        avatarColor: userMeta.avatarColor,
        initials: userMeta.initials,
      });

      setPeers((prev) => {
        if (prev.some((p) => p.peerId === newPeerId)) return prev;
        return [
          ...prev,
          {
            peerId: newPeerId,
            userId: userMeta.id || userMeta._id,
            name: userMeta.name || 'Participant',
            avatar: userMeta.avatar || null,
            avatarColor: userMeta.avatarColor || '#6366f1',
            initials: userMeta.initials || 'P',
            stream: null,
            hasVideo: false,
            hasAudio: false,
            connectionState: 'connecting',
          },
        ];
      });

      if (typeof onPeerJoinedRef.current === 'function') {
        onPeerJoinedRef.current(data);
      }

      await getOrCreatePeerConnection(newPeerId, sessionGen);
    };

    // Named Handler: Incoming Offer
    const handleOffer = async (payload) => {
      const fromPeerId = payload?.from;
      const sdpData = payload?.sdp;
      if (!fromPeerId || !sdpData || sdpData.type !== 'offer') return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      if (payload.fromUser) {
        peerMetadataRef.current.set(fromPeerId, {
          peerId: fromPeerId,
          userId: payload.fromUser.id,
          name: payload.fromUser.name,
          avatar: payload.fromUser.avatar,
          avatarColor: payload.fromUser.avatarColor,
          initials: payload.fromUser.initials,
        });
      }

      try {
        let stream = localStreamRef.current;
        if (!stream) {
          try {
            stream = await startMedia();
          } catch {
            // Continue answer creation even if local media is unavailable
          }
        }
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        const pc = await getOrCreatePeerConnection(fromPeerId, sessionGen);
        if (!pc || !isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        // Glare-free tie breaker: Compare socket IDs deterministically
        const isPolite = String(socket.id) > String(fromPeerId);
        const offerCollision = pc.signalingState !== 'stable' || (makingOfferRef.current.get(fromPeerId) === true);

        if (offerCollision) {
          if (!isPolite) {
            console.warn(`[GroupWebRTC] Offer collision with ${fromPeerId}; impolite peer ignoring offer`);
            return;
          }
          console.warn(`[GroupWebRTC] Offer collision with ${fromPeerId}; polite peer rolling back`);
          await pc.setLocalDescription({ type: 'rollback' });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        await flushCandidateQueue(fromPeerId);

        const answer = await pc.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        await pc.setLocalDescription(answer);
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        socket.emit('answer', {
          roomId,
          to: fromPeerId,
          sdp: {
            type: 'answer',
            sdp: answer.sdp,
          },
        });
      } catch (err) {
        if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
          console.error(`[GroupWebRTC] Error processing offer from ${fromPeerId}:`, err);
        }
      }
    };

    // Named Handler: Incoming Answer
    const handleAnswer = async (payload) => {
      const fromPeerId = payload?.from;
      const sdpData = payload?.sdp;
      if (!fromPeerId || !sdpData || sdpData.type !== 'answer') return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      const pc = peerConnectionsRef.current.get(fromPeerId);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;
        await flushCandidateQueue(fromPeerId);
      } catch (err) {
        if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
          console.error(`[GroupWebRTC] Error setting remote answer from ${fromPeerId}:`, err);
        }
      }
    };

    // Named Handler: Incoming ICE Candidate with per-peer buffering
    const handleIceCandidate = async (payload) => {
      const fromPeerId = payload?.from;
      const cand = payload?.candidate;
      if (!fromPeerId || !cand || typeof cand.candidate !== 'string') return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      const pc = peerConnectionsRef.current.get(fromPeerId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn(`[GroupWebRTC] Error adding ICE candidate from ${fromPeerId}:`, err.message);
        }
      } else {
        let queue = candidateQueuesRef.current.get(fromPeerId);
        if (!queue) {
          queue = [];
          candidateQueuesRef.current.set(fromPeerId, queue);
        }
        queue.push(cand);
      }
    };

    // Named Handler: Peer Left
    const handlePeerLeft = (data) => {
      const leftPeerId = data?.peerId;
      if (leftPeerId) {
        removePeerConnection(leftPeerId, data);
      }
    };

    socket.on('peer-joined', handlePeerJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-left', handlePeerLeft);

    // Acquire local media (if available), then initiate offers to all existing peers
    startMedia()
      .catch((err) => {
        console.warn('[GroupWebRTC] Local media acquisition warning:', err?.message || err);
        return null;
      })
      .finally(async () => {
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;
        const peersToOffer = Array.isArray(initialPeersRef.current) ? initialPeersRef.current : [];
        for (const peer of peersToOffer) {
          const pId = peer.peerId || peer.socketId;
          if (pId && socket && pId !== socket.id) {
            await initiateOfferToPeer(pId, sessionGen);
          }
        }
      });

    return () => {
      socket.off('peer-joined', handlePeerJoined);
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('peer-left', handlePeerLeft);
      cleanup();
    };
  }, [
    enabled,
    socket,
    roomId,
    startMedia,
    initiateOfferToPeer,
    getOrCreatePeerConnection,
    flushCandidateQueue,
    removePeerConnection,
    cleanup,
    getOrFetchIceServers,
  ]);

  // Synchronize dynamic updates to initialPeers (e.g. from async roomState updates)
  useEffect(() => {
    if (!enabled || !isCallActiveRef.current || !Array.isArray(initialPeers) || initialPeers.length === 0) return;
    const sessionGen = callGenerationRef.current;
    const peersToAdd = [];

    initialPeers.forEach((p) => {
      const pId = p.peerId || p.socketId;
      if (!pId || (socket && pId === socket.id)) return;
      if (!peerMetadataRef.current.has(pId)) {
        const meta = {
          peerId: pId,
          userId: p.userId || null,
          name: p.name || 'Participant',
          avatar: p.avatar || null,
          avatarColor: p.avatarColor || '#6366f1',
          initials: p.initials || (p.name ? p.name.slice(0, 2).toUpperCase() : 'P'),
        };
        peerMetadataRef.current.set(pId, meta);
        peersToAdd.push({
          ...meta,
          stream: null,
          hasVideo: false,
          hasAudio: false,
          connectionState: 'connecting',
        });
      }
    });

    if (peersToAdd.length > 0) {
      setPeers((prev) => {
        const existingIds = new Set(prev.map((x) => x.peerId));
        const newPeers = peersToAdd.filter((x) => !existingIds.has(x.peerId));
        return [...prev, ...newPeers];
      });

      for (const p of peersToAdd) {
        getOrCreatePeerConnection(p.peerId, sessionGen).then(() => {
          if (isCallActiveRef.current && callGenerationRef.current === sessionGen) {
            initiateOfferToPeer(p.peerId, sessionGen);
          }
        });
      }
    }
  }, [initialPeers, enabled, socket, getOrCreatePeerConnection, initiateOfferToPeer]);

  // Synchronize local preview video element
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current && !isScreenSharing) {
      localVideoRef.current.muted = true;
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, isVideoOff, isScreenSharing]);

  // ── 8. Media Controls (Mute / Camera Toggle / Screen Share) ─────────────────
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;

    const willEnable = isMuted; // If muted, unmute
    audioTracks.forEach((t) => {
      t.enabled = willEnable;
    });
    setIsMuted(!willEnable);
  }, [isMuted]);

  const toggleVideo = useCallback(async () => {
    // If video is currently ON, turn it OFF
    if (!isVideoOff) {
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          t.enabled = false;
        });
      }
      setIsVideoOff(true);
      return;
    }

    // Video is currently OFF: we want to turn it ON
    // 1. Check if we already have an active live video track
    const existingVideoTrack = localStreamRef.current
      ? localStreamRef.current.getVideoTracks().find((t) => t.readyState === 'live')
      : null;

    if (existingVideoTrack) {
      existingVideoTrack.enabled = true;
      setIsVideoOff(false);
      setIsAudioOnly(false);
      return;
    }

    // 2. We don't have an active video track — actively request camera from browser
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (showToastRef.current) {
        showToastRef.current('Camera capture is not supported by your browser.', 'error');
      }
      return;
    }

    try {
      let cameraStream = null;
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia(BASIC_CONSTRAINTS);
      } catch (basicErr) {
        if (basicErr.name === 'NotReadableError' || basicErr.name === 'TrackStartError') {
          // Hardware locked by another window/tab — generate simulated video track
          const userMeta = currentUserRef.current || {};
          const simTrack = createSimulatedVideoTrack(userMeta.name || 'Participant', userMeta.avatarColor || '#6366f1');
          if (simTrack) {
            cameraStream = new MediaStream([simTrack]);
          }
        }
        if (!cameraStream) {
          try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          } catch (vidOnlyErr) {
            if (vidOnlyErr.name === 'NotReadableError' || vidOnlyErr.name === 'TrackStartError') {
              const userMeta = currentUserRef.current || {};
              const simTrack = createSimulatedVideoTrack(userMeta.name || 'Participant', userMeta.avatarColor || '#6366f1');
              if (simTrack) {
                cameraStream = new MediaStream([simTrack]);
              }
            }
          }
        }
      }

      const newVideoTrack = cameraStream ? cameraStream.getVideoTracks()[0] : null;
      if (!newVideoTrack) {
        throw new Error('No video track available from camera device.');
      }

      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          try { localStreamRef.current.removeTrack(t); t.stop(); } catch { /* ignore */ }
        });
        localStreamRef.current.addTrack(newVideoTrack);
      } else {
        localStreamRef.current = new MediaStream([newVideoTrack]);
      }

      setLocalStream(localStreamRef.current);
      setIsVideoOff(false);
      setIsAudioOnly(false);
      setMediaError(null);

      // Attach / replace video track across all active peer connections & renegotiate if needed
      const sessionGen = callGenerationRef.current;
      for (const [peerId, pc] of peerConnectionsRef.current.entries()) {
        if (!pc) continue;
        let needsRenegotiation = false;
        const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
        const videoTransceiver = transceivers.find((t) =>
          (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
          (t.receiver && t.receiver.track && t.receiver.track.kind === 'video') ||
          (t.sender && t.sender.kind === 'video')
        );

        if (videoTransceiver) {
          if (videoTransceiver.direction !== 'sendrecv') {
            videoTransceiver.direction = 'sendrecv';
            needsRenegotiation = true;
          }
          if (videoTransceiver.sender) {
            try {
              await videoTransceiver.sender.replaceTrack(newVideoTrack);
            } catch (rErr) {
              console.warn(`[GroupWebRTC] replaceTrack error for peer ${peerId}:`, rErr);
            }
          }
        } else {
          try {
            pc.addTrack(newVideoTrack, localStreamRef.current);
            needsRenegotiation = true;
          } catch (addErr) {
            console.warn(`[GroupWebRTC] addTrack error for peer ${peerId}:`, addErr);
          }
        }

        if (needsRenegotiation) {
          await initiateOfferToPeer(peerId, sessionGen);
        }
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      }

      if (showToastRef.current) {
        showToastRef.current('📷 Camera turned on.');
      }
    } catch (err) {
      console.warn('[GroupWebRTC] Failed to acquire camera on toggle:', err.name, err.message);
      let errMsg = 'Failed to open camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errMsg = 'Permission denied: Please allow camera access in browser.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errMsg = 'Camera is currently locked by another window or app.';
      } else if (err.name === 'NotFoundError') {
        errMsg = 'No camera found on this device.';
      }
      if (showToastRef.current) {
        showToastRef.current(errMsg, 'error');
      }
    }
  }, [isVideoOff, initiateOfferToPeer]);

  const stopScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* ignore */ }
      });
      screenStreamRef.current = null;
    }

    setScreenStream(null);
    setIsScreenSharing(false);
    isScreenSharingRef.current = false;

    // Restore camera track across all peer connections
    const cameraTrack = (localStreamRef.current && !isAudioOnly)
      ? (localStreamRef.current.getVideoTracks().find((t) => t.readyState === 'live') || null)
      : null;

    const sessionGen = callGenerationRef.current;

    for (const [peerId, pc] of peerConnectionsRef.current.entries()) {
      if (pc && pc.getSenders) {
        let needsRenegotiation = false;
        const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
        const videoTransceiver = transceivers.find((t) =>
          (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
          (t.receiver && t.receiver.track && t.receiver.track.kind === 'video') ||
          (t.sender && t.sender.kind === 'video')
        );

        if (videoTransceiver) {
          if (!cameraTrack && videoTransceiver.direction !== 'recvonly') {
            videoTransceiver.direction = 'recvonly';
            needsRenegotiation = true;
          }
          if (videoTransceiver.sender) {
            try {
              await videoTransceiver.sender.replaceTrack(cameraTrack);
            } catch (rErr) {
              console.warn(`[GroupWebRTC] Error restoring camera track for ${peerId}:`, rErr);
            }
          }
        }

        if (needsRenegotiation) {
          await initiateOfferToPeer(peerId, sessionGen);
        }
      }
    }

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(() => {});
    }
  }, [isAudioOnly, initiateOfferToPeer]);

  const startScreenShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      if (showToastRef.current) {
        showToastRef.current('Screen sharing is not supported by your browser.', 'error');
      }
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });

      const screenVideoTrack = displayStream.getVideoTracks()[0];
      if (!screenVideoTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        return;
      }

      screenStreamRef.current = displayStream;
      setScreenStream(displayStream);
      setIsScreenSharing(true);
      isScreenSharingRef.current = true;

      screenVideoTrack.onended = () => {
        stopScreenShare();
      };

      const sessionGen = callGenerationRef.current;

      // Replace outgoing video track on ALL active peer connections & renegotiate if needed
      for (const [peerId, pc] of peerConnectionsRef.current.entries()) {
        if (!pc) continue;
        let needsRenegotiation = false;
        const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
        const videoTransceiver = transceivers.find((t) =>
          (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
          (t.receiver && t.receiver.track && t.receiver.track.kind === 'video') ||
          (t.sender && t.sender.kind === 'video')
        );

        if (videoTransceiver) {
          if (videoTransceiver.direction !== 'sendrecv') {
            videoTransceiver.direction = 'sendrecv';
            needsRenegotiation = true;
          }
          if (videoTransceiver.sender) {
            try {
              await videoTransceiver.sender.replaceTrack(screenVideoTrack);
            } catch (rErr) {
              console.warn(`[GroupWebRTC] Error replacing track for ${peerId}:`, rErr);
            }
          }
        } else {
          try {
            pc.addTrack(screenVideoTrack, displayStream);
            needsRenegotiation = true;
          } catch (addErr) {
            console.warn(`[GroupWebRTC] Error adding screen track for ${peerId}:`, addErr);
          }
        }

        if (needsRenegotiation) {
          await initiateOfferToPeer(peerId, sessionGen);
        }
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = displayStream;
        localVideoRef.current.play().catch(() => {});
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        console.warn('[GroupWebRTC] getDisplayMedia error:', err);
        if (showToastRef.current) {
          showToastRef.current(`Could not start screen sharing: ${err.message}`, 'error');
        }
      }
    }
  }, [stopScreenShare, initiateOfferToPeer]);

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  const resumeAutoplay = useCallback(() => {
    setAutoplayBlocked(false);
  }, []);

  return {
    // Local media
    localStream,
    screenStream,
    localVideoRef,
    isMuted,
    isVideoOff,
    isAudioOnly,
    isScreenSharing,
    mediaError,
    autoplayBlocked,
    resumeAutoplay,

    // Remote multi-peer state
    peers,
    peerCount: peers.length,
    connectionState,

    // Media controls
    toggleMute,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    toggleScreenShare,
    retryMedia: startMedia,
    cleanup,

    // Direct peer connection and stream getters (for tests and low-level consumers)
    getPeerConnection: (peerId) => peerConnectionsRef.current.get(peerId),
    getPeerStream: (peerId) => remoteStreamsRef.current.get(peerId),
  };
}
