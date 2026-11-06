import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useCall } from '../../context/CallContext';
import './IncomingCallModal.css';

export default function IncomingCallModal() {
  const { incomingCall, acceptCall, declineCall } = useCall();
  const acceptBtnRef = useRef(null);

  // Focus the accept button when incoming call appears
  useEffect(() => {
    if (incomingCall && acceptBtnRef.current) {
      acceptBtnRef.current.focus();
    }
  }, [incomingCall]);

  if (!incomingCall) return null;

  const { roomId, caller } = incomingCall;
  const callerName = caller?.name || 'VideoVerse User';
  const callerInitials = caller?.initials || callerName.slice(0, 2).toUpperCase();
  const avatarColor = caller?.avatarColor || '#6366f1';

  return (
    <div
      className="incoming-call-overlay animate-fade-in"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incoming-call-title"
      aria-describedby="incoming-call-desc"
    >
      <div className="incoming-call-card glass">
        {/* Pulsing Ring Indicator */}
        <div className="incoming-call__ring-wrapper">
          <div className="incoming-call__ring-pulse incoming-call__ring-pulse--1" />
          <div className="incoming-call__ring-pulse incoming-call__ring-pulse--2" />
          <div
            className="incoming-call__avatar"
            style={{ background: avatarColor }}
            aria-hidden="true"
          >
            {caller?.avatar ? (
              <img src={caller.avatar} alt={callerName} className="incoming-call__avatar-img" />
            ) : (
              <span className="incoming-call__avatar-text">{callerInitials}</span>
            )}
          </div>
          <div className="incoming-call__badge-icon">
            <Video size={16} />
          </div>
        </div>

        {/* Call Info */}
        <div className="incoming-call__content">
          <span className="incoming-call__tag">Incoming Video Call</span>
          <h3 id="incoming-call-title" className="incoming-call__name">
            {callerName}
          </h3>
          <p id="incoming-call-desc" className="incoming-call__desc">
            is calling you to join encrypted video room
          </p>
        </div>

        {/* Action Buttons */}
        <div className="incoming-call__actions">
          <button
            type="button"
            className="incoming-call__btn incoming-call__btn--decline"
            onClick={() => declineCall(roomId)}
            id="incoming-call-decline-btn"
            aria-label="Decline Call"
          >
            <PhoneOff size={20} />
            <span>Decline</span>
          </button>

          <button
            ref={acceptBtnRef}
            type="button"
            className="incoming-call__btn incoming-call__btn--accept"
            onClick={() => acceptCall(roomId)}
            id="incoming-call-accept-btn"
            aria-label="Accept Call"
          >
            <Phone size={20} />
            <span>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}
