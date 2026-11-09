import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useApp } from './AppContext';

const CallContext = createContext(null);

export function CallProvider({ children }) {
  const { currentUser, navigateToCall, showToast } = useApp();
  const [socketConnected, setSocketConnected] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // { roomId, caller, createdAt }
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());

  const socketRef = useRef(null);

  useEffect(() => {
    if (!currentUser) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      setIncomingCall(null);
      setOnlineUserIds(new Set());
      return;
    }

    // Determine signaling gateway URL:
    // In local dev with Vite proxy (or when custom URL is not provided), use same-origin '/' to ensure
    // HTTP-only cookies are automatically included regardless of localhost, 127.0.0.1, or LAN IP access.
    // In production with an explicit custom backend, use that configured endpoint.
    const customBackendUrl = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_SOCKET_URL || import.meta.env?.VITE_API_BASE_URL)) || '';
    const socketUrl = customBackendUrl ? customBackendUrl.replace(/\/$/, '') : '/';
    const socket = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setSocketConnected(true);
      // Fetch initial list of online users from server-authoritative presence tracker
      socket.emit('get-online-users', {}, (res) => {
        if (res && res.success && Array.isArray(res.onlineUserIds)) {
          setOnlineUserIds(new Set(res.onlineUserIds.map(String)));
        }
      });
    };

    const onDisconnect = (reason) => {
      setSocketConnected(false);
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    };

    const onConnectError = (err) => {
      console.warn('[CallContext] Socket connect error:', err?.message || err);
      setSocketConnected(false);
    };

    // Incoming call notification from server
    const onIncomingCall = (data) => {
      if (!data || !data.roomId || !data.caller) return;
      setIncomingCall({
        roomId: data.roomId,
        caller: data.caller,
        createdAt: data.createdAt || Date.now(),
      });
    };

    // Caller cancelled before answer
    const onCallCancelled = (data) => {
      setIncomingCall((prev) => {
        if (prev && prev.roomId === data?.roomId) {
          if (data?.reason !== 'superseded') {
            showToast('Call was cancelled by the caller.');
          }
          return null;
        }
        return prev;
      });
    };

    // 30-second timeout expired
    const onCallTimeout = (data) => {
      setIncomingCall((prev) => {
        if (prev && prev.roomId === data?.roomId) {
          showToast('Missed call.');
          return null;
        }
        return prev;
      });
    };

    // Call was accepted (dismiss modal on other tabs)
    const onCallAccepted = (data) => {
      setIncomingCall((prev) => {
        if (prev && prev.roomId === data?.roomId) {
          return null;
        }
        return prev;
      });
    };

    // Call was rejected
    const onCallRejected = (data) => {
      setIncomingCall((prev) => {
        if (prev && prev.roomId === data?.roomId) {
          return null;
        }
        return prev;
      });
    };

    // Real-time presence updates (multi-tab / multi-device aware)
    const onUserPresence = (data) => {
      if (!data || !data.userId || !data.status) return;
      const targetUserId = String(data.userId);
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.status === 'online') {
          next.add(targetUserId);
        } else if (data.status === 'offline') {
          next.delete(targetUserId);
        }
        return next;
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('incoming-call', onIncomingCall);
    socket.on('call-cancelled', onCallCancelled);
    socket.on('call-timeout', onCallTimeout);
    socket.on('call-accepted', onCallAccepted);
    socket.on('call-rejected', onCallRejected);
    socket.on('user-presence', onUserPresence);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('incoming-call', onIncomingCall);
      socket.off('call-cancelled', onCallCancelled);
      socket.off('call-timeout', onCallTimeout);
      socket.off('call-accepted', onCallAccepted);
      socket.off('call-rejected', onCallRejected);
      socket.off('user-presence', onUserPresence);
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [currentUser, showToast]);

  // Accept incoming call: dismiss popup and navigate into the room
  const acceptCall = useCallback((roomId) => {
    if (!roomId) return;
    setIncomingCall(null);
    navigateToCall(roomId);
  }, [navigateToCall]);

  // Decline incoming call: notify caller and dismiss popup
  const declineCall = useCallback((roomId) => {
    if (!roomId) return;
    if (socketRef.current) {
      socketRef.current.emit('reject-call', { roomId });
    }
    setIncomingCall(null);
  }, []);

  // Check whether a specific user is currently online
  const isUserOnline = useCallback((userId) => {
    if (!userId) return false;
    return onlineUserIds.has(String(userId));
  }, [onlineUserIds]);

  const value = {
    socket: socketRef.current,
    socketRef,
    socketConnected,
    incomingCall,
    acceptCall,
    declineCall,
    onlineUserIds,
    isUserOnline,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
}
