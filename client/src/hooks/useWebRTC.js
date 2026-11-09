/**
 * VideoVerse — WebRTC Media & Peer Connection Hook
 *
 * Phase 6.6: Complete Real-Time Audio & Video Calling Implementation.
 *
 * Capabilities:
 * - Owns RTCPeerConnection lifecycle and STUN/TURN ICE server configuration
 * - Requests camera & microphone with noise-suppressed audio and high-res video
 * - Safe fallback to basic video or audio-only mode when hardware is missing/constrained
 * - Strict offer/answer negotiation order (designated creator/offerer initiates offer)
 * - Incoming ICE candidate buffering queue while remoteDescription is pending
 * - Media track controls: mic mute/unmute and camera toggle using track.enabled
 * - Detailed error handling for NotAllowedError, NotFoundError, NotReadableError, etc.
 * - Persistent remote MediaStream tracking preserving audio & video across track arrivals
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

/**
 * Validates a single ICE server configuration object.
 * Must be a non-null object with valid urls (non-empty string or non-empty array of strings).
 */
export function isValidIceServer(server) {
  if (!server || typeof server !== 'object') return false;
  if (!server.urls) return false;

  if (typeof server.urls === 'string') {
    if (!server.urls.trim()) return false;
  } else if (Array.isArray(server.urls)) {
    if (server.urls.length === 0) return false;
    for (const url of server.urls) {
      if (typeof url !== 'string' || !url.trim()) return false;
    }
  } else {
    return false;
  }

  if (server.username !== undefined && typeof server.username !== 'string') return false;
  if (server.credential !== undefined && typeof server.credential !== 'string') return false;

  return true;
}

/**
 * Validates an array of ICE servers.
 * Must be a non-empty array where every element satisfies isValidIceServer.
 */
export function isValidIceServerList(servers) {
  return Array.isArray(servers) && servers.length > 0 && servers.every(isValidIceServer);
}

/**
 * Fetches dynamic ICE configuration from the authenticated backend endpoint.
 *
 * Security & Fallback Policy:
 * - Sends HTTP-only cookie authentication (credentials: 'include').
 * - Validates response schema thoroughly before returning.
 * - Never logs credentials, tokens, or raw ICE configurations.
 * - Non-sensitive warning logged on failure or invalid payload.
 * - Gracefully falls back to default STUN configuration on network error or HTTP failure.
 * - Bounded retry: Retries at most once before falling back to STUN.
 */
export async function fetchIceServers({
  endpoint = '/api/calls/ice-servers',
  fetchFn = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : globalThis.fetch,
  maxRetries = 1,
  showToast = null,
} = {}) {
  let attempts = 0;
  while (attempts <= maxRetries) {
    attempts++;
    try {
      if (typeof fetchFn !== 'function') {
        throw new Error('Fetch API is not available');
      }

      const res = await fetchFn(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.success && isValidIceServerList(data.iceServers)) {
          return data.iceServers;
        }
        console.warn('[WebRTC] Invalid ICE server payload received from backend. Falling back to public STUN.');
        break; // Schema mismatch: bounded break, no retry
      }

      console.warn(`[WebRTC] ICE server endpoint responded with HTTP ${res.status}.`);
      if (attempts <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
    } catch (err) {
      console.warn(`[WebRTC] Failed to fetch dynamic ICE configuration (attempt ${attempts}/${maxRetries + 1}):`, err?.message || 'Network error');
      if (attempts <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
    }
  }

  console.warn('[WebRTC] Falling back to default public STUN configuration.');
  if (typeof showToast === 'function') {
    showToast('Using fallback connection server', 'warning');
  }
  return getIceServers();
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
    facingMode: { ideal: 'user' },
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
  hasRemotePeer = false,
  enabled = false,
  onPeerLeft,
  showToast,
}) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'closed'
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const onPeerLeftRef = useRef(onPeerLeft);
  onPeerLeftRef.current = onPeerLeft;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const hasRemotePeerRef = useRef(hasRemotePeer);
  hasRemotePeerRef.current = hasRemotePeer;

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const mediaPromiseRef = useRef(null);
  const earlyCandidatesRef = useRef([]);
  const isMakingOfferRef = useRef(false);

  // Dynamic ICE server resolution and call lifecycle guards
  const isCallActiveRef = useRef(false);
  const callGenerationRef = useRef(0);
  const iceServersRef = useRef(null);
  const iceFetchPromiseRef = useRef(null);

  // ── 1. Acquire Local Media Stream ───────────────────────────────────────────
  const startMedia = useCallback(async () => {
    // If we already have an active stream with live tracks, return it immediately
    if (localStreamRef.current && localStreamRef.current.getTracks().some((t) => t.readyState === 'live')) {
      return localStreamRef.current;
    }

    // If a media acquisition is currently in flight, await the existing promise
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

      // 1. Try optimal high-resolution constraints
      try {
        stream = await navigator.mediaDevices.getUserMedia(HIGH_RES_CONSTRAINTS);
      } catch (err) {
        console.warn('[WebRTC] High-res media constraints failed:', err.name, err.message);

        // 2. Try basic constraints if overconstrained or failed
        if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
          try {
            stream = await navigator.mediaDevices.getUserMedia(BASIC_CONSTRAINTS);
          } catch (basicErr) {
            console.warn('[WebRTC] Basic media constraints failed:', basicErr.name);
          }
        }

        // 3. Fallback to audio-only if camera is missing, in-use, or constrained
        if (!stream && (
          err.name === 'NotFoundError' ||
          err.name === 'DevicesNotFoundError' ||
          err.name === 'NotReadableError' ||
          err.name === 'TrackStartError' ||
          err.name === 'OverconstrainedError'
        )) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(AUDIO_ONLY_CONSTRAINTS);
            audioOnly = true;
            setIsAudioOnly(true);
            if (showToastRef.current) {
              showToastRef.current('📷 Camera in use or unavailable. Joined in audio-only mode.');
            }
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
          } else if (err.name === 'SecurityError') {
            msg = 'Media capture blocked by security policy. HTTPS or localhost is required.';
          } else if (err.name === 'AbortError') {
            msg = 'Media acquisition was aborted by the hardware or browser.';
          }
          setMediaError(msg);
          return null;
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsAudioOnly(audioOnly);

      // Attach tracks to existing RTCPeerConnection if one was already initialized
      if (pcRef.current) {
        const existingSenders = pcRef.current.getSenders ? pcRef.current.getSenders() : [];
        stream.getTracks().forEach((track) => {
          const sender = existingSenders.find((s) => s.track && s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track).catch((rErr) => {
              console.warn('[WebRTC] replaceTrack error:', rErr);
            });
          } else {
            try {
              pcRef.current.addTrack(track, stream);
            } catch (addErr) {
              console.warn('[WebRTC] addTrack to existing pc error:', addErr);
            }
          }
        });
      }

      // Attach stream to local preview video element
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

  // ── 2. Flush Early Buffered ICE Candidates ──────────────────────────────────
  const flushCandidateQueue = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;

    while (earlyCandidatesRef.current.length > 0) {
      const candidateData = earlyCandidatesRef.current.shift();
      if (!candidateData || !candidateData.candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
      } catch (err) {
        console.warn('[WebRTC] Failed to add buffered ICE candidate:', err.message);
      }
    }
  }, []);

  // ── Dynamic ICE Configuration Fetcher ──────────────────────────────────────
  const getOrFetchIceServers = useCallback(async (sessionGen = callGenerationRef.current) => {
    // If already resolved for the active session, return immediately
    if (iceServersRef.current && isValidIceServerList(iceServersRef.current)) {
      return iceServersRef.current;
    }

    // Reuse in-flight promise to prevent duplicate concurrent network requests
    if (!iceFetchPromiseRef.current) {
      const fetchPromise = fetchIceServers({ showToast })
        .then((servers) => {
          // Stale check: apply to shared ref only if generation still matches and call is active
          if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
            iceServersRef.current = servers;
          }
          return servers;
        })
        .finally(() => {
          // Stale check: clear cache only if it matches this exact promise and generation is still current
          if (iceFetchPromiseRef.current === fetchPromise && callGenerationRef.current === sessionGen) {
            iceFetchPromiseRef.current = null;
          }
        });

      iceFetchPromiseRef.current = fetchPromise;
    }

    return iceFetchPromiseRef.current;
  }, [showToast]);

  // ── 3. Teardown & Resource Cleanup ──────────────────────────────────────────
  const cleanup = useCallback(() => {
    // Invalidate active call status and increment generation immediately to block in-flight async callbacks
    callGenerationRef.current++;
    isCallActiveRef.current = false;
    iceServersRef.current = null;
    iceFetchPromiseRef.current = null;
    mediaPromiseRef.current = null;

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

    // 2. Clear remote stream and stop any tracks
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      remoteStreamRef.current = null;
    }
    setRemoteStream(null);
    setHasRemoteVideo(false);

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
    setConnectionState('closed');
  }, []);

  // ── 4. Initialize RTCPeerConnection ─────────────────────────────────────────
  const initPeerConnection = useCallback(async (mediaStream, expectedGen = callGenerationRef.current) => {
    const currentGen = expectedGen || callGenerationRef.current;

    if (pcRef.current) return pcRef.current;
    if (!isCallActiveRef.current || callGenerationRef.current !== currentGen) return null;
    if (typeof RTCPeerConnection === 'undefined') {
      setMediaError('WebRTC RTCPeerConnection is not supported by your browser.');
      return null;
    }

    // Await validated ICE servers (dynamic TURN/STUN or safe fallback) with generation tracking
    const iceServers = await getOrFetchIceServers(currentGen);

    // Guard: Prevent stale async responses from creating connections after call ended or new call started
    if (!isCallActiveRef.current || callGenerationRef.current !== currentGen) {
      return null;
    }
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: isValidIceServerList(iceServers) ? iceServers : getIceServers(),
      iceCandidatePoolSize: 10,
    });

    // Guard again before mutating pcRef.current
    if (!isCallActiveRef.current || callGenerationRef.current !== currentGen) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
      return null;
    }

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
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      // Add track to persistent stream if not already present
      if (!remoteStreamRef.current.getTracks().some((t) => t.id === event.track.id)) {
        remoteStreamRef.current.addTrack(event.track);
      }

      const updateRemoteVideoStatus = () => {
        const stream = remoteStreamRef.current;
        const vTracks = stream ? stream.getVideoTracks() : [];
        const hasLiveVideo = vTracks.some((t) => t.readyState === 'live' && !t.muted);
        setHasRemoteVideo(hasLiveVideo);
      };

      event.track.onmute = updateRemoteVideoStatus;
      event.track.onunmute = updateRemoteVideoStatus;
      event.track.onended = () => {
        updateRemoteVideoStatus();
        const currentTracks = remoteStreamRef.current ? remoteStreamRef.current.getTracks() : [];
        setRemoteStream(currentTracks.length > 0 ? new MediaStream(currentTracks) : null);
      };

      // Always create a new MediaStream container for React state so React reliably detects change
      const cloned = new MediaStream(remoteStreamRef.current.getTracks());
      setRemoteStream(cloned);
      updateRemoteVideoStatus();

      if (remoteVideoRef.current) {
        if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
        }
        remoteVideoRef.current.play().catch((playErr) => {
          console.warn('[WebRTC] Remote video autoplay blocked:', playErr);
          setAutoplayBlocked(true);
        });
      }
    };

    // Forward ICE candidates to signaling server (including end-of-candidates notification)
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
  }, [socket, roomId, getOrFetchIceServers]);

  // ── 5. Designated Offerer Initiation ────────────────────────────────────────
  const initiateOffer = useCallback(async (customPc = null, sessionGen = callGenerationRef.current) => {
    if (!isCreator) return;
    if (isMakingOfferRef.current) return;
    if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

    try {
      isMakingOfferRef.current = true;
      setConnectionState('connecting');

      // Ensure local media is ready before offering
      let stream = localStreamRef.current;
      if (!stream) {
        stream = await startMedia();
      }

      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      let pc = customPc || pcRef.current;
      if (!pc) {
        pc = await initPeerConnection(stream, sessionGen);
      } else if (stream && pc.getSenders) {
        const senders = pc.getSenders();
        stream.getTracks().forEach((track) => {
          const hasSender = senders.some((s) => s.track && s.track.kind === track.kind);
          if (!hasSender) {
            try {
              pc.addTrack(track, stream);
            } catch (addErr) {
              console.warn('[WebRTC] Error attaching local track to pc:', addErr.message);
            }
          }
        });
      }
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
        sdp: {
          type: 'offer',
          sdp: offer.sdp,
        },
      });
    } catch (err) {
      if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
        console.error('[WebRTC] Failed to create or dispatch offer:', err);
        setConnectionState('failed');
      }
    } finally {
      if (callGenerationRef.current === sessionGen) {
        isMakingOfferRef.current = false;
      }
    }
  }, [isCreator, roomId, socket, startMedia, initPeerConnection]);

  // ── 6. Signaling Event Listeners (Offer, Answer, Candidate, Peers) ───────────
  useEffect(() => {
    if (!enabled || !socket || !roomId) return;

    // Increment generation for the new call session
    const sessionGen = ++callGenerationRef.current;
    isCallActiveRef.current = true;

    // Pre-fetch ICE configuration asynchronously in parallel with media acquisition
    getOrFetchIceServers(sessionGen);

    // Named Signaling Handler: Creator initiates initial offer upon peer join
    const handlePeerJoined = async () => {
      if (!isCreator) return;
      await initiateOffer(null, sessionGen);
    };

    // Named Signaling Handler: Invitee receives offer and responds with answer
    const handleOffer = async (payload) => {
      const sdpData = payload?.sdp;
      if (!sdpData || sdpData.type !== 'offer') return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      try {
        setConnectionState('connecting');

        // Ensure local media is acquired
        let stream = localStreamRef.current;
        if (!stream) {
          stream = await startMedia();
        }

        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        let pc = pcRef.current;
        if (!pc) {
          pc = await initPeerConnection(stream, sessionGen);
        } else if (stream && pc.getSenders) {
          const senders = pc.getSenders();
          stream.getTracks().forEach((track) => {
            const hasSender = senders.some((s) => s.track && s.track.kind === track.kind);
            if (!hasSender) {
              try {
                pc.addTrack(track, stream);
              } catch (addErr) {
                console.warn('[WebRTC] Error attaching local track to pc:', addErr.message);
              }
            }
          });
        }
        if (!pc || !isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        // Anti-glare check: if already in non-stable state on caller side
        if (isCreator && pc.signalingState !== 'stable') {
          console.warn('[WebRTC] Offer collision detected on creator, dropping duplicate offer.');
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        await flushCandidateQueue();

        const answer = await pc.createAnswer();
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        await pc.setLocalDescription(answer);
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

        socket.emit('answer', {
          roomId,
          sdp: {
            type: 'answer',
            sdp: answer.sdp,
          },
        });
      } catch (err) {
        if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
          console.error('[WebRTC] Failed to handle incoming offer:', err);
          setConnectionState('failed');
        }
      }
    };

    // Named Signaling Handler: Creator receives answer from invitee
    const handleAnswer = async (payload) => {
      const sdpData = payload?.sdp;
      if (!sdpData || sdpData.type !== 'answer') return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdpData));
        if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;
        await flushCandidateQueue();
      } catch (err) {
        if (callGenerationRef.current === sessionGen && isCallActiveRef.current) {
          console.error('[WebRTC] Failed to apply remote answer:', err);
        }
      }
    };

    // Named Signaling Handler: Incoming ICE Candidate with early buffering
    const handleIceCandidate = async (payload) => {
      const cand = payload?.candidate;
      if (!cand || typeof cand.candidate !== 'string') return;
      if (!isCallActiveRef.current || callGenerationRef.current !== sessionGen) return;

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
      if (callGenerationRef.current !== sessionGen) return;
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach((track) => {
          try { track.stop(); } catch { /* ignore stop errors on unmounted tracks */ }
        });
        remoteStreamRef.current = null;
      }
      setRemoteStream(null);
      setHasRemoteVideo(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setConnectionState('disconnected');
      if (typeof onPeerLeftRef.current === 'function') {
        onPeerLeftRef.current(data);
      }
    };

    // Attach named listeners
    socket.on('peer-joined', handlePeerJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-left', handlePeerLeft);

    // Initial media acquisition upon room enablement
    startMedia().then(async (stream) => {
      if (stream && isCallActiveRef.current && callGenerationRef.current === sessionGen) {
        const pc = await initPeerConnection(stream, sessionGen);
        // If peer is already present in room when creator initializes, initiate offer immediately
        if (isCreator && hasRemotePeerRef.current && pc && !pc.remoteDescription) {
          await initiateOffer(pc, sessionGen);
        }
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
    initiateOffer,
    startMedia,
    initPeerConnection,
    flushCandidateQueue,
    cleanup,
    getOrFetchIceServers,
  ]);

  // If creator joins when peer is already present, initiate offer once peer connection is active
  useEffect(() => {
    if (isCreator && hasRemotePeer && isCallActiveRef.current && pcRef.current && !pcRef.current.remoteDescription && !isMakingOfferRef.current) {
      initiateOffer(pcRef.current);
    }
  }, [hasRemotePeer, isCreator, initiateOffer]);

  // Keep local video element source synchronized
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.muted = true;
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, isVideoOff]);

  // Keep remote video element source synchronized
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      remoteVideoRef.current.play().catch(() => {
        setAutoplayBlocked(true);
      });
    }
  }, [remoteStream]);

  // ── 7. Media Controls (Mute / Camera Toggle) ────────────────────────────────
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
        .catch((err) => console.warn('[WebRTC] resumeAutoplay failed:', err));
    }
  }, []);

  return {
    localStream,
    remoteStream,
    hasRemoteVideo,
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
