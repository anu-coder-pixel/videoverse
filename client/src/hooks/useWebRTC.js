/**
 * VideoVerse — WebRTC Media & Peer Connection Hook
 *
 * Phase 6.2.2: Native WebRTC 1-on-1 audio/video calling.
 *
 * Capabilities:
 * - Owns RTCPeerConnection lifecycle and STUN/TURN ICE server configuration
 * - Requests camera & microphone with noise-suppressed audio and high-res video
 * - Safe fallback to basic video or audio-only mode when hardware is missing/constrained
 * - Strict offer/answer negotiation order (caller/creator initiates initial offer to avoid glare)
 * - Incoming ICE candidate buffering queue while remoteDescription is pending
 * - Media track controls: mic mute/unmute and camera toggle using track.enabled
 * - Detailed error handling for NotAllowedError, NotFoundError, NotReadableError, etc.
 * - Comprehensive teardown: track stops, peer connection closure, specific listener removal
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── ICE Server Configuration ──────────────────────────────────────────────────
/**
 * Resolves ICE servers for peer connection establishment.
 *
 * Security Policy:
 * - Public STUN servers are used for NAT discovery (no credentials required).
 * - VITE_TURN_SERVER_URL specifies relay server host/port only. It MUST NOT contain
 *   embedded credentials (such as turn:user:pass@host).
 * - Static/permanent TURN username and credential environment variables (VITE_TURN_USERNAME,
 *   VITE_TURN_CREDENTIAL) are strictly prohibited and intentionally ignored to prevent compiling
 *   long-lived secrets into public frontend client bundles.
 */
export function getIceServers() {
  const stunUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STUN_SERVER_URL)
    ? import.meta.env.VITE_STUN_SERVER_URL
    : 'stun:stun.l.google.com:19302';

  const iceServers = [{ urls: stunUrl }];

  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TURN_SERVER_URL) {
    // Relay server URL only (host:port). Must not contain embedded credentials.
    iceServers.push({
      urls: import.meta.env.VITE_TURN_SERVER_URL,
    });
  } else {
    // Secondary public STUN server fallback
    iceServers.push({ urls: 'stun:stun1.l.google.com:19302' });
  }

  return iceServers;
}

// ── Media Constraints ─────────────────────────────────────────────────────────
export const HIGH_RES_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
    facingMode: 'user',
  },
};

export const BASIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
  },
  video: true,
};

export const AUDIO_ONLY_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

/**
 * Custom React Hook for WebRTC 1-to-1 Calls
 */
export function useWebRTC({
  socket,
  roomId,
  isCreator = false,
  enabled = false,
  onPeerLeft,
  showToast,
}) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'closed'
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const earlyCandidatesRef = useRef([]);
  const isMakingOfferRef = useRef(false);
  const isInitiatingMediaRef = useRef(false);

  // ── 1. Acquire Local Media Stream ───────────────────────────────────────────
  const startMedia = useCallback(async () => {
    if (isInitiatingMediaRef.current || localStreamRef.current) {
      return localStreamRef.current;
    }
    isInitiatingMediaRef.current = true;
    setMediaError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const errText = 'Your browser does not support camera or microphone capture.';
      setMediaError(errText);
      isInitiatingMediaRef.current = false;
      return null;
    }

    let stream = null;
    let audioOnly = false;

    // 1. Try optimal high-resolution constraints
    try {
      stream = await navigator.mediaDevices.getUserMedia(HIGH_RES_CONSTRAINTS);
    } catch (err) {
      console.warn('[WebRTC] High-res media constraints failed:', err.name, err.message);

      // 2. Try basic constraints if overconstrained
      if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia(BASIC_CONSTRAINTS);
        } catch (basicErr) {
          console.warn('[WebRTC] Basic media constraints failed:', basicErr.name);
        }
      }

      // 3. Fallback to audio-only if camera is missing or in-use
      if (!stream && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.name === 'NotReadableError' || err.name === 'TrackStartError')) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(AUDIO_ONLY_CONSTRAINTS);
          audioOnly = true;
          setIsAudioOnly(true);
          if (showToast) showToast('📷 Camera unavailable. Joined in audio-only mode.');
        } catch (audioErr) {
          console.error('[WebRTC] Audio-only fallback also failed:', audioErr.name);
        }
      }

      // 4. Map user-facing error message if all attempts failed
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
        isInitiatingMediaRef.current = false;
        return null;
      }
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsAudioOnly(audioOnly);
    isInitiatingMediaRef.current = false;

    // Attach stream to local preview video element
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    return stream;
  }, [showToast]);

  // ── 2. Flush Early Buffered ICE Candidates ──────────────────────────────────
  const flushCandidateQueue = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;

    while (earlyCandidatesRef.current.length > 0) {
      const candidateData = earlyCandidatesRef.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
      } catch (err) {
        console.warn('[WebRTC] Failed to add buffered ICE candidate:', err.message);
      }
    }
  }, []);

  // ── 3. Teardown & Resource Cleanup ──────────────────────────────────────────
  const cleanup = useCallback(() => {
    // 1. Stop all tracks on local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // 2. Clear remote stream
    setRemoteStream(null);

    // 3. Clear video element sources
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // 4. Close RTCPeerConnection and clear handlers
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      try {
        pcRef.current.close();
      } catch {
        // Ignore
      }
      pcRef.current = null;
    }

    // 5. Clear state and buffers
    earlyCandidatesRef.current = [];
    isMakingOfferRef.current = false;
    isInitiatingMediaRef.current = false;
    setConnectionState('closed');
  }, []);

  // ── 4. Initialize RTCPeerConnection ─────────────────────────────────────────
  const initPeerConnection = useCallback((mediaStream) => {
    if (pcRef.current) return pcRef.current;
    if (typeof RTCPeerConnection === 'undefined') {
      setMediaError('WebRTC RTCPeerConnection is not supported by your browser.');
      return null;
    }

    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceCandidatePoolSize: 10,
    });
    pcRef.current = pc;

    // Attach local media tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, mediaStream);
        } catch (err) {
          console.warn('[WebRTC] Error adding local track to peer connection:', err.message);
        }
      });
    }

    // Handle remote media track
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch((playErr) => {
            console.warn('[WebRTC] Remote video autoplay blocked:', playErr);
            setAutoplayBlocked(true);
          });
        }
      }
    };

    // Forward ICE candidates to signaling server
    pc.onicecandidate = (event) => {
      if (!socket || !roomId) return;
      if (event.candidate) {
        socket.emit('ice-candidate', {
          roomId,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionState(state);
      if (state === 'failed' || state === 'disconnected') {
        console.warn(`[WebRTC] Peer connection state changed to: ${state}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === 'disconnected' || iceState === 'failed') {
        setConnectionState(iceState === 'failed' ? 'failed' : 'reconnecting');
      } else if (iceState === 'connected' || iceState === 'completed') {
        setConnectionState('connected');
      }
    };

    return pc;
  }, [socket, roomId]);

  // ── 5. Signaling Event Listeners (Offer, Answer, Candidate, Peers) ───────────
  useEffect(() => {
    if (!enabled || !socket || !roomId) return;

    // Local stream holder
    let activeStream = null;

    // Named Signaling Handler: Creator initiates initial offer upon peer join
    const handlePeerJoined = async () => {
      if (!isCreator) return;
      if (isMakingOfferRef.current) return;

      try {
        isMakingOfferRef.current = true;
        setConnectionState('connecting');

        // Ensure local media is ready before offering
        if (!localStreamRef.current) {
          activeStream = await startMedia();
        } else {
          activeStream = localStreamRef.current;
        }

        const pc = pcRef.current || initPeerConnection(activeStream);
        if (!pc) return;

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        await pc.setLocalDescription(offer);

        socket.emit('offer', {
          roomId,
          sdp: {
            type: 'offer',
            sdp: offer.sdp,
          },
        });
      } catch (err) {
        console.error('[WebRTC] Failed to create or dispatch offer:', err);
        setConnectionState('failed');
      } finally {
        isMakingOfferRef.current = false;
      }
    };

    // Named Signaling Handler: Invitee receives offer and responds with answer
    const handleOffer = async (payload) => {
      const sdpData = payload?.sdp;
      if (!sdpData || sdpData.type !== 'offer') return;

      try {
        setConnectionState('connecting');

        // Ensure local media is acquired
        if (!localStreamRef.current) {
          activeStream = await startMedia();
        } else {
          activeStream = localStreamRef.current;
        }

        const pc = pcRef.current || initPeerConnection(activeStream);
        if (!pc) return;

        // Anti-glare check: if already in non-stable state on caller side
        if (isCreator && pc.signalingState !== 'stable') {
          console.warn('[WebRTC] Offer collision detected on creator, dropping duplicate offer.');
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
        await flushCandidateQueue();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', {
          roomId,
          sdp: {
            type: 'answer',
            sdp: answer.sdp,
          },
        });
      } catch (err) {
        console.error('[WebRTC] Failed to handle incoming offer:', err);
        setConnectionState('failed');
      }
    };

    // Named Signaling Handler: Creator receives answer from invitee
    const handleAnswer = async (payload) => {
      const sdpData = payload?.sdp;
      if (!sdpData || sdpData.type !== 'answer') return;

      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
        await flushCandidateQueue();
      } catch (err) {
        console.error('[WebRTC] Failed to apply remote answer:', err);
      }
    };

    // Named Signaling Handler: Incoming ICE Candidate with early buffering
    const handleIceCandidate = async (payload) => {
      const cand = payload?.candidate;
      if (!cand || typeof cand.candidate !== 'string') return;

      const pc = pcRef.current;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn('[WebRTC] Error adding ICE candidate directly:', err.message);
        }
      } else {
        // Buffer candidate until remote description has been set
        earlyCandidatesRef.current.push(cand);
      }
    };

    // Named Signaling Handler: Remote peer left room
    const handlePeerLeft = (data) => {
      setRemoteStream(null);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setConnectionState('disconnected');
      if (typeof onPeerLeft === 'function') {
        onPeerLeft(data);
      }
    };

    // Attach named listeners
    socket.on('peer-joined', handlePeerJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-left', handlePeerLeft);

    // Initial media acquisition upon room enablement
    startMedia().then((stream) => {
      if (stream) {
        initPeerConnection(stream);
      }
    });

    // Cleanup: Remove ONLY the named listeners registered by this hook
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
    isCreator,
    startMedia,
    initPeerConnection,
    flushCandidateQueue,
    onPeerLeft,
    cleanup,
  ]);

  // Keep local video element source synchronized
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Keep remote video element source synchronized
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {
        setAutoplayBlocked(true);
      });
    }
  }, [remoteStream]);

  // ── 6. Media Controls (Mute / Camera Toggle) ────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;

    const willEnable = isMuted; // If currently muted, we want to enable (unmute)
    audioTracks.forEach((t) => {
      t.enabled = willEnable;
    });
    setIsMuted(!willEnable);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current || isAudioOnly) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length === 0) return;

    const willEnable = isVideoOff; // If currently off, we want to enable (turn on)
    videoTracks.forEach((t) => {
      t.enabled = willEnable;
    });
    setIsVideoOff(!willEnable);
  }, [isVideoOff, isAudioOnly]);

  const resumeAutoplay = useCallback(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {});
    }
  }, []);

  return {
    localStream,
    remoteStream,
    localVideoRef,
    remoteVideoRef,
    connectionState,
    isMuted,
    isVideoOff,
    isAudioOnly,
    mediaError,
    autoplayBlocked,
    toggleMute,
    toggleVideo,
    retryMedia: startMedia,
    resumeAutoplay,
    cleanup,
  };
}
