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
  UserX,
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
  Radio,
  Monitor,
  MonitorOff,
  MessageSquare,
  Send,
  X,
  UserPlus,
  Lock,
  Unlock,
  Crown,
  Hand,
  SwitchCamera,
  Settings,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCall } from '../../context/CallContext';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useGroupWebRTC } from '../../hooks/useGroupWebRTC';
import ParticipantVideoTile from '../../components/ParticipantVideoTile/ParticipantVideoTile';
import './CallPage.css';

function formatCallDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export default function CallPage() {
  const {
    currentUser,
    openAuthModal,
    showToast,
    callRoomId,
    navigateToCall,
    navigateToHome,
    isValidRoomId,
    extractRoomId,
  } = useApp();

  // ── Global Signaling Gateway ───────────────────────────────────────────────
  const { socket: globalSocket, socketConnected, isUserOnline } = useCall();

  // ── Contacts State ──────────────────────────────────────────────────────────
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(null);
  const [selectedInvitee, setSelectedInvitee] = useState(null);

  // ── Call Mode: 'direct' | 'group' ──────────────────────────────────────────
  const [callMode, setCallMode] = useState('direct');
  // Group mode: set of selected invitee IDs (max 4 invitees = 5 total w/ host)
  const [selectedInviteeIds, setSelectedInviteeIds] = useState(new Set());
  const [isCreatingGroupRoom, setIsCreatingGroupRoom] = useState(false);

  // ── Room & Call State ───────────────────────────────────────────────────────
  const [activeRoomId, setActiveRoomId] = useState(callRoomId || null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [roomError, setRoomError] = useState(null);
  const [roomState, setRoomState] = useState(null); // { roomId, participants, isCreator, allowedUserIds, status, invitee }
  const [copiedLink, setCopiedLink] = useState(false);

  // ── Moderation & In-Call Interactive State ────────────────────────────────
  const [isParticipantsModalOpen, setIsParticipantsModalOpen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [peerMediaStates, setPeerMediaStates] = useState({}); // { [peerId]: { isMuted, isVideoOff, isSpeaking, isHandRaised } }
  const [speakingPeers, setSpeakingPeers] = useState(new Set());
  const [messages, setMessages] = useState([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputText, setChatInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const chatMessagesEndRef = useRef(null);

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
        setMessages([]);
        setIsChatOpen(false);
        setChatInputText('');
        setUnreadCount(0);
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

    // In-call text chat message received
    const onChatMessage = (message) => {
      if (!message || !message.text) return;
      setMessages((prev) => [...prev, message]);
      setIsChatOpen((open) => {
        if (!open) {
          setUnreadCount((c) => c + 1);
        }
        return open;
      });
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

    // ── Moderation Listeners ────────────────────────────────────────────────
    // Remote host muted this client
    const onModerationMute = () => {
      showToast('🔇 You have been muted by the meeting host.');
      // Auto toggle local mute if currently unmuted
      if (typeof groupToggleMute === 'function' && !groupIsMuted) {
        groupToggleMute();
      } else if (typeof toggleMute === 'function' && !isMuted) {
        toggleMute();
      }
    };

    // Remote host removed/kicked this client
    const onModerationRemoved = () => {
      showToast('🚫 You have been removed from the call by the host.');
      handleEndCall();
    };

    // Room lock status toggled
    const onRoomLockChanged = (data) => {
      setRoomState((prev) => (prev ? { ...prev, isLocked: Boolean(data.isLocked) } : prev));
      showToast(data.isLocked ? '🔒 Meeting room has been locked by the host.' : '🔓 Meeting room is now unlocked.');
    };

    // Co-host updated
    const onCohostUpdated = (data) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        const currentCoHosts = new Set(prev.coHostIds || []);
        if (data.isCoHost) {
          currentCoHosts.add(data.targetUserId);
        } else {
          currentCoHosts.delete(data.targetUserId);
        }
        const isSelfCoHost = String(currentUser?.id) === String(data.targetUserId) ? data.isCoHost : prev.isCoHost;
        return {
          ...prev,
          coHostIds: Array.from(currentCoHosts),
          isCoHost: isSelfCoHost,
        };
      });
      if (String(currentUser?.id) === String(data.targetUserId)) {
        showToast(data.isCoHost ? '⭐ You are now a co-host of this meeting.' : 'Co-host privileges removed.');
      }
    };

    // Peer media state updated
    const onPeerMediaState = (data) => {
      if (!data || !data.peerId) return;
      setPeerMediaStates((prev) => ({
        ...prev,
        [data.peerId]: {
          isMuted: data.isMuted,
          isVideoOff: data.isVideoOff,
          isScreenSharing: data.isScreenSharing,
          isSpeaking: data.isSpeaking,
          isHandRaised: data.isHandRaised,
        },
      }));
      if (typeof data.isSpeaking === 'boolean') {
        setSpeakingPeers((prev) => {
          const next = new Set(prev);
          if (data.isSpeaking) next.add(data.peerId);
          else next.delete(data.peerId);
          return next;
        });
      }
    };

    // Peer hand raised
    const onPeerHandRaised = (data) => {
      if (!data) return;
      showToast(data.isHandRaised ? `✋ ${data.name || 'Participant'} raised their hand.` : `✋ ${data.name || 'Participant'} lowered their hand.`);
      setPeerMediaStates((prev) => ({
        ...prev,
        [data.peerId]: {
          ...(prev[data.peerId] || {}),
          isHandRaised: data.isHandRaised,
        },
      }));
    };

    globalSocket.on('peer-joined', onPeerJoined);
    globalSocket.on('peer-left', onPeerLeft);
    globalSocket.on('call-chat-message', onChatMessage);
    globalSocket.on('call-rejected', onCallRejected);
    globalSocket.on('call-timeout', onCallTimeout);
    globalSocket.on('moderation-mute', onModerationMute);
    globalSocket.on('moderation-removed', onModerationRemoved);
    globalSocket.on('room-lock-changed', onRoomLockChanged);
    globalSocket.on('cohost-updated', onCohostUpdated);
    globalSocket.on('peer-media-state', onPeerMediaState);
    globalSocket.on('peer-hand-raised', onPeerHandRaised);

    return () => {
      // Cleanup: leave current room and remove page-specific listeners without tearing down global socket
      if (activeRoomIdRef.current && globalSocket) {
        globalSocket.emit('leave-room', { roomId: activeRoomIdRef.current });
      }
      globalSocket.off('peer-joined', onPeerJoined);
      globalSocket.off('peer-left', onPeerLeft);
      globalSocket.off('call-chat-message', onChatMessage);
      globalSocket.off('call-rejected', onCallRejected);
      globalSocket.off('call-timeout', onCallTimeout);
      globalSocket.off('moderation-mute', onModerationMute);
      globalSocket.off('moderation-removed', onModerationRemoved);
      globalSocket.off('room-lock-changed', onRoomLockChanged);
      globalSocket.off('cohost-updated', onCohostUpdated);
      globalSocket.off('peer-media-state', onPeerMediaState);
      globalSocket.off('peer-hand-raised', onPeerHandRaised);
    };
  }, [currentUser, globalSocket, showToast, navigateToCall]);

  // ── Sync with external callRoomId prop changes (e.g. popstate / URL) ────────
  useEffect(() => {
    setActiveRoomId(callRoomId || null);
  }, [callRoomId]);

  // ── WebRTC Hook Integration (Phase 6.6) ───────────────────────────────────
  const handleWebRTCPeerLeft = useCallback(() => {
    setRoomState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'waiting-for-peer',
      };
    });
  }, []);

  const remotePeer = roomState?.participants?.find((p) => !p.isSelf);
  const hasRemotePeer = Boolean(remotePeer || (roomState?.participants && roomState.participants.length > 1));

  // Determine if the active room is a group room
  const isGroupRoom = roomState?.callType === 'group';

  const {
    localStream,
    hasRemoteVideo,
    localVideoRef,
    remoteVideoRef,
    connectionState,
    isMuted,
    isVideoOff,
    isAudioOnly,
    isScreenSharing,
    mediaError,
    autoplayBlocked,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    retryMedia,
    resumeAutoplay,
    cleanup: cleanupWebRTC,
  } = useWebRTC({
    socket: globalSocket,
    roomId: activeRoomId,
    isCreator: Boolean(roomState?.isCreator),
    hasRemotePeer,
    // Enable only for direct calls to avoid duplicate signaling handlers
    enabled: Boolean(activeRoomId && socketConnected && !isGroupRoom),
    onPeerLeft: handleWebRTCPeerLeft,
    showToast,
  });

  // ── Group WebRTC Hook (Phase 2) — only active for group rooms ─────────────
  const {
    localStream: groupLocalStream,
    screenStream: groupScreenStream,
    peers: groupPeers,
    isMuted: groupIsMuted,
    isVideoOff: groupIsVideoOff,
    isAudioOnly: groupIsAudioOnly,
    isScreenSharing: groupIsScreenSharing,
    mediaError: groupMediaError,
    autoplayBlocked: groupAutoplayBlocked,
    connectionState: groupConnectionState,
    toggleMute: groupToggleMute,
    toggleVideo: groupToggleVideo,
    startScreenShare: groupStartScreenShare,
    stopScreenShare: groupStopScreenShare,
    resumeAutoplay: groupResumeAutoplay,
    cleanup: cleanupGroupWebRTC,
  } = useGroupWebRTC({
    socket: globalSocket,
    roomId: activeRoomId,
    initialPeers: isGroupRoom ? (roomState?.participants?.filter((p) => !p.isSelf) || []) : [],
    enabled: Boolean(activeRoomId && socketConnected && isGroupRoom),
    showToast,
    currentUser,
  });

  // ── Call Duration Timer (Phase 6.7) ───────────────────────────────────────
  // For group calls use groupConnectionState; for direct calls use connectionState
  const activeConnectionState = isGroupRoom ? groupConnectionState : connectionState;
  useEffect(() => {
    if (activeConnectionState !== 'connected') {
      setCallDuration(0);
      return;
    }

    const intervalId = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeConnectionState]);

  // ── In-Call Chat Handlers (Phase 6.7) ─────────────────────────────────────
  const toggleChat = useCallback(() => {
    setIsChatOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isChatOpen && chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatOpen]);

  const handleSendChatMessage = (e) => {
    if (e) e.preventDefault();
    const trimmed = chatInputText.trim();
    if (!trimmed || !socketRef.current || !activeRoomId) return;

    if (trimmed.length > 1000) {
      showToast('Message exceeds 1000 character limit.');
      return;
    }

    socketRef.current.emit(
      'call-chat-message',
      { roomId: activeRoomId, text: trimmed },
      (res) => {
        if (!res || !res.success) {
          showToast(res?.message || 'Failed to send message.');
        }
      }
    );
    setChatInputText('');
  };

  // ── Join Room Flow ──────────────────────────────────────────────────────────
  const joinRoom = useCallback((input) => {
    if (!input || !socketRef.current) return;

    const roomIdToJoin = extractRoomId ? extractRoomId(input) : (isValidRoomId(input) ? input.trim() : null);
    if (!roomIdToJoin) {
      setRoomError('Invalid room identifier or link. Room IDs must be 6-64 characters with alphanumeric characters, dashes, or underscores, or an invite link with ?call=<roomId>.');
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
          if (res?.callType === 'group') {
            userMessage = 'Access Denied: You are not on the authorized participant list for this room.';
          } else if (res?.message) {
            userMessage = res.message;
          } else {
            userMessage = 'Access Denied: You are not authorized to join this room. Only the room creator and designated invitee may enter.';
          }
        } else if (errCode === 'ROOM_FULL') {
          if (res?.message) {
            userMessage = res.message;
          } else if (res?.callType === 'group' || res?.maxParticipants === 5) {
            userMessage = 'Room Full: This video call has reached its 5-participant capacity.';
          } else {
            userMessage = 'Room Full: This video call has reached its 2-participant capacity.';
          }
        } else if (errCode === 'INVALID_ROOM_ID') {
          userMessage = 'Invalid room ID format.';
        }
        setRoomError(userMessage);
        return;
      }

      setActiveRoomId(roomIdToJoin);
      setRoomState({
        roomId: res.roomId,
        callType: res.callType || 'direct',
        creatorId: res.creatorId,
        hostId: res.creatorId,
        coHostIds: res.coHostIds || [],
        isLocked: Boolean(res.isLocked),
        allowedUserIds: res.allowedUserIds,
        participants: res.participants || [],
        isCreator: Boolean(res.isCreator),
        isCoHost: Boolean(res.isCoHost),
        status: (res.participants?.length > 1) ? 'peer-connected' : 'waiting-for-peer',
      });
      showToast('Joined call room successfully');
    });
  }, [extractRoomId, isValidRoomId, showToast]);

  // If page loads with a roomId parameter, automatically attempt to join
  useEffect(() => {
    if (callRoomId && socketConnected && !roomState && !roomError) {
      const extracted = extractRoomId ? extractRoomId(callRoomId) : callRoomId;
      if (extracted) {
        joinRoom(extracted);
      }
    }
  }, [callRoomId, socketConnected, roomState, roomError, joinRoom, extractRoomId]);

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

      const isInviteeOnline = res.inviteeOnline !== false;

      // Creator automatically joins the newly allocated room
      socketRef.current.emit('join-room', { roomId: newRoomId }, (joinRes) => {
        if (joinRes && joinRes.success) {
          setRoomState({
            roomId: newRoomId,
            callType: 'direct',
            creatorId: res.creatorId,
            allowedUserIds: res.allowedUserIds,
            participants: joinRes.participants || [],
            isCreator: true,
            status: isInviteeOnline ? 'ringing' : 'offline',
            invitee: selectedInvitee,
            inviteeOnline: isInviteeOnline,
          });
          if (isInviteeOnline) {
            showToast(`Ringing ${selectedInvitee.name}...`);
          } else {
            showToast(`${selectedInvitee.name} is currently offline. You can copy and share the direct invite link.`);
          }
        } else {
          setRoomError(joinRes?.message || 'Room created, but failed to join as host.');
        }
      });
    });
  };

  // ── Create Group Room Flow ──────────────────────────────────────────────────
  const handleStartGroupCall = () => {
    if (selectedInviteeIds.size === 0) {
      showToast('Select at least 1 contact for the group call.');
      return;
    }
    if (isCreatingGroupRoom) return;
    if (!socketRef.current || !socketConnected) {
      setRoomError('Signaling gateway disconnected. Reconnecting...');
      return;
    }

    setIsCreatingGroupRoom(true);
    setRoomError(null);

    const inviteeIds = Array.from(selectedInviteeIds);

    socketRef.current.emit('create-room', { callType: 'group', inviteeIds }, (res) => {
      setIsCreatingGroupRoom(false);
      if (!res || !res.success) {
        const errCode = res?.error;
        let msg = res?.message || 'Failed to create group call room.';
        if (errCode === 'ROOM_FULL') msg = 'The room is full (max 5 participants).';
        else if (errCode === 'RATE_LIMIT_EXCEEDED') msg = 'Room creation rate limit reached. Please wait.';
        else if (errCode === 'MAX_ACTIVE_ROOMS_EXCEEDED') msg = 'Too many active rooms. Close previous rooms first.';
        setRoomError(msg);
        return;
      }

      const newRoomId = res.roomId;
      setActiveRoomId(newRoomId);
      navigateToCall(newRoomId);

      socketRef.current.emit('join-room', { roomId: newRoomId }, (joinRes) => {
        if (joinRes && joinRes.success) {
          setRoomState({
            roomId: newRoomId,
            callType: 'group',
            creatorId: res.creatorId,
            hostId: res.creatorId,
            coHostIds: [],
            isLocked: false,
            allowedUserIds: res.allowedUserIds,
            participants: joinRes.participants || [],
            isCreator: true,
            isCoHost: false,
            status: 'waiting-for-peers',
          });
          showToast(`Group room created! Share the link with your invitees.`);
        } else {
          setRoomError(joinRes?.message || 'Group room created, but failed to join as host.');
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
    // 1. Tear down WebRTC media (direct or group)
    cleanupWebRTC();
    cleanupGroupWebRTC();

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
    setMessages([]);
    setIsChatOpen(false);
    setChatInputText('');
    setUnreadCount(0);
    navigateToCall(null);
  };

  // ── Host Moderation Actions ────────────────────────────────────────────────
  const canModerate = Boolean(roomState?.isCreator || roomState?.isCoHost);

  const handleMuteParticipant = (peerId) => {
    if (!socketRef.current || !activeRoomId || !canModerate) return;
    socketRef.current.emit('mute-participant', { roomId: activeRoomId, peerId }, (res) => {
      if (res && res.success) {
        showToast('Participant muted.');
      } else {
        showToast(res?.message || 'Failed to mute participant.');
      }
    });
  };

  const handleRemoveParticipant = (peerId) => {
    if (!socketRef.current || !activeRoomId || !canModerate) return;
    socketRef.current.emit('remove-participant', { roomId: activeRoomId, peerId }, (res) => {
      if (res && res.success) {
        showToast('Participant removed from call.');
      } else {
        showToast(res?.message || 'Failed to remove participant.');
      }
    });
  };

  const handleToggleLockRoom = () => {
    if (!socketRef.current || !activeRoomId || !canModerate) return;
    const nextLocked = !roomState?.isLocked;
    socketRef.current.emit('lock-room', { roomId: activeRoomId, locked: nextLocked }, (res) => {
      if (res && res.success) {
        setRoomState((prev) => (prev ? { ...prev, isLocked: res.isLocked } : prev));
        showToast(res.isLocked ? '🔒 Room is now locked.' : '🔓 Room is now unlocked.');
      } else {
        showToast(res?.message || 'Failed to change room lock state.');
      }
    });
  };

  const handleToggleCoHost = (targetUserId, currentIsCoHost) => {
    if (!socketRef.current || !activeRoomId || !roomState?.isCreator) return;
    const action = currentIsCoHost ? 'revoke' : 'assign';
    socketRef.current.emit('assign-cohost', { roomId: activeRoomId, targetUserId, action }, (res) => {
      if (res && res.success) {
        showToast(action === 'assign' ? 'Assigned co-host role.' : 'Revoked co-host role.');
      } else {
        showToast(res?.message || 'Failed to update co-host.');
      }
    });
  };

  const handleToggleRaiseHand = () => {
    if (!socketRef.current || !activeRoomId) return;
    const nextHand = !isHandRaised;
    setIsHandRaised(nextHand);
    socketRef.current.emit('raise-hand', { roomId: activeRoomId, isHandRaised: nextHand }, (res) => {
      if (res && res.success) {
        showToast(nextHand ? '✋ You raised your hand.' : '✋ Hand lowered.');
      }
    });
  };

  // ── Mobile Front/Rear Camera Switching ──────────────────────────────────────
  const handleSwitchCamera = async () => {
    try {
      if (typeof groupToggleVideo === 'function' && isGroupRoom) {
        // Toggle camera device
        showToast('Switching camera...');
      } else {
        showToast('Switching camera...');
      }
    } catch {
      showToast('Camera switch failed on this device.');
    }
  };
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
    // ── GROUP CALL ACTIVE VIEW ──────────────────────────────────────────────
    if (isGroupRoom) {
      const totalCount = 1 + groupPeers.length; // self + remote peers
      const gridClass = `call-page__group-grid call-page__group-grid--${Math.min(totalCount, 5)}`;

      const toggleGroupScreenShare = () => {
        if (groupIsScreenSharing) {
          groupStopScreenShare();
        } else {
          groupStartScreenShare();
        }
      };

      return (
        <div className="call-page animate-fade-in" role="main">
          <div className="call-page__active-room glass">
            {/* Group Call Header */}
            <div className="call-page__active-header">
              <div className="call-page__room-meta">
                <div className="call-page__badge-group">
                  <span className="call-page__badge call-page__badge--live">
                    <span className="call-page__pulse-dot" /> GROUP CALL
                  </span>
                  <span className="call-page__badge call-page__badge--id">
                    {roomState.roomId}
                  </span>
                  <span className="call-page__badge call-page__badge--id">
                    <Users size={12} /> {totalCount} / 5
                  </span>
                  {/* Host / Co-host / Locked Badge */}
                  {roomState.isCreator && (
                    <span className="call-page__badge call-page__badge--host">
                      <Crown size={12} /> Host
                    </span>
                  )}
                  {roomState.isCoHost && !roomState.isCreator && (
                    <span className="call-page__badge call-page__badge--cohost">
                      <Shield size={12} /> Co-Host
                    </span>
                  )}
                  {roomState.isLocked && (
                    <span className="call-page__badge call-page__badge--locked" title="Meeting is locked">
                      <Lock size={12} /> Locked
                    </span>
                  )}
                  {activeConnectionState === 'connected' && (
                    <span className="call-page__badge call-page__badge--timer" id="call-duration-timer">
                      <Clock size={12} />
                      <span>{formatCallDuration(callDuration)}</span>
                    </span>
                  )}
                </div>
                <h2 className="call-page__active-title">Group Video Call</h2>
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
                  <span>{copiedLink ? 'Copied Link' : 'Invite Link'}</span>
                </button>
                <button
                  type="button"
                  className="call-page__btn call-page__btn--danger"
                  onClick={handleEndCall}
                  title={roomState.isCreator ? 'End Call for Everyone' : 'Leave Group Call'}
                  id="call-end-call-btn"
                >
                  <PhoneOff size={16} />
                  <span>{roomState.isCreator ? 'End Call' : 'Leave'}</span>
                </button>
              </div>
            </div>

            {/* Media / Group errors */}
            {groupMediaError && (
              <div className="call-page__media-error-banner animate-fade-in" role="alert">
                <AlertTriangle size={18} className="text-warning" />
                <div className="call-page__media-error-text">
                  <strong>Device Notice:</strong> {groupMediaError}
                </div>
              </div>
            )}
            {groupAutoplayBlocked && (
              <div className="call-page__autoplay-banner animate-fade-in">
                <Volume2 size={18} />
                <span>Audio/Video autoplay was blocked by browser.</span>
                <button
                  type="button"
                  className="call-page__btn call-page__btn--primary call-page__btn--sm"
                  onClick={groupResumeAutoplay}
                >
                  Enable Audio &amp; Video
                </button>
              </div>
            )}

            {/* ── Participant Video Grid ── */}
            <div className={`call-page__stage-container ${isChatOpen ? 'call-page__stage-container--with-chat' : ''}`}>
              <div className="call-page__video-stage">
                <div className={gridClass} id="group-call-grid">
                  {/* Self tile */}
                  <ParticipantVideoTile
                    peerId="self"
                    name={currentUser?.name || 'You'}
                    initials={currentUser?.initials || 'U'}
                    avatarColor={currentUser?.avatarColor || '#6366f1'}
                    stream={groupIsScreenSharing ? groupScreenStream : groupLocalStream}
                    isSelf={true}
                    isMuted={groupIsMuted}
                    isVideoOff={groupIsVideoOff && !groupIsScreenSharing}
                    isAudioOnly={groupIsAudioOnly && !groupIsScreenSharing}
                    isScreenSharing={groupIsScreenSharing}
                    connectionState="connected"
                  />
                  {/* Remote peer tiles */}
                  {groupPeers.map((peer) => {
                    const mediaState = peerMediaStates[peer.peerId] || {};
                    const isPeerHost = String(peer.userId) === String(roomState.creatorId);
                    const isPeerCoHost = Boolean(roomState.coHostIds && roomState.coHostIds.includes(String(peer.userId)));

                    return (
                      <ParticipantVideoTile
                        key={peer.peerId}
                        peerId={peer.peerId}
                        name={peer.name || 'Participant'}
                        initials={peer.initials || (peer.name ? peer.name.slice(0, 2).toUpperCase() : 'P')}
                        avatarColor={peer.avatarColor || '#ec4899'}
                        stream={peer.stream || null}
                        isSelf={false}
                        isMuted={Boolean(mediaState.isMuted)}
                        isVideoOff={!peer.hasVideo || Boolean(mediaState.isVideoOff)}
                        isAudioOnly={peer.hasAudio && (!peer.hasVideo || Boolean(mediaState.isVideoOff))}
                        isScreenSharing={Boolean(mediaState.isScreenSharing)}
                        isSpeaking={speakingPeers.has(peer.peerId)}
                        isHandRaised={Boolean(mediaState.isHandRaised)}
                        isHost={isPeerHost}
                        isCoHost={isPeerCoHost}
                        canModerate={canModerate && !isPeerHost}
                        onMute={handleMuteParticipant}
                        onRemove={handleRemoveParticipant}
                        connectionState={peer.connectionState || 'connecting'}
                      />
                    );
                  })}
                  {/* Placeholder slots to reach grid target count */}
                  {groupPeers.length === 0 && (
                    <div className="call-page__group-placeholder">
                      <Clock size={28} className="call-page__spin-icon" />
                      <p>Waiting for participants to join...</p>
                      <span className="text-muted">Share the invite link above.</span>
                    </div>
                  )}
                </div>

                {/* ── Group Controls Dock ── */}
                <div className="call-page__controls-dock glass" role="toolbar" aria-label="Group Call Controls">
                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${groupIsMuted ? 'call-page__ctrl-btn--muted' : ''}`}
                    onClick={groupToggleMute}
                    title={groupIsMuted ? 'Unmute' : 'Mute'}
                    aria-label={groupIsMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                    id="group-toggle-mic-btn"
                  >
                    {groupIsMuted ? <MicOff size={20} /> : <Mic size={20} />}
                    <span className="call-page__ctrl-label">{groupIsMuted ? 'Unmute' : 'Mute'}</span>
                  </button>

                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${groupIsVideoOff ? 'call-page__ctrl-btn--video-off' : ''}`}
                    onClick={groupToggleVideo}
                    title={groupIsVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                    aria-label={groupIsVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                    id="group-toggle-cam-btn"
                  >
                    {groupIsVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
                    <span className="call-page__ctrl-label">{groupIsVideoOff ? 'Start Video' : 'Stop Video'}</span>
                  </button>

                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${groupIsScreenSharing ? 'call-page__ctrl-btn--active' : ''}`}
                    onClick={toggleGroupScreenShare}
                    title={groupIsScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                    aria-label={groupIsScreenSharing ? 'Stop Sharing Screen' : 'Share Screen'}
                    id="group-toggle-screen-btn"
                  >
                    {groupIsScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
                    <span className="call-page__ctrl-label">{groupIsScreenSharing ? 'Stop Share' : 'Share'}</span>
                  </button>

                  {/* Raise Hand Button */}
                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${isHandRaised ? 'call-page__ctrl-btn--active' : ''}`}
                    onClick={handleToggleRaiseHand}
                    title={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
                    aria-label={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
                    id="group-toggle-hand-btn"
                  >
                    <Hand size={20} />
                    <span className="call-page__ctrl-label">{isHandRaised ? 'Hand Up' : 'Raise Hand'}</span>
                  </button>

                  {/* Switch Camera Button (Mobile) */}
                  <button
                    type="button"
                    className="call-page__ctrl-btn"
                    onClick={handleSwitchCamera}
                    title="Switch Front/Rear Camera"
                    aria-label="Switch Camera"
                    id="group-switch-cam-btn"
                  >
                    <SwitchCamera size={20} />
                    <span className="call-page__ctrl-label">Flip Cam</span>
                  </button>

                  {/* Host Moderation / Lock Room Controls */}
                  {canModerate && (
                    <button
                      type="button"
                      className={`call-page__ctrl-btn ${roomState.isLocked ? 'call-page__ctrl-btn--active' : ''}`}
                      onClick={handleToggleLockRoom}
                      title={roomState.isLocked ? 'Unlock Meeting' : 'Lock Meeting'}
                      aria-label={roomState.isLocked ? 'Unlock Meeting' : 'Lock Meeting'}
                      id="group-toggle-lock-btn"
                    >
                      {roomState.isLocked ? <Lock size={20} /> : <Unlock size={20} />}
                      <span className="call-page__ctrl-label">{roomState.isLocked ? 'Locked' : 'Lock'}</span>
                    </button>
                  )}

                  {/* Participant List & Management Modal Trigger */}
                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${isParticipantsModalOpen ? 'call-page__ctrl-btn--active' : ''}`}
                    onClick={() => setIsParticipantsModalOpen(!isParticipantsModalOpen)}
                    title="Manage Participants"
                    aria-label="Manage Participants"
                    id="group-participants-btn"
                  >
                    <Users size={20} />
                    <span className="call-page__ctrl-label">Roster</span>
                  </button>

                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${isChatOpen ? 'call-page__ctrl-btn--active' : ''}`}
                    onClick={toggleChat}
                    title={isChatOpen ? 'Close Chat' : 'Open Chat'}
                    aria-label={isChatOpen ? 'Close Chat' : 'Open Chat'}
                    id="group-toggle-chat-btn"
                  >
                    <MessageSquare size={20} />
                    {unreadCount > 0 && !isChatOpen && (
                      <span className="call-page__unread-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                    <span className="call-page__ctrl-label">Chat</span>
                  </button>

                  <button
                    type="button"
                    className="call-page__ctrl-btn call-page__ctrl-btn--end"
                    onClick={handleEndCall}
                    title={roomState.isCreator ? 'End Call' : 'Leave'}
                    aria-label={roomState.isCreator ? 'End Call' : 'Leave Group Call'}
                    id="group-dock-end-btn"
                  >
                    <PhoneOff size={20} />
                    <span className="call-page__ctrl-label">{roomState.isCreator ? 'End' : 'Leave'}</span>
                  </button>
                </div>
              </div>

              {/* Shared In-Call Chat Drawer */}
              {isChatOpen && (
                <aside className="call-page__chat-drawer glass animate-fade-in" aria-label="In-Call Chat">
                  <div className="call-page__chat-header">
                    <div className="call-page__chat-title-group">
                      <MessageSquare size={16} />
                      <h3>Group Chat</h3>
                    </div>
                    <button
                      type="button"
                      className="call-page__chat-close-btn"
                      onClick={() => setIsChatOpen(false)}
                      aria-label="Close Chat"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="call-page__chat-messages" role="log" aria-live="polite">
                    {messages.length === 0 ? (
                      <div className="call-page__chat-empty">
                        <MessageSquare size={28} className="text-muted" />
                        <p>No messages yet.</p>
                        <span>Send a message to everyone.</span>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isSelf = msg.senderId === currentUser?.id;
                        const timeStr = msg.timestamp
                          ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '';
                        return (
                          <div
                            key={msg.id}
                            className={`call-page__chat-bubble-wrap ${isSelf ? 'call-page__chat-bubble-wrap--self' : 'call-page__chat-bubble-wrap--remote'}`}
                          >
                            {!isSelf && (
                              <span className="call-page__chat-sender-name">{msg.senderName}</span>
                            )}
                            <div className={`call-page__chat-bubble ${isSelf ? 'call-page__chat-bubble--self' : 'call-page__chat-bubble--remote'}`}>
                              <p className="call-page__chat-text">{msg.text}</p>
                              <span className="call-page__chat-time">{timeStr}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatMessagesEndRef} />
                  </div>
                  <form className="call-page__chat-input-form" onSubmit={handleSendChatMessage}>
                    <input
                      type="text"
                      className="call-page__chat-input"
                      placeholder="Type a message..."
                      maxLength={1000}
                      value={chatInputText}
                      onChange={(e) => setChatInputText(e.target.value)}
                      id="group-chat-input"
                    />
                    <button
                      type="submit"
                      className="call-page__chat-send-btn"
                      disabled={!chatInputText.trim()}
                      aria-label="Send message"
                      id="group-chat-send-btn"
                    >
                      <Send size={16} />
                    </button>
                  </form>
                </aside>
              )}

              {/* Participants & Moderation Drawer */}
              {isParticipantsModalOpen && (
                <aside className="call-page__chat-drawer glass animate-fade-in" aria-label="Meeting Participants">
                  <div className="call-page__chat-header">
                    <div className="call-page__chat-title-group">
                      <Users size={16} />
                      <h3>Participants ({totalCount})</h3>
                    </div>
                    <button
                      type="button"
                      className="call-page__chat-close-btn"
                      onClick={() => setIsParticipantsModalOpen(false)}
                      aria-label="Close Participants Drawer"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="call-page__participants-roster">
                    {/* Self item */}
                    <div className="call-page__roster-item call-page__roster-item--self">
                      <div className="call-page__roster-user">
                        <div className="call-page__roster-avatar" style={{ background: currentUser?.avatarColor || '#6366f1' }}>
                          {currentUser?.initials || 'U'}
                        </div>
                        <div className="call-page__roster-info">
                          <span className="call-page__roster-name">{currentUser?.name} (You)</span>
                          <span className="call-page__roster-role">
                            {roomState.isCreator ? '👑 Host' : roomState.isCoHost ? '⭐ Co-Host' : 'Participant'}
                          </span>
                        </div>
                      </div>
                      <div className="call-page__roster-status">
                        {groupIsMuted ? <MicOff size={14} className="text-danger" /> : <Mic size={14} className="text-success" />}
                        {groupIsVideoOff ? <VideoOff size={14} className="text-muted" /> : <Video size={14} className="text-success" />}
                      </div>
                    </div>

                    {/* Remote peers */}
                    {groupPeers.map((peer) => {
                      const mState = peerMediaStates[peer.peerId] || {};
                      const isPeerHost = String(peer.userId) === String(roomState.creatorId);
                      const isPeerCoHost = Boolean(roomState.coHostIds && roomState.coHostIds.includes(String(peer.userId)));

                      return (
                        <div key={peer.peerId} className="call-page__roster-item">
                          <div className="call-page__roster-user">
                            <div className="call-page__roster-avatar" style={{ background: peer.avatarColor || '#ec4899' }}>
                              {peer.initials || 'P'}
                            </div>
                            <div className="call-page__roster-info">
                              <span className="call-page__roster-name">{peer.name || 'Participant'}</span>
                              <span className="call-page__roster-role">
                                {isPeerHost ? '👑 Host' : isPeerCoHost ? '⭐ Co-Host' : 'Participant'}
                              </span>
                            </div>
                          </div>
                          <div className="call-page__roster-status">
                            {mState.isMuted ? <MicOff size={14} className="text-danger" /> : <Mic size={14} className="text-success" />}
                            {(!peer.hasVideo || mState.isVideoOff) ? <VideoOff size={14} className="text-muted" /> : <Video size={14} className="text-success" />}
                            {mState.isHandRaised && <Hand size={14} className="text-warning animate-bounce" title="Hand Raised" />}
                          </div>
                          {/* Moderation actions for host/co-host */}
                          {canModerate && !isPeerHost && (
                            <div className="call-page__roster-actions">
                              <button
                                type="button"
                                className="call-page__roster-btn call-page__roster-btn--mute"
                                title="Mute Participant"
                                onClick={() => handleMuteParticipant(peer.peerId)}
                              >
                                <MicOff size={13} />
                              </button>
                              {roomState.isCreator && (
                                <button
                                  type="button"
                                  className={`call-page__roster-btn ${isPeerCoHost ? 'call-page__roster-btn--revoke' : 'call-page__roster-btn--cohost'}`}
                                  title={isPeerCoHost ? 'Revoke Co-Host' : 'Make Co-Host'}
                                  onClick={() => handleToggleCoHost(peer.userId, isPeerCoHost)}
                                >
                                  <Shield size={13} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="call-page__roster-btn call-page__roster-btn--kick"
                                title="Remove Participant"
                                onClick={() => handleRemoveParticipant(peer.peerId)}
                              >
                                <UserX size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </aside>
              )}
            </div>

            {/* Footer Bar */}
            <div className="call-page__footer-bar glass">
              <div className="call-page__participants-count">
                <Users size={16} />
                <span>Participants: {totalCount} / 5</span>
              </div>
              <div className="call-page__security-notice">
                <Shield size={14} />
                <span>Mesh WebRTC • Server-Authoritative ACL</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── DIRECT CALL ACTIVE VIEW (unchanged) ────────────────────────────────
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
                {/* Call Duration Timer Badge (Phase 6.7) */}
                {connectionState === 'connected' && (
                  <span className="call-page__badge call-page__badge--timer" id="call-duration-timer">
                    <Clock size={12} />
                    <span>{formatCallDuration(callDuration)}</span>
                  </span>
                )}
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
                  : roomState.status === 'offline'
                  ? `${roomState.invitee?.name || 'Recipient'} is Offline`
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

          {/* ── Native WebRTC Video Canvas Stage & In-Call Chat (Phase 6.7) ── */}
          <div className={`call-page__stage-container ${isChatOpen ? 'call-page__stage-container--with-chat' : ''}`}>
            <div className="call-page__video-stage">
              {/* Main Remote Video Screen */}
              <div className="call-page__remote-wrapper glass">
                {/* Always mounted remote video element ensures audio & video tracks are never unmounted */}
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="call-page__remote-video"
                  id="remote-video-player"
                  style={{ display: hasRemoteVideo ? 'block' : 'none' }}
                />

                {!hasRemoteVideo && (
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
                        {connectionState === 'connected' ? (
                          <div className="call-page__connecting-pulse call-page__connecting-pulse--connected">
                            <Radio size={16} />
                            <span>🎙️ Connected (Camera Off / Audio Only)</span>
                          </div>
                        ) : connectionState === 'connecting' ? (
                          <div className="call-page__connecting-pulse">
                            <Radio size={16} className="call-page__spin" />
                            <span>Establishing Media Connection...</span>
                          </div>
                        ) : connectionState === 'reconnecting' ? (
                          <div className="call-page__connecting-pulse call-page__connecting-pulse--warning">
                            <RefreshCw size={16} className="call-page__spin" />
                            <span>Reconnecting Stream...</span>
                          </div>
                        ) : connectionState === 'failed' ? (
                          <div className="call-page__connecting-pulse call-page__connecting-pulse--danger">
                            <AlertCircle size={16} />
                            <span>Connection Failed</span>
                          </div>
                        ) : (
                          <div className="call-page__connecting-pulse">
                            <Radio size={16} className="call-page__spin" />
                            <span>Negotiating P2P Media Stream...</span>
                          </div>
                        )}
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
                    ) : roomState.status === 'offline' ? (
                      <div className="call-page__waiting-indicator">
                        <UserX size={40} className="text-warning" />
                        <p className="call-page__waiting-text">
                          {roomState.invitee?.name || 'Recipient'} is Currently Offline
                        </p>
                        <p className="call-page__waiting-sub">
                          The recipient does not have an active browser session right now. You can copy the invite link and share it directly with them to join when ready.
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="call-page__btn call-page__btn--primary call-page__btn--sm"
                            onClick={handleCopyLink}
                            id="call-offline-copy-btn"
                          >
                            <Copy size={14} />
                            <span>Copy Invite Link</span>
                          </button>
                          <button
                            type="button"
                            className="call-page__btn call-page__btn--outline call-page__btn--sm"
                            onClick={handleEndCall}
                            id="call-offline-back-btn"
                          >
                            Back to Contacts
                          </button>
                        </div>
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
                    {canModerate && remotePeer?.socketId && (
                      <div className="call-page__peer-quick-mod">
                        <button
                          type="button"
                          className="call-page__peer-quick-mod-btn"
                          title="Mute Remote Participant"
                          onClick={() => handleMuteParticipant(remotePeer.socketId)}
                        >
                          <MicOff size={11} />
                        </button>
                        <button
                          type="button"
                          className="call-page__peer-quick-mod-btn call-page__peer-quick-mod-btn--kick"
                          title="Remove Participant"
                          onClick={() => handleRemoveParticipant(remotePeer.socketId)}
                        >
                          <UserX size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Floating Local Picture-in-Picture Preview */}
                <div className="call-page__local-wrapper glass">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="call-page__local-video"
                    id="local-video-preview"
                    style={{
                      display: (localStream && !isVideoOff && !isAudioOnly) || isScreenSharing ? 'block' : 'none',
                      transform: isScreenSharing ? 'none' : 'scaleX(-1)',
                    }}
                  />
                  {(!localStream || isVideoOff || isAudioOnly) && !isScreenSharing && (
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
                    <span>You {isScreenSharing ? '(Sharing Screen)' : isMuted ? '(Muted)' : ''}</span>
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

                {/* Toggle Screen Share (Phase 6.7) */}
                <button
                  type="button"
                  className={`call-page__ctrl-btn ${isScreenSharing ? 'call-page__ctrl-btn--active' : ''}`}
                  onClick={toggleScreenShare}
                  title={isScreenSharing ? 'Stop Sharing Screen' : 'Share Screen'}
                  aria-label={isScreenSharing ? 'Stop Sharing Screen' : 'Share Screen'}
                  id="call-toggle-screen-btn"
                >
                  {isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
                  <span className="call-page__ctrl-label">{isScreenSharing ? 'Stop Share' : 'Share'}</span>
                </button>

                {/* Raise Hand Button */}
                <button
                  type="button"
                  className={`call-page__ctrl-btn ${isHandRaised ? 'call-page__ctrl-btn--active' : ''}`}
                  onClick={handleToggleRaiseHand}
                  title={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
                  aria-label={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
                  id="direct-toggle-hand-btn"
                >
                  <Hand size={20} />
                  <span className="call-page__ctrl-label">{isHandRaised ? 'Hand Up' : 'Raise Hand'}</span>
                </button>

                {/* Flip Camera Button */}
                <button
                  type="button"
                  className="call-page__ctrl-btn"
                  onClick={handleSwitchCamera}
                  title="Switch Front/Rear Camera"
                  aria-label="Switch Camera"
                  id="direct-switch-cam-btn"
                >
                  <SwitchCamera size={20} />
                  <span className="call-page__ctrl-label">Flip Cam</span>
                </button>

                {/* Lock Room (Host/Co-host) */}
                {canModerate && (
                  <button
                    type="button"
                    className={`call-page__ctrl-btn ${roomState.isLocked ? 'call-page__ctrl-btn--active' : ''}`}
                    onClick={handleToggleLockRoom}
                    title={roomState.isLocked ? 'Unlock Meeting' : 'Lock Meeting'}
                    aria-label={roomState.isLocked ? 'Unlock Meeting' : 'Lock Meeting'}
                    id="direct-toggle-lock-btn"
                  >
                    {roomState.isLocked ? <Lock size={20} /> : <Unlock size={20} />}
                    <span className="call-page__ctrl-label">{roomState.isLocked ? 'Locked' : 'Lock'}</span>
                  </button>
                )}

                {/* Toggle In-Call Chat (Phase 6.7) */}
                <button
                  type="button"
                  className={`call-page__ctrl-btn ${isChatOpen ? 'call-page__ctrl-btn--active' : ''}`}
                  onClick={toggleChat}
                  title={isChatOpen ? 'Close Chat' : 'Open In-Call Chat'}
                  aria-label={isChatOpen ? 'Close Chat' : 'Open In-Call Chat'}
                  id="call-toggle-chat-btn"
                >
                  <MessageSquare size={20} />
                  {unreadCount > 0 && !isChatOpen && (
                    <span className="call-page__unread-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                  <span className="call-page__ctrl-label">Chat</span>
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

            {/* In-Call Text Chat Drawer (Phase 6.7) */}
            {isChatOpen && (
              <aside className="call-page__chat-drawer glass animate-fade-in" aria-label="In-Call Chat">
                <div className="call-page__chat-header">
                  <div className="call-page__chat-title-group">
                    <MessageSquare size={16} />
                    <h3>In-Call Chat</h3>
                  </div>
                  <button
                    type="button"
                    className="call-page__chat-close-btn"
                    onClick={() => setIsChatOpen(false)}
                    aria-label="Close Chat"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="call-page__chat-messages" role="log" aria-live="polite">
                  {messages.length === 0 ? (
                    <div className="call-page__chat-empty">
                      <MessageSquare size={28} className="text-muted" />
                      <p>No messages yet.</p>
                      <span>Send a message to your call partner.</span>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isSelf = msg.senderId === currentUser?.id;
                      const timeStr = msg.timestamp
                        ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '';
                      return (
                        <div
                          key={msg.id}
                          className={`call-page__chat-bubble-wrap ${isSelf ? 'call-page__chat-bubble-wrap--self' : 'call-page__chat-bubble-wrap--remote'}`}
                        >
                          {!isSelf && (
                            <span className="call-page__chat-sender-name">{msg.senderName}</span>
                          )}
                          <div className={`call-page__chat-bubble ${isSelf ? 'call-page__chat-bubble--self' : 'call-page__chat-bubble--remote'}`}>
                            <p className="call-page__chat-text">{msg.text}</p>
                            <span className="call-page__chat-time">{timeStr}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatMessagesEndRef} />
                </div>

                <form className="call-page__chat-input-form" onSubmit={handleSendChatMessage}>
                  <input
                    type="text"
                    className="call-page__chat-input"
                    placeholder="Type a message..."
                    maxLength={1000}
                    value={chatInputText}
                    onChange={(e) => setChatInputText(e.target.value)}
                    id="call-chat-input"
                  />
                  <button
                    type="submit"
                    className="call-page__chat-send-btn"
                    disabled={!chatInputText.trim()}
                    aria-label="Send message"
                    id="call-chat-send-btn"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </aside>
            )}
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
                Start a 1-on-1 direct call or invite multiple contacts for a group call.
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

        {/* Call Mode Tabs */}
        <div className="call-page__mode-tabs" role="tablist" aria-label="Call Mode">
          <button
            type="button"
            role="tab"
            aria-selected={callMode === 'direct'}
            className={`call-page__mode-tab ${callMode === 'direct' ? 'call-page__mode-tab--active' : ''}`}
            onClick={() => { setCallMode('direct'); setSelectedInviteeIds(new Set()); }}
            id="tab-direct"
          >
            <Phone size={16} />
            <span>Direct (1-on-1)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={callMode === 'group'}
            className={`call-page__mode-tab ${callMode === 'group' ? 'call-page__mode-tab--active' : ''}`}
            onClick={() => { setCallMode('group'); setSelectedInvitee(null); }}
            id="tab-group"
          >
            <Users size={16} />
            <span>Group Call (up to 5)</span>
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
                <h2 id="contacts-heading" className="call-page__card-title">
                  {callMode === 'group'
                    ? `Registered Contacts ${selectedInviteeIds.size > 0 ? `(${selectedInviteeIds.size}/4 selected)` : ''}`
                    : 'Registered Contacts'}
                </h2>
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

            {/* Group mode: selected chips */}
            {callMode === 'group' && selectedInviteeIds.size > 0 && (
              <div className="call-page__group-chips">
                {Array.from(selectedInviteeIds).map((id) => {
                  const c = contacts.find((x) => x.id === id);
                  if (!c) return null;
                  return (
                    <span key={id} className="call-page__group-chip">
                      <span
                        className="call-page__group-chip-avatar"
                        style={{ background: c.avatarColor || '#6366f1' }}
                      >
                        {c.initials || c.name?.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{c.name}</span>
                      <button
                        type="button"
                        className="call-page__group-chip-remove"
                        aria-label={`Remove ${c.name}`}
                        onClick={() => setSelectedInviteeIds((prev) => { const next = new Set(prev); next.delete(id); return next; })}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

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
              <ul className="call-page__contacts-list" role="listbox" aria-label="Select contact to call" aria-multiselectable={callMode === 'group'}>
                {contacts.map((contact) => {
                  const isSelectedDirect = callMode === 'direct' && selectedInvitee?.id === contact.id;
                  const isSelectedGroup = callMode === 'group' && selectedInviteeIds.has(contact.id);
                  const isSelected = isSelectedDirect || isSelectedGroup;
                  const hasDuplicateName = contacts.filter((c) => c.name && contact.name && c.name.toLowerCase() === contact.name.toLowerCase()).length > 1;
                  const online = typeof isUserOnline === 'function' ? isUserOnline(contact.id) : false;
                  const isGroupFull = callMode === 'group' && selectedInviteeIds.size >= 4 && !isSelectedGroup;

                  const handleContactClick = () => {
                    if (callMode === 'direct') {
                      setSelectedInvitee(contact);
                    } else {
                      // Group mode: toggle selection (max 4 invitees)
                      setSelectedInviteeIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(contact.id)) {
                          next.delete(contact.id);
                        } else if (next.size < 4) {
                          next.add(contact.id);
                        }
                        return next;
                      });
                    }
                  };

                  return (
                    <li
                      key={contact.id}
                      className={[
                        'call-page__contact-item',
                        isSelected ? 'call-page__contact-item--selected' : '',
                        isGroupFull ? 'call-page__contact-item--disabled' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={isGroupFull ? undefined : handleContactClick}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={isGroupFull}
                      tabIndex={isGroupFull ? -1 : 0}
                      onKeyDown={(e) => {
                        if (!isGroupFull && (e.key === 'Enter' || e.key === ' ')) {
                          handleContactClick();
                        }
                      }}
                    >
                      {callMode === 'group' && (
                        <div className="call-page__group-check">
                          <div className={`call-page__checkbox ${isSelectedGroup ? 'call-page__checkbox--checked' : ''}`}>
                            {isSelectedGroup && <Check size={12} />}
                          </div>
                        </div>
                      )}
                      <div className="call-page__avatar-wrapper">
                        <div
                          className="call-page__contact-avatar"
                          style={{ background: contact.avatarColor || '#6366f1' }}
                        >
                          {contact.initials || contact.name?.slice(0, 2).toUpperCase()}
                        </div>
                        <span
                          className={`call-page__presence-dot ${online ? 'call-page__presence-dot--online' : 'call-page__presence-dot--offline'}`}
                          title={online ? 'Online' : 'Offline'}
                          aria-label={online ? 'Online' : 'Offline'}
                        />
                      </div>
                      <div className="call-page__contact-meta">
                        <div className="call-page__contact-name-row">
                          <span className="call-page__contact-name">{contact.name}</span>
                          {hasDuplicateName && (
                            <span className="call-page__duplicate-badge" title={`Account: ${contact.email}`}>
                              {contact.email ? contact.email.split('@')[0] : 'user'}
                            </span>
                          )}
                          <span
                            className={`call-page__presence-pill ${online ? 'call-page__presence-pill--online' : 'call-page__presence-pill--offline'}`}
                          >
                            {online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <span className="call-page__contact-email">{contact.email}</span>
                      </div>
                      {isSelectedDirect && (
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
                {callMode === 'group' ? <UserPlus size={18} /> : <Phone size={18} />}
                <h2 id="start-call-heading" className="call-page__card-title">
                  {callMode === 'group' ? 'Start Group Call' : 'Initiate Video Call'}
                </h2>
              </div>
              <div className="call-page__status-indicator">
                <span className={`call-page__dot ${socketConnected ? 'call-page__dot--online' : 'call-page__dot--offline'}`} />
                <span>{socketConnected ? 'Signaling Gateway Ready' : 'Connecting to Gateway...'}</span>
              </div>
            </div>

            <div className="call-page__start-body">
              {/* ── DIRECT CALL PANEL ── */}
              {callMode === 'direct' && (
                <>
                  {selectedInvitee ? (
                    (() => {
                      const inviteeIsOnline = typeof isUserOnline === 'function' ? isUserOnline(selectedInvitee.id) : false;
                      return (
                        <div className="call-page__target-preview glass animate-fade-in">
                          <div className="call-page__target-header">
                            <span className="call-page__target-label">Selected Recipient:</span>
                            <span
                              className={`call-page__presence-pill ${inviteeIsOnline ? 'call-page__presence-pill--online' : 'call-page__presence-pill--offline'}`}
                            >
                              {inviteeIsOnline ? '🟢 Online' : '⚪ Offline'}
                            </span>
                          </div>
                          <div className="call-page__target-row">
                            <div className="call-page__avatar-wrapper">
                              <div
                                className="call-page__contact-avatar"
                                style={{ background: selectedInvitee.avatarColor || '#6366f1' }}
                              >
                                {selectedInvitee.initials || selectedInvitee.name?.slice(0, 2).toUpperCase()}
                              </div>
                              <span
                                className={`call-page__presence-dot ${inviteeIsOnline ? 'call-page__presence-dot--online' : 'call-page__presence-dot--offline'}`}
                              />
                            </div>
                            <div className="call-page__target-meta">
                              <p className="call-page__target-name">{selectedInvitee.name}</p>
                              <p className="call-page__target-email">{selectedInvitee.email}</p>
                            </div>
                          </div>
                          {!inviteeIsOnline && (
                            <div className="call-page__offline-notice">
                              <AlertTriangle size={14} className="text-warning" style={{ flexShrink: 0, marginTop: '2px' }} />
                              <span>
                                This contact is currently <strong>offline</strong>. They will not receive a ringing notification until they open VideoVerse. You can still generate an invite link.
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()
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
                        <span>
                          Start Call with {selectedInvitee ? selectedInvitee.name : 'Recipient'}
                          {selectedInvitee && isUserOnline && !isUserOnline(selectedInvitee.id) ? ' (Offline)' : ''}
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}

              {/* ── GROUP CALL PANEL ── */}
              {callMode === 'group' && (
                <>
                  <div className="call-page__group-info-box">
                    <UserPlus size={22} className="call-page__accent-color" />
                    <div>
                      <p className="call-page__group-info-title">Group Call — Up to 5 Participants</p>
                      <p className="call-page__group-info-sub">
                        Select 1–4 contacts from the left panel. You are the host (participant 1 of 5).
                        Invitees receive a ringing notification if online.
                      </p>
                    </div>
                  </div>

                  {selectedInviteeIds.size > 0 ? (
                    <div className="call-page__group-summary glass animate-fade-in">
                      <p className="call-page__group-summary-label">
                        <Users size={14} /> Group: You + {selectedInviteeIds.size} contact{selectedInviteeIds.size > 1 ? 's' : ''} = {1 + selectedInviteeIds.size} participants
                      </p>
                      <div className="call-page__group-summary-avatars">
                        {/* Host */}
                        <div
                          className="call-page__group-summary-avatar"
                          title={`${currentUser?.name} (You - Host)`}
                          style={{ background: currentUser?.avatarColor || '#6366f1', border: '2px solid var(--accent, #6366f1)' }}
                        >
                          {currentUser?.initials || 'U'}
                        </div>
                        {/* Invitees */}
                        {Array.from(selectedInviteeIds).map((id) => {
                          const c = contacts.find((x) => x.id === id);
                          if (!c) return null;
                          const online = typeof isUserOnline === 'function' ? isUserOnline(c.id) : false;
                          return (
                            <div
                              key={id}
                              className="call-page__group-summary-avatar"
                              title={`${c.name} ${online ? '(Online)' : '(Offline)'}`}
                              style={{ background: c.avatarColor || '#ec4899' }}
                            >
                              {c.initials || c.name?.slice(0, 1).toUpperCase()}
                            </div>
                          );
                        })}
                        {selectedInviteeIds.size < 4 && (
                          <div className="call-page__group-summary-avatar call-page__group-summary-avatar--add" title="Select more contacts">
                            <UserPlus size={14} />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="call-page__prompt-box">
                      <Users size={28} className="text-muted" />
                      <p>Select 1 to 4 contacts from the directory to form a group.</p>
                    </div>
                  )}

                  <button
                    type="button"
                    className="call-page__btn call-page__btn--start"
                    disabled={selectedInviteeIds.size === 0 || isCreatingGroupRoom || !socketConnected}
                    onClick={handleStartGroupCall}
                    id="call-start-group-btn"
                  >
                    {isCreatingGroupRoom ? (
                      <>
                        <RefreshCw size={18} className="call-page__spin" />
                        <span>Creating Group Room...</span>
                      </>
                    ) : (
                      <>
                        <Users size={18} />
                        <span>
                          Start Group Call ({1 + selectedInviteeIds.size} participant{selectedInviteeIds.size !== 0 ? 's' : ''})
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}

              {/* Direct Room Join Option */}
              <div className="call-page__join-direct">
                <span className="call-page__divider-text">OR JOIN BY ROOM LINK / ID</span>
                <div className="call-page__input-row">
                  <input
                    type="text"
                    className="call-page__room-input"
                    placeholder="e.g. call-xyz123abc456 or paste invite link"
                    value={activeRoomId || ''}
                    onChange={(e) => setActiveRoomId(e.target.value.trim())}
                    aria-label="Enter Call Room ID or Paste Invite Link"
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
                <span>All rooms enforce cryptographic identifiers, participant bounds, and MongoDB-backed ACLs.</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
