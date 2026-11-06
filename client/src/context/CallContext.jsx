import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useApp } from './AppContext';

const CallContext = createContext(null);

export function CallProvider({ children }) {
  const { currentUser, navigateToCall, showToast } = useApp();
  const [socketConnected, setSocketConnected] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // { roomId, caller, createdAt }

  const socketRef = useRef(null);

  useEffect(() => {
    if (!currentUser) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      setIncomingCall(null);
      return;
    }

    // Connect to Socket.IO signaling gateway with HTTP-only cookie credentials
    const socketUrl = window.location.port === '5173' ? 'http://localhost:5000' : '/';
    const socket = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setSocketConnected(true);
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

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('incoming-call', onIncomingCall);
    socket.on('call-cancelled', onCallCancelled);
    socket.on('call-timeout', onCallTimeout);
    socket.on('call-accepted', onCallAccepted);
    socket.on('call-rejected', onCallRejected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('incoming-call', onIncomingCall);
      socket.off('call-cancelled', onCallCancelled);
      socket.off('call-timeout', onCallTimeout);
      socket.off('call-accepted', onCallAccepted);
      socket.off('call-rejected', onCallRejected);
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

  const value = {
    socket: socketRef.current,
    socketRef,
    socketConnected,
    incomingCall,
    acceptCall,
    declineCall,
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
