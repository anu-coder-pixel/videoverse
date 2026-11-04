import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Settings,
  SkipBack, SkipForward, PictureInPicture2, AlertTriangle, RefreshCw, Loader2, Check
} from 'lucide-react';
import { getThumbnailStyle } from '../../data/mockData';
import './VideoPlayer.css';

/**
 * VideoVerse — Functional HTML5 Video Player
 *
 * Stage 2 Features:
 * ✅ Real HTML5 <video> element with legitimate sample MP4 stream
 * ✅ Synchronized video events (play, pause, timeupdate, loadedmetadata, waiting, ended, error)
 * ✅ Error detection and user-friendly fallback view with retry and alternate source switching
 * ✅ Interactive scrubbing progress bar, timestamp display, and volume slider
 * ✅ Fullscreen API, Picture-in-Picture, and keyboard controls (Space, K, M, F, Arrows)
 *
 * Phase 5.1 Playback Controls:
 * ✅ Playback speed selector: 0.5x, 0.75x, 1x (Normal), 1.25x, 1.5x, 2x
 * ✅ Safe localStorage speed preference persistence and load restoration
 * ✅ Consistent 10-second seeking with buttons, Left/Right arrows, and J/L shortcuts
 * ✅ Seeking clamped safely between 0 and video duration
 * ✅ Clickable time display toggling between "current / total" and "current / -remaining"
 */

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SPEED_STORAGE_KEY = 'videoverse_playback_speed';

function getStoredPlaybackSpeed() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(SPEED_STORAGE_KEY);
      if (saved) {
        const parsed = parseFloat(saved);
        if (PLAYBACK_SPEEDS.includes(parsed)) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('Unable to read playback speed from localStorage:', err);
  }
  return 1;
}

function setStoredPlaybackSpeed(speed) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SPEED_STORAGE_KEY, String(speed));
    }
  } catch (err) {
    console.warn('Unable to save playback speed to localStorage:', err);
  }
}

export default function VideoPlayer({ video }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const speedMenuRef = useRef(null);
  const hideControlsTimer = useRef(null);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(() => parseDuration(video.duration) || 60);
  const [progress, setProgress] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // Phase 5.1: Speed & Time Display state
  const [playbackSpeed, setPlaybackSpeed] = useState(() => getStoredPlaybackSpeed());
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showRemainingTime, setShowRemainingTime] = useState(false);

  // Stream source & error handling
  const [currentSrc, setCurrentSrc] = useState(video.videoUrl);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isUsingFallback, setIsUsingFallback] = useState(false);

  // Reset player when video prop changes
  useEffect(() => {
    setCurrentSrc(video.videoUrl);
    setHasError(false);
    setErrorMessage('');
    setIsUsingFallback(false);
    setProgress(0);
    setCurrentTimeSec(0);
    setPlaying(false);
    setIsBuffering(false);
    setShowSpeedMenu(false);
    setDurationSec(parseDuration(video.duration) || 60);

    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.playbackRate = playbackSpeed;
      videoRef.current.load();
    }
  }, [video.id, video.videoUrl, video.duration, playbackSpeed]);

  // Synchronize playback rate on video element whenever playbackSpeed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, currentSrc]);

  // Auto-hide controls when playing (paused while speed menu is open)
  useEffect(() => {
    if (playing && !showSpeedMenu) {
      resetHideTimer();
    } else {
      clearTimeout(hideControlsTimer.current);
      setShowControls(true);
    }
    return () => clearTimeout(hideControlsTimer.current);
  }, [playing, showSpeedMenu]);

  // Close speed menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (speedMenuRef.current && !speedMenuRef.current.contains(event.target)) {
        setShowSpeedMenu(false);
      }
    }
    if (showSpeedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSpeedMenu]);

  function resetHideTimer() {
    clearTimeout(hideControlsTimer.current);
    setShowControls(true);
    hideControlsTimer.current = setTimeout(() => {
      setShowControls(false);
    }, 3200);
  }

  function handleMouseMove() {
    if (playing) resetHideTimer();
  }

  // Synchronized Video Events
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    const dur = videoRef.current.duration || durationSec || 1;
    setCurrentTimeSec(curr);
    setProgress((curr / dur) * 100);
  }, [durationSec]);

  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    const dur = videoRef.current.duration;
    if (dur && !isNaN(dur) && isFinite(dur)) {
      setDurationSec(dur);
    }
    videoRef.current.playbackRate = playbackSpeed;
    setHasError(false);
  }, [playbackSpeed]);

  const handleWaiting = () => setIsBuffering(true);
  const handlePlaying = () => {
    setIsBuffering(false);
    setPlaying(true);
    setHasError(false);
  };
  const handlePause = () => setPlaying(false);
  const handleEnded = () => {
    setPlaying(false);
    setProgress(100);
  };

  const handleVideoError = useCallback((e) => {
    setIsBuffering(false);
    setPlaying(false);
    setHasError(true);
    const mediaErr = videoRef.current?.error;
    let detail = 'The video stream could not be loaded.';
    if (mediaErr) {
      if (mediaErr.code === 1) detail = 'Video loading aborted by user.';
      if (mediaErr.code === 2) detail = 'Network error while loading video stream.';
      if (mediaErr.code === 3) detail = 'Video decoding failed or media corrupted.';
      if (mediaErr.code === 4) detail = 'Media format not supported or stream unreachable.';
    }
    setErrorMessage(detail);
  }, []);

  // Controls Handlers
  function togglePlay() {
    if (hasError || !videoRef.current) return;

    if (videoRef.current.paused || videoRef.current.ended) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Playback request was prevented:', err);
        });
      }
    } else {
      videoRef.current.pause();
    }
  }

  function handleProgressClick(e) {
    if (hasError || !videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = e.clientX - rect.left;
    const pct = Math.min(100, Math.max(0, (clickX / rect.width) * 100));
    const maxDur = (videoRef.current && !isNaN(videoRef.current.duration) && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
      ? videoRef.current.duration
      : (durationSec || 0);
    const newTime = maxDur > 0 ? Math.max(0, Math.min(maxDur, (pct / 100) * maxDur)) : 0;
    videoRef.current.currentTime = newTime;
    setProgress(pct);
    setCurrentTimeSec(newTime);
  }

  function handleVolumeChange(e) {
    const val = Number(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val / 100;
      videoRef.current.muted = val === 0;
    }
    setMuted(val === 0);
  }

  function toggleMute() {
    if (!videoRef.current) return;
    const nextMuted = !muted;
    videoRef.current.muted = nextMuted;
    setMuted(nextMuted);
  }

  function skipSeconds(sec) {
    if (hasError || !videoRef.current) return;
    const maxDur = (videoRef.current && !isNaN(videoRef.current.duration) && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
      ? videoRef.current.duration
      : (durationSec || 0);
    const cur = videoRef.current.currentTime || 0;
    const target = maxDur > 0 ? Math.max(0, Math.min(maxDur, cur + sec)) : 0;
    videoRef.current.currentTime = target;
    setCurrentTimeSec(target);
    if (maxDur > 0) {
      setProgress((target / maxDur) * 100);
    }
  }

  function handleSelectSpeed(speed) {
    setPlaybackSpeed(speed);
    setStoredPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
  }

  function toggleTimeDisplayMode(e) {
    if (e) e.stopPropagation();
    setShowRemainingTime(prev => !prev);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  }

  async function togglePictureInPicture() {
    if (!videoRef.current || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('Picture in picture error:', err);
    }
  }

  function handleKeyDown(e) {
    // If typing in input or textarea, don't trigger shortcuts
    if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;

    // If focus is inside speed menu, let user interact with menu items
    if (e.target && e.target.closest && e.target.closest('.video-player__speed-menu')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSpeedMenu(false);
      }
      return;
    }

    if (e.key === ' ' || e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
    if (e.key === 'm' || e.key === 'M') { toggleMute(); }
    if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') { e.preventDefault(); skipSeconds(-10); }
    if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); skipSeconds(10); }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextVol = Math.min(100, volume + 10);
      setVolume(nextVol);
      if (videoRef.current) videoRef.current.volume = nextVol / 100;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextVol = Math.max(0, volume - 10);
      setVolume(nextVol);
      if (videoRef.current) videoRef.current.volume = nextVol / 100;
    }
    if (e.key === 'Escape' && showSpeedMenu) {
      e.preventDefault();
      setShowSpeedMenu(false);
    }
  }

  // Fallback & Retry Handlers
  function handleTryFallback() {
    setHasError(false);
    setIsUsingFallback(true);
    const fallback = video.fallbackUrl || 'https://vjs.zencdn.net/v/oceans.mp4';
    setCurrentSrc(fallback);
    if (videoRef.current) {
      videoRef.current.src = fallback;
      videoRef.current.playbackRate = playbackSpeed;
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }

  function handleRetryPrimary() {
    setHasError(false);
    setIsUsingFallback(false);
    setCurrentSrc(video.videoUrl);
    if (videoRef.current) {
      videoRef.current.src = video.videoUrl;
      videoRef.current.playbackRate = playbackSpeed;
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }

  const formattedCurrentTime = formatTime(currentTimeSec);
  const formattedTotalTime = formatTime(durationSec);
  const remainingSec = Math.max(0, durationSec - currentTimeSec);
  const formattedRemainingTime = `-${formatTime(remainingSec)}`;
  const displayedTimeString = showRemainingTime
    ? `${formattedCurrentTime} / ${formattedRemainingTime}`
    : `${formattedCurrentTime} / ${formattedTotalTime}`;

  return (
    <div
      ref={containerRef}
      className={`video-player ${showControls ? 'video-player--controls-visible' : ''} ${hasError ? 'video-player--error' : ''}`}
      onMouseMove={handleMouseMove}
      onClick={togglePlay}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label={`Video player: ${video.title}`}
      id="main-video-player"
    >
      {/* HTML5 Video Element */}
      <video
        ref={videoRef}
        src={currentSrc}
        poster={video.thumbnailUrl}
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleVideoError}
        className="video-player__media"
        aria-hidden="true"
      />

      {/* Surface Gradient / Poster background if not loaded or fallback */}
      <div
        className="video-player__backdrop"
        style={{
          backgroundImage: video.thumbnailUrl ? `url(${video.thumbnailUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          ...getThumbnailStyle(video.thumbnailIndex),
        }}
        aria-hidden="true"
      />

      {/* Top Stream Status Badge */}
      <div className="video-player__status-badge" onClick={e => e.stopPropagation()}>
        {!hasError ? (
          <span className={`badge ${isUsingFallback ? 'badge--warning' : 'badge--brand'}`}>
            <span className="video-player__status-dot" aria-hidden="true" />
            {isUsingFallback ? 'Backup Sample Stream' : 'HTML5 Video Stream Active'}
          </span>
        ) : (
          <span className="badge badge--error">
            <AlertTriangle size={12} style={{ marginRight: 4 }} />
            Stream Error
          </span>
        )}
      </div>

      {/* Buffering Spinner */}
      {isBuffering && !hasError && (
        <div className="video-player__buffering" aria-label="Loading video stream">
          <Loader2 size={44} className="video-player__spin" />
        </div>
      )}

      {/* Big Play Overlay (when paused or ended) */}
      {!playing && !hasError && !isBuffering && (
        <div className="video-player__big-play animate-fade-in" aria-hidden="true">
          <div className="video-player__big-play-btn">
            <Play size={46} fill="white" strokeWidth={0} />
          </div>
        </div>
      )}

      {/* Clear Fallback Message Overlay if stream fails */}
      {hasError && (
        <div
          className="video-player__fallback-overlay animate-fade-in"
          onClick={e => e.stopPropagation()}
          role="alert"
          aria-live="assertive"
        >
          <div className="video-player__fallback-card glass">
            <AlertTriangle size={36} className="text-warning" />
            <h3>Unable to Load Video Stream</h3>
            <p>{errorMessage || 'The requested sample video could not be streamed.'}</p>
            <div className="video-player__fallback-actions">
              <button
                className="btn btn--primary btn--sm"
                onClick={handleTryFallback}
                id="player-fallback-btn"
              >
                <RefreshCw size={14} />
                Try Alternate Sample
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={handleRetryPrimary}
                id="player-retry-btn"
              >
                Retry Stream
              </button>
            </div>
            <span className="video-player__fallback-hint">
              VideoVerse uses public sample media for frontend prototype playback.
            </span>
          </div>
        </div>
      )}

      {/* Custom Controls Bar */}
      <div
        className="video-player__controls"
        onClick={e => e.stopPropagation()}
        aria-label="Video controls"
      >
        {/* Progress bar with interactive scrubbing */}
        <div
          className="video-player__progress"
          onClick={handleProgressClick}
          role="slider"
          aria-label="Video progress scrubber"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${formatTime(currentTimeSec)} of ${formatTime(durationSec)}`}
          tabIndex={0}
          id="video-progress-bar"
        >
          <div className="video-player__progress-track">
            <div
              className="video-player__progress-fill"
              style={{ width: `${progress}%` }}
            />
            <div
              className="video-player__progress-thumb"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>

        {/* Buttons Row */}
        <div className="video-player__btn-row">
          {/* Left controls */}
          <div className="video-player__left">
            <button
              type="button"
              className="video-player__btn"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              id="player-play-btn"
              title={playing ? 'Pause (Space/K)' : 'Play (Space/K)'}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>

            <button
              type="button"
              className="video-player__btn"
              aria-label="Skip backward 10 seconds"
              title="Skip back 10s (← or J)"
              onClick={() => skipSeconds(-10)}
              id="player-skip-back-btn"
            >
              <SkipBack size={16} />
            </button>

            <button
              type="button"
              className="video-player__btn"
              aria-label="Skip forward 10 seconds"
              title="Skip forward 10s (→ or L)"
              onClick={() => skipSeconds(10)}
              id="player-skip-forward-btn"
            >
              <SkipForward size={16} />
            </button>

            {/* Volume */}
            <div className="video-player__volume">
              <button
                type="button"
                className="video-player__btn"
                onClick={toggleMute}
                aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
                id="player-volume-btn"
              >
                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                className="video-player__volume-slider"
                min={0}
                max={100}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume slider"
                id="player-volume-slider"
              />
            </div>

            {/* Time toggle button */}
            <button
              type="button"
              className="video-player__time"
              onClick={toggleTimeDisplayMode}
              aria-label={
                showRemainingTime
                  ? `Current time ${formattedCurrentTime}, remaining time ${formattedRemainingTime}. Click to show total duration.`
                  : `Current time ${formattedCurrentTime}, total duration ${formattedTotalTime}. Click to show remaining time.`
              }
              title="Click to toggle remaining / total time"
              id="player-time-display"
            >
              {displayedTimeString}
            </button>
          </div>

          {/* Right controls */}
          <div className="video-player__right">
            {/* Playback Speed Selector */}
            <div className="video-player__speed-wrapper" ref={speedMenuRef}>
              <button
                type="button"
                className={`video-player__btn video-player__speed-btn ${showSpeedMenu ? 'video-player__btn--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSpeedMenu(prev => !prev);
                }}
                aria-label={`Playback speed: ${playbackSpeed === 1 ? '1x (Normal)' : `${playbackSpeed}x`}`}
                aria-haspopup="true"
                aria-expanded={showSpeedMenu}
                title="Playback Speed"
                id="player-speed-btn"
              >
                <span className="video-player__speed-label">
                  {playbackSpeed === 1 ? '1x' : `${playbackSpeed}x`}
                </span>
              </button>

              {showSpeedMenu && (
                <div
                  className="video-player__speed-menu animate-fade-in"
                  role="menu"
                  aria-label="Playback speed options"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="video-player__speed-header">Playback Speed</div>
                  {PLAYBACK_SPEEDS.map((speed) => {
                    const isSelected = speed === playbackSpeed;
                    return (
                      <button
                        key={speed}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        className={`video-player__speed-item ${isSelected ? 'video-player__speed-item--active' : ''}`}
                        onClick={() => handleSelectSpeed(speed)}
                        id={`player-speed-opt-${String(speed).replace('.', '_')}`}
                      >
                        <span className="video-player__speed-check">
                          {isSelected ? <Check size={14} /> : null}
                        </span>
                        <span className="video-player__speed-text">
                          {speed === 1 ? '1x (Normal)' : `${speed}x`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {document.pictureInPictureEnabled && (
              <button
                type="button"
                className="video-player__btn"
                onClick={togglePictureInPicture}
                aria-label="Toggle Picture-in-Picture"
                title="Picture-in-Picture"
                id="player-pip-btn"
              >
                <PictureInPicture2 size={16} />
              </button>
            )}

            <button
              type="button"
              className="video-player__btn"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
              title="Fullscreen (F)"
              id="player-fullscreen-btn"
            >
              <Maximize size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseDuration(str) {
  if (!str) return 60;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 60;
}

function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${m}:${pad(s % 60)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
