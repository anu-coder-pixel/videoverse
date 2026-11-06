import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  User,
  Users,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  Clock,
  Shield,
  RefreshCw,
  ArrowLeft,
  Share2,
  LogIn,
  Volume2,
  VolumeX,
  Radio,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCall } from '../../context/CallContext';
import { useWebRTC } from '../../hooks/useWebRTC';
import './CallPage.css';

export default function CallPage() {
  const {
    currentUser,
    openAuthModal,
    showToast,
    callRoomId,
    navigateToCall,
    navigateToHome,
    isValidRoomId,
  } = useApp();

  // ── Global Signaling Gateway ───────────────────────────────────────────────
  const { socket: globalSocket, socketConnected } = useCall();

  // ── Contacts State ──────────────────────────────────────────────────────────
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(null);
  const [selectedInvitee, setSelectedInvitee] = useState(null);

  // ── Room & Call State ───────────────────────────────────────────────────────
  const [activeRoomId, setActiveRoomId] = useState(callRoomId || null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [roomError, setRoomError] = useState(null);
  const [roomState, setRoomState] = useState(null); // { roomId, participants, isCreator, allowedUserIds, status, invitee }
  const [copiedLink, setCopiedLink] = useState(false);

  const socketRef = useRef(globalSocket);
  socketRef.current = globalSocket;
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;
  const selectedInviteeRef = useRef(selectedInvitee);
  selectedInviteeRef.current = selectedInvitee;

  // ── Fetch Registered Contacts ───────────────────────────────────────────────
  const fetchContacts = useCallback(async () => {
    if (!currentUser) return;
    setContactsLoading(true);
    setContactsError(null);
    try {
      const res = await fetch('/api/auth/users', {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to load contacts');
      }
      setContacts(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      console.error('[CallPage] Error fetching contacts:', err.message);
      setContactsError(err.message || 'Unable to load registered contacts.');
    } finally {
      setContactsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchContacts();
    }
  }, [currentUser, fetchContacts]);

  // ── Socket.IO Listener Lifecycle on Shared Gateway ─────────────────────────
  useEffect(() => {
    if (!currentUser || !globalSocket) return;

    // Named handler for peer joined
    const onPeerJoined = (data) => {
      showToast(`👋 ${data.user?.name || 'Peer'} has joined the call!`);
      setRoomState((prev) => {
        if (!prev) return prev;
        const exists = prev.participants?.some((p) => p.socketId === data.peerId);
        const newParticipants = exists ? prev.participants : [
          ...(prev.participants || []),
          {
            socketId: data.peerId,
            userId: data.user?.id,
            name: data.user?.name,
            avatarColor: data.user?.avatarColor,
            initials: data.user?.initials,
            isSelf: false,
          },
        ];
        return {
          ...prev,
          participants: newParticipants,
          status: 'peer-connected',
        };
      });
    };

    // Named handler for peer left
    const onPeerLeft = (data) => {
      const reasonMsg = data.reason === 'room-closed'
        ? 'The call was ended and the room was closed by the host.'
        : `${data.name || 'Peer'} left the call.`;
      showToast(reasonMsg);

      if (data.reason === 'room-closed') {
        setRoomState(null);
        setActiveRoomId(null);
        navigateToCall(null);
      } else {
        setRoomState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: (prev.participants || []).filter((p) => p.socketId !== data.peerId),
            status: 'waiting-for-peer',
          };
        });
      }
    };

    // Caller receives call rejection
    const onCallRejected = (data) => {
      if (data?.roomId && activeRoomIdRef.current && data.roomId === activeRoomIdRef.current) {
        showToast(`Call declined by ${selectedInviteeRef.current?.name || 'recipient'}.`);
        setRoomState((prev) => (prev ? { ...prev, status: 'declined' } : prev));
      }
    };

    // Caller receives unanswered timeout
    const onCallTimeout = (data) => {
      if (data?.roomId && activeRoomIdRef.current && data.roomId === activeRoomIdRef.current) {
        showToast(`No answer from ${selectedInviteeRef.current?.name || 'recipient'}.`);
        setRoomState((prev) => (prev ? { ...prev, status: 'no-answer' } : prev));
      }
    };

    globalSocket.on('peer-joined', onPeerJoined);
    globalSocket.on('peer-left', onPeerLeft);
    globalSocket.on('call-rejected', onCallRejected);
    globalSocket.on('call-timeout', onCallTimeout);

    return () => {
      // Cleanup: leave current room and remove page-specific listeners without tearing down global socket
      if (activeRoomIdRef.current && globalSocket) {
        globalSocket.emit('leave-room', { roomId: activeRoomIdRef.current });
      }
      globalSocket.off('peer-joined', onPeerJoined);
      globalSocket.off('peer-left', onPeerLeft);
      globalSocket.off('call-rejected', onCallRejected);
      globalSocket.off('call-timeout', onCallTimeout);
    };
  }, [currentUser, globalSocket, showToast, navigateToCall]);

  // ── Sync with external callRoomId prop changes (e.g. popstate / URL) ────────
  useEffect(() => {
    setActiveRoomId(callRoomId || null);
  }, [callRoomId]);

  // ── WebRTC Hook Integration (Phase 6.2.2) ───────────────────────────────────
  const {
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
    retryMedia,
    resumeAutoplay,
    cleanup: cleanupWebRTC,
  } = useWebRTC({
    socket: socketRef.current,
    roomId: activeRoomId,
    isCreator: Boolean(roomState?.isCreator),
    enabled: Boolean(roomState && socketConnected),
    onPeerLeft: () => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: 'waiting-for-peer',
        };
      });
    },
    showToast,
  });

  // ── Join Room Flow ──────────────────────────────────────────────────────────
  const joinRoom = useCallback((roomIdToJoin) => {
    if (!roomIdToJoin || !socketRef.current) return;

    if (!isValidRoomId(roomIdToJoin)) {
      setRoomError('Invalid room identifier format. Room IDs must be 6-64 characters with alphanumeric characters, dashes, or underscores.');
      return;
    }

    setIsJoiningRoom(true);
    setRoomError(null);

    socketRef.current.emit('join-room', { roomId: roomIdToJoin }, (res) => {
      setIsJoiningRoom(false);
      if (!res || !res.success) {
        const errCode = res?.error;
        let userMessage = res?.message || 'Failed to join video call room.';
        if (errCode === 'ROOM_NOT_FOUND') {
          userMessage = 'This call room does not exist, has expired, or was closed by the host.';
        } else if (errCode === 'ROOM_ACCESS_DENIED') {
          userMessage = 'Access Denied: You are not authorized to join this room. Only the room creator and designated invitee may enter.';
        } else if (errCode === 'ROOM_FULL') {
          userMessage = 'Room Full: This video call has reached its 2-participant capacity.';
        } else if (errCode === 'INVALID_ROOM_ID') {
          userMessage = 'Invalid room ID format.';
        }
        setRoomError(userMessage);
        return;
      }

      setActiveRoomId(roomIdToJoin);
      setRoomState({
        roomId: res.roomId,
        participants: res.participants || [],
        isCreator: false,
        status: (res.participants?.length > 1) ? 'peer-connected' : 'waiting-for-peer',
      });
      showToast('Joined call room successfully');
    });
  }, [isValidRoomId, showToast]);

  // If page loads with a roomId parameter, automatically attempt to join
  useEffect(() => {
    if (callRoomId && socketConnected && !roomState && !roomError) {
      joinRoom(callRoomId);
    }
  }, [callRoomId, socketConnected, roomState, roomError, joinRoom]);

  // ── Create Room Flow ────────────────────────────────────────────────────────
  const handleStartCall = async () => {
    if (!selectedInvitee) {
      showToast('Please select a contact to call first.');
      return;
    }
    if (isCreatingRoom) return; // Prevent duplicate clicks
    if (!socketRef.current || !socketConnected) {
      setRoomError('Signaling gateway disconnected. Reconnecting...');
      return;
    }

    setIsCreatingRoom(true);
    setRoomError(null);

    socketRef.current.emit('create-room', { inviteeId: selectedInvitee.id }, (res) => {
      setIsCreatingRoom(false);
      if (!res || !res.success) {
        const errCode = res?.error;
        let msg = res?.message || 'Failed to create video call room.';
        if (errCode === 'SELF_INVITE_NOT_ALLOWED') {
          msg = 'You cannot start a call with yourself.';
        } else if (errCode === 'INVITEE_BUSY') {
          msg = `${selectedInvitee.name} is currently in another call or unavailable.`;
        } else if (errCode === 'RATE_LIMIT_EXCEEDED') {
          msg = 'Room creation limit reached. Please wait a minute before starting another call.';
        } else if (errCode === 'MAX_ACTIVE_ROOMS_EXCEEDED') {
          msg = 'You already have 3 active call rooms. Please leave or close previous rooms.';
        } else if (errCode === 'INVITEE_NOT_FOUND') {
          msg = 'The selected contact account could not be found.';
        }
        setRoomError(msg);
        return;
      }

      const newRoomId = res.roomId;
      setActiveRoomId(newRoomId);
      navigateToCall(newRoomId);

      // Creator automatically joins the newly allocated room
      socketRef.current.emit('join-room', { roomId: newRoomId }, (joinRes) => {
        if (joinRes && joinRes.success) {
          setRoomState({
            roomId: newRoomId,
            creatorId: res.creatorId,
            allowedUserIds: res.allowedUserIds,
            participants: joinRes.participants || [],
            isCreator: true,
            status: 'ringing', // "Ringing [recipient name]..."
            invitee: selectedInvitee,
          });
          showToast(`Ringing ${selectedInvitee.name}...`);
        } else {
          setRoomError(joinRes?.message || 'Room created, but failed to join as host.');
        }
      });
    });
  };

  // ── Cancel Call while Ringing ───────────────────────────────────────────────
  const handleCancelCall = () => {
    if (socketRef.current && activeRoomId) {
      socketRef.current.emit('cancel-call', { roomId: activeRoomId });
    }
    handleEndCall();
  };

  // ── End / Leave Call ────────────────────────────────────────────────────────
  const handleEndCall = () => {
    // 1. Tear down WebRTC media and peer connection
    cleanupWebRTC();

    // 2. Tear down socket room membership
    if (socketRef.current && activeRoomId) {
      if (roomState?.isCreator) {
        socketRef.current.emit('close-room', { roomId: activeRoomId }, () => {
          showToast('Call ended and room closed.');
        });
      } else {
        socketRef.current.emit('leave-room', { roomId: activeRoomId });
        showToast('You left the call room.');
      }
    }

    setRoomState(null);
    setActiveRoomId(null);
    setSelectedInvitee(null);
    navigateToCall(null);
  };

  // ── Copy Room Link ──────────────────────────────────────────────────────────
  const handleCopyLink = () => {
    if (!activeRoomId) return;
    const inviteUrl = `${window.location.origin}?call=${activeRoomId}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteUrl)
        .then(() => {
          setCopiedLink(true);
          showToast('📋 Call link copied to clipboard!');
          setTimeout(() => setCopiedLink(false), 2500);
        })
        .catch(() => {
          showToast('Failed to copy link automatically.');
        });
    }
  };

  // ── Render: Unauthenticated Guard ───────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="call-page animate-fade-in" role="main">
        <div className="call-page__auth-card glass">
          <div className="call-page__auth-icon-wrap">
            <Video size={42} className="call-page__hero-icon" />
          </div>
          <h2 className="call-page__auth-title">Real-Time Video Calling</h2>
          <p className="call-page__auth-desc">
            Sign in to VideoVerse to start or join encrypted 1-on-1 video calls with contacts.
          </p>
          <button
            type="button"
            className="call-page__btn call-page__btn--primary"
            onClick={() => openAuthModal('login')}
            id="call-auth-signin-btn"
          >
            <LogIn size={18} />
            <span>Sign In to Continue</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Active Call / Room View with Native WebRTC Media ────────────────
  if (roomState) {
    const remotePeer = roomState.participants?.find((p) => !p.isSelf);
    const hasRemotePeer = Boolean(remotePeer || roomState.participants?.length > 1);

    return (
      <div className="call-page animate-fade-in" role="main">
        <div className="call-page__active-room glass">
          {/* Active Call Header */}
          <div className="call-page__active-header">
            <div className="call-page__room-meta">
              <div className="call-page__badge-group">
                <span className="call-page__badge call-page__badge--live">
                  <span className="call-page__pulse-dot" /> LIVE ROOM
                </span>
                <span className="call-page__badge call-page__badge--id">
                  {roomState.roomId}
                </span>
                {/* Connection Status Badge */}
                <span className={`call-page__badge call-page__badge--status call-page__badge--${connectionState}`}>
                  {connectionState === 'connected' && '🟢 Connected'}
                  {connectionState === 'connecting' && '🟡 Connecting Media...'}
                  {connectionState === 'reconnecting' && '🟠 Reconnecting...'}
                  {connectionState === 'failed' && '🔴 Connection Failed'}
                  {(connectionState === 'idle' || connectionState === 'closed') && '⚪ Call Ready'}
                </span>
                {isAudioOnly && (
                  <span className="call-page__badge call-page__badge--audio-only">
                    🎙️ Audio Only Mode
                  </span>
                )}
              </div>
              <h2 className="call-page__active-title">
                {hasRemotePeer
                  ? `Call with ${remotePeer?.name || 'Participant'}`
                  : roomState.status === 'ringing'
                  ? `Ringing ${roomState.invitee?.name || 'recipient'}...`
                  : roomState.status === 'declined'
                  ? 'Call Declined'
                  : roomState.status === 'no-answer'
                  ? 'No Answer'
                  : 'Waiting for Participant to Join...'}
              </h2>
            </div>

            <div className="call-page__header-actions">
              <button
                type="button"
                className="call-page__btn call-page__btn--outline"
                onClick={handleCopyLink}
                title="Copy invite link"
                id="call-copy-link-btn"
              >
                {copiedLink ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                <span>{copiedLink ? 'Copied Link' : 'Copy Invite Link'}</span>
              </button>
              {roomState.status === 'ringing' ? (
                <button
                  type="button"
                  className="call-page__btn call-page__btn--danger"
                  onClick={handleCancelCall}
                  title="Cancel Call"
                  id="call-cancel-ringing-header-btn"
                >
                  <PhoneOff size={16} />
                  <span>Cancel Call</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="call-page__btn call-page__btn--danger"
                  onClick={handleEndCall}
                  title={roomState.isCreator ? 'End Call and Close Room' : 'Leave Call'}
                  id="call-end-call-btn"
                >
                  <PhoneOff size={16} />
                  <span>{roomState.isCreator ? 'End Call' : 'Leave Call'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Media Capture Error Banner */}
          {mediaError && (
            <div className="call-page__media-error-banner animate-fade-in" role="alert">
              <AlertTriangle size={18} className="text-warning" />
              <div className="call-page__media-error-text">
                <strong>Device Notice:</strong> {mediaError}
              </div>
              <button
                type="button"
                className="call-page__btn call-page__btn--outline call-page__btn--sm"
                onClick={retryMedia}
              >
                Retry Devices
              </button>
            </div>
          )}

          {/* Autoplay blocked banner */}
          {autoplayBlocked && (
            <div className="call-page__autoplay-banner animate-fade-in">
              <Volume2 size={18} />
              <span>Audio/Video autoplay was blocked by browser.</span>
              <button
                type="button"
                className="call-page__btn call-page__btn--primary call-page__btn--sm"
                onClick={resumeAutoplay}
              >
                Enable Audio & Video
              </button>
            </div>
          )}

          {/* ── Native WebRTC Video Canvas Stage ───────────────────────────── */}
          <div className="call-page__video-stage">
            {/* Main Remote Video Screen */}
            <div className="call-page__remote-wrapper glass">
              {remoteStream ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="call-page__remote-video"
                  id="remote-video-player"
                />
              ) : (
                <div className="call-page__remote-placeholder">
                  {hasRemotePeer ? (
                    <div className="call-page__remote-peer-card">
                      <div
                        className="call-page__stage-avatar"
                        style={{ background: remotePeer?.avatarColor || '#ec4899' }}
                      >
                        {remotePeer?.initials || 'P'}
                      </div>
                      <p className="call-page__remote-name">{remotePeer?.name || 'Peer'}</p>
                      <div className="call-page__connecting-pulse">
                        <Radio size={16} className="call-page__spin" />
                        <span>Negotiating P2P Media Stream...</span>
                      </div>
                    </div>
                  ) : roomState.status === 'ringing' ? (
                    <div className="call-page__waiting-indicator">
                      <Radio size={40} className="call-page__spin-icon text-primary" />
                      <p className="call-page__waiting-text">
                        Ringing {roomState.invitee?.name || 'contact'}...
                      </p>
                      <p className="call-page__waiting-sub">
                        Waiting for the recipient to answer the incoming call invitation.
                      </p>
                      <button
                        type="button"
                        className="call-page__btn call-page__btn--danger call-page__btn--sm"
                        style={{ marginTop: '1rem' }}
                        onClick={handleCancelCall}
                        id="call-cancel-ringing-btn"
                      >
                        <PhoneOff size={14} />
                        <span>Cancel Call</span>
                      </button>
                    </div>
                  ) : roomState.status === 'declined' ? (
                    <div className="call-page__waiting-indicator">
                      <PhoneOff size={40} className="text-danger" />
                      <p className="call-page__waiting-text">Call Declined</p>
                      <p className="call-page__waiting-sub">
                        {roomState.invitee?.name || 'The recipient'} declined the call invitation.
                      </p>
                      <button
                        type="button"
                        className="call-page__btn call-page__btn--outline call-page__btn--sm"
                        style={{ marginTop: '1rem' }}
                        onClick={handleEndCall}
                        id="call-declined-back-btn"
                      >
                        Back to Contacts
                      </button>
                    </div>
                  ) : roomState.status === 'no-answer' ? (
                    <div className="call-page__waiting-indicator">
                      <Clock size={40} className="text-warning" />
                      <p className="call-page__waiting-text">No Answer</p>
                      <p className="call-page__waiting-sub">
                        The call timed out with no answer. You can share the link directly or try calling again.
                      </p>
                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                        <button
                          type="button"
                          className="call-page__btn call-page__btn--outline call-page__btn--sm"
                          onClick={handleCopyLink}
                          id="call-timeout-copy-btn"
                        >
                          <Copy size={14} />
                          <span>Copy Link</span>
                        </button>
                        <button
                          type="button"
                          className="call-page__btn call-page__btn--primary call-page__btn--sm"
                          onClick={handleEndCall}
                          id="call-timeout-back-btn"
                        >
                          Back to Contacts
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="call-page__waiting-indicator">
                      <Clock size={36} className="call-page__spin-icon" />
                      <p className="call-page__waiting-text">Waiting for participant to enter...</p>
                      <p className="call-page__waiting-sub">
                        Share the room invite link with your contact to begin.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Remote Peer Overlay Tag */}
              {hasRemotePeer && (
                <div className="call-page__peer-tag glass">
                  <span>{remotePeer?.name || 'Remote Peer'}</span>
                </div>
              )}

              {/* Floating Local Picture-in-Picture Preview */}
              <div className="call-page__local-wrapper glass">
                {localStream && !isVideoOff && !isAudioOnly ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="call-page__local-video"
                    id="local-video-preview"
                  />
                ) : (
                  <div className="call-page__local-placeholder">
                    <div
                      className="call-page__local-avatar"
                      style={{ background: currentUser.avatarColor || '#6366f1' }}
                    >
                      {currentUser.initials || 'U'}
                    </div>
                    <span className="call-page__local-status">
                      {isAudioOnly ? 'Audio Only' : isVideoOff ? 'Camera Off' : 'No Video'}
                    </span>
                  </div>
                )}
                <div className="call-page__local-tag">
                  <span>You {isMuted ? '(Muted)' : ''}</span>
                </div>
              </div>
            </div>

            {/* ── Floating In-Call Media Dock ──────────────────────────────── */}
            <div className="call-page__controls-dock glass" role="toolbar" aria-label="Call Controls">
              {/* Mute Microphone */}
              <button
                type="button"
                className={`call-page__ctrl-btn ${isMuted ? 'call-page__ctrl-btn--muted' : ''}`}
                onClick={toggleMute}
                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                aria-label={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                id="call-toggle-mic-btn"
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                <span className="call-page__ctrl-label">{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>

              {/* Toggle Video Camera */}
              <button
                type="button"
                className={`call-page__ctrl-btn ${isVideoOff ? 'call-page__ctrl-btn--video-off' : ''}`}
                onClick={toggleVideo}
                disabled={isAudioOnly}
                title={isAudioOnly ? 'Camera unavailable' : isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                aria-label={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                id="call-toggle-cam-btn"
              >
                {isVideoOff || isAudioOnly ? <VideoOff size={20} /> : <Video size={20} />}
                <span className="call-page__ctrl-label">{isVideoOff ? 'Start Video' : 'Stop Video'}</span>
              </button>

              {/* End / Leave Call */}
              <button
                type="button"
                className="call-page__ctrl-btn call-page__ctrl-btn--end"
                onClick={handleEndCall}
                title={roomState.isCreator ? 'End Call and Close Room' : 'Leave Call'}
                aria-label={roomState.isCreator ? 'End Call' : 'Leave Call'}
                id="call-dock-end-btn"
              >
                <PhoneOff size={20} />
                <span className="call-page__ctrl-label">{roomState.isCreator ? 'End Call' : 'Leave'}</span>
              </button>
            </div>
          </div>

          {/* Participant Info Strip */}
          <div className="call-page__footer-bar glass">
            <div className="call-page__participants-count">
              <Users size={16} />
              <span>Participants: {roomState.participants?.length || 1} / 2</span>
            </div>
            <div className="call-page__security-notice">
              <Shield size={14} />
              <span>P2P WebRTC Direct Connection • Server-Authoritative ACL</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Contacts Selector & Room Launcher View ──────────────────────────
  return (
    <div className="call-page animate-fade-in" role="main">
      <div className="call-page__container">
        {/* Page Header */}
        <div className="call-page__header">
          <div className="call-page__title-wrap">
            <div className="call-page__icon-box">
              <Video size={24} />
            </div>
            <div>
              <h1 className="call-page__title">Video Call Center</h1>
              <p className="call-page__subtitle">
                Select a registered contact to initiate a secure 1-on-1 call, or join an active room via link.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="call-page__btn call-page__btn--ghost"
            onClick={navigateToHome}
            aria-label="Back to videos"
          >
            <ArrowLeft size={16} />
            <span>Back to Home</span>
          </button>
        </div>

        {/* Global Room / Gateway Error Banner */}
        {roomError && (
          <div className="call-page__error-banner animate-fade-in" role="alert">
            <AlertCircle size={18} className="call-page__error-icon" />
            <div className="call-page__error-content">
              <strong>Call Notification:</strong> {roomError}
            </div>
            <button
              type="button"
              className="call-page__error-dismiss"
              onClick={() => setRoomError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <div className="call-page__grid">
          {/* Column 1: Contacts Directory */}
          <section className="call-page__card glass" aria-labelledby="contacts-heading">
            <div className="call-page__card-header">
              <div className="call-page__card-title-group">
                <Users size={18} />
                <h2 id="contacts-heading" className="call-page__card-title">Registered Contacts</h2>
              </div>
              <button
                type="button"
                className="call-page__refresh-btn"
                onClick={fetchContacts}
                disabled={contactsLoading}
                title="Refresh contacts"
                aria-label="Refresh contacts"
              >
                <RefreshCw size={14} className={contactsLoading ? 'call-page__spin' : ''} />
              </button>
            </div>

            {/* Contacts Body */}
            {contactsLoading ? (
              <div className="call-page__state-box">
                <RefreshCw size={24} className="call-page__spin call-page__accent-color" />
                <p>Loading registered contacts...</p>
              </div>
            ) : contactsError ? (
              <div className="call-page__state-box call-page__state-box--error">
                <AlertCircle size={24} />
                <p>{contactsError}</p>
                <button
                  type="button"
                  className="call-page__btn call-page__btn--outline"
                  onClick={fetchContacts}
                >
                  Retry
                </button>
              </div>
            ) : contacts.length === 0 ? (
              <div className="call-page__state-box">
                <User size={32} className="text-muted" />
                <p>No other registered users found.</p>
                <span className="text-muted text-sm">When new users register, they will appear here.</span>
              </div>
            ) : (
              <ul className="call-page__contacts-list" role="listbox" aria-label="Select contact to call">
                {contacts.map((contact) => {
                  const isSelected = selectedInvitee?.id === contact.id;
                  return (
                    <li
                      key={contact.id}
                      className={`call-page__contact-item ${isSelected ? 'call-page__contact-item--selected' : ''}`}
                      onClick={() => setSelectedInvitee(contact)}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedInvitee(contact);
                        }
                      }}
                    >
                      <div
                        className="call-page__contact-avatar"
                        style={{ background: contact.avatarColor || '#6366f1' }}
                      >
                        {contact.initials || contact.name?.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="call-page__contact-meta">
                        <span className="call-page__contact-name truncate">{contact.name}</span>
                        <span className="call-page__contact-email truncate">{contact.email}</span>
                      </div>
                      {isSelected && (
                        <div className="call-page__selected-badge">
                          <Check size={14} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Column 2: Call Initiator & Room Status */}
          <section className="call-page__card glass" aria-labelledby="start-call-heading">
            <div className="call-page__card-header">
              <div className="call-page__card-title-group">
                <Phone size={18} />
                <h2 id="start-call-heading" className="call-page__card-title">Initiate Video Call</h2>
              </div>
              <div className="call-page__status-indicator">
                <span className={`call-page__dot ${socketConnected ? 'call-page__dot--online' : 'call-page__dot--offline'}`} />
                <span>{socketConnected ? 'Signaling Gateway Ready' : 'Connecting to Gateway...'}</span>
              </div>
            </div>

            <div className="call-page__start-body">
              {selectedInvitee ? (
                <div className="call-page__target-preview glass animate-fade-in">
                  <span className="call-page__target-label">Selected Recipient:</span>
                  <div className="call-page__target-row">
                    <div
                      className="call-page__contact-avatar"
                      style={{ background: selectedInvitee.avatarColor || '#6366f1' }}
                    >
                      {selectedInvitee.initials}
                    </div>
                    <div className="call-page__target-meta">
                      <p className="call-page__target-name">{selectedInvitee.name}</p>
                      <p className="call-page__target-email">{selectedInvitee.email}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="call-page__prompt-box">
                  <Share2 size={28} className="text-muted" />
                  <p>Select a contact from the directory on the left to start a call.</p>
                </div>
              )}

              <button
                type="button"
                className="call-page__btn call-page__btn--start"
                disabled={!selectedInvitee || isCreatingRoom || !socketConnected}
                onClick={handleStartCall}
                id="call-start-call-btn"
              >
                {isCreatingRoom ? (
                  <>
                    <RefreshCw size={18} className="call-page__spin" />
                    <span>Allocating Secure Room...</span>
                  </>
                ) : (
                  <>
                    <Phone size={18} />
                    <span>Start Call with {selectedInvitee ? selectedInvitee.name : 'Recipient'}</span>
                  </>
                )}
              </button>

              {/* Direct Room Join Option */}
              <div className="call-page__join-direct">
                <span className="call-page__divider-text">OR JOIN BY ROOM LINK / ID</span>
                <div className="call-page__input-row">
                  <input
                    type="text"
                    className="call-page__room-input"
                    placeholder="e.g. call-xyz123abc456"
                    value={activeRoomId || ''}
                    onChange={(e) => setActiveRoomId(e.target.value.trim())}
                    aria-label="Enter Call Room ID"
                    id="call-room-id-input"
                  />
                  <button
                    type="button"
                    className="call-page__btn call-page__btn--primary"
                    disabled={!activeRoomId || isJoiningRoom || !socketConnected}
                    onClick={() => joinRoom(activeRoomId)}
                    id="call-join-room-btn"
                  >
                    {isJoiningRoom ? <RefreshCw size={16} className="call-page__spin" /> : 'Join Room'}
                  </button>
                </div>
              </div>

              {/* Security info note */}
              <div className="call-page__sec-footer">
                <Shield size={14} />
                <span>All rooms enforce cryptographic random identifiers, 1-to-1 participant bounds, and MongoDB-backed ACLs.</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
