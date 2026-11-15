/**
 * VideoVerse — ParticipantVideoTile
 *
 * Reusable video tile for group call participant grid.
 * Handles:
 *  - Local (self) tile: muted + mirrored unless screen sharing
 *  - Remote tile: attaches remote MediaStream via srcObject
 *  - Fallback avatar when camera is off or no stream yet
 *  - Name overlay, mic-off, video-off, and connection-state indicators
 */

import { useEffect, useRef } from 'react';
import { MicOff, VideoOff, Monitor, Wifi, WifiOff, Loader, Crown, Shield, Hand } from 'lucide-react';
import './ParticipantVideoTile.css';

export default function ParticipantVideoTile({
  peerId,
  name = 'Participant',
  initials = '?',
  avatarColor = '#6366f1',
  stream = null,
  isSelf = false,
  isMuted = false,
  isVideoOff = false,
  isScreenSharing = false,
  connectionState = null, // 'connecting' | 'connected' | 'disconnected' | 'failed' | null
  isAudioOnly = false,
  isHost = false,
  isCoHost = false,
  isSpeaking = false,
  isHandRaised = false,
  onMute = null,
  onRemove = null,
  canModerate = false,
}) {
  const videoRef = useRef(null);

  // Attach / detach stream
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && stream !== el.srcObject) {
      el.srcObject = stream;
      el.play().catch(() => {/* autoplay policy — handled by browser */});
    } else if (!stream) {
      el.srcObject = null;
    }
  }, [stream]);

  const showVideo = stream && !isVideoOff && !isAudioOnly;
  const showScreenShare = isSelf && isScreenSharing && Boolean(stream);

  const connectionIcon = () => {
    if (!connectionState || isSelf) return null;
    if (connectionState === 'connecting') return <Loader size={12} className="pvt__conn-icon pvt__spin" />;
    if (connectionState === 'connected') return <Wifi size={12} className="pvt__conn-icon pvt__conn-icon--ok" />;
    if (connectionState === 'failed' || connectionState === 'disconnected') return <WifiOff size={12} className="pvt__conn-icon pvt__conn-icon--bad" />;
    return null;
  };

  return (
    <div
      className={[
        'pvt',
        isSelf ? 'pvt--self' : 'pvt--remote',
        connectionState === 'failed' ? 'pvt--failed' : '',
        connectionState === 'connecting' ? 'pvt--connecting' : '',
        isSpeaking ? 'pvt--speaking' : '',
      ].filter(Boolean).join(' ')}
      data-peer-id={peerId}
    >
      {/* Video element — always mounted so tracks are never GC'd */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className="pvt__video"
        style={{
          display: (showVideo || showScreenShare) ? 'block' : 'none',
          transform: (isSelf && !isScreenSharing) ? 'scaleX(-1)' : 'none',
        }}
      />

      {/* Fallback avatar when no video */}
      {!showVideo && !showScreenShare && (
        <div className="pvt__avatar-wrap">
          <div
            className="pvt__avatar"
            style={{ background: avatarColor }}
            aria-label={`${name} initials`}
          >
            {initials}
          </div>
          {!isSelf && connectionState === 'connecting' && (
            <p className="pvt__connecting-label">Connecting…</p>
          )}
        </div>
      )}

      {/* Screen-share badge & Hand Raised Badge */}
      <div className="pvt__badges-top-left">
        {isScreenSharing && (
          <div className="pvt__screen-badge">
            <Monitor size={12} /> Screen
          </div>
        )}
        {isHandRaised && (
          <div className="pvt__hand-badge" title="Hand Raised">
            <Hand size={12} /> Hand Raised
          </div>
        )}
      </div>

      {/* Status icons row (top-right) */}
      <div className="pvt__status-row">
        {isHost && (
          <span className="pvt__role-chip pvt__role-chip--host" title="Meeting Host">
            <Crown size={11} /> Host
          </span>
        )}
        {isCoHost && !isHost && (
          <span className="pvt__role-chip pvt__role-chip--cohost" title="Co-Host">
            <Shield size={11} /> Co-Host
          </span>
        )}
        {isMuted && <span className="pvt__status-chip pvt__status-chip--muted" title="Microphone muted"><MicOff size={11} /></span>}
        {(isVideoOff || isAudioOnly) && !isScreenSharing && <span className="pvt__status-chip pvt__status-chip--vidoff" title="Camera off"><VideoOff size={11} /></span>}
        {connectionIcon()}
      </div>

      {/* Name tag & Moderation quick actions (bottom-left & bottom-right) */}
      <div className="pvt__footer-row">
        <div className="pvt__name-tag">
          <span>{isSelf ? `${name} (You)` : name}</span>
        </div>
        {!isSelf && canModerate && (
          <div className="pvt__mod-actions">
            {onMute && (
              <button
                type="button"
                className="pvt__mod-btn pvt__mod-btn--mute"
                title="Mute Participant"
                onClick={(e) => {
                  e.stopPropagation();
                  onMute(peerId);
                }}
              >
                <MicOff size={12} />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="pvt__mod-btn pvt__mod-btn--kick"
                title="Remove Participant"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(peerId);
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

