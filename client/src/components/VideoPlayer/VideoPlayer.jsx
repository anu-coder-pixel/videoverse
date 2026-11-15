import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize,
  SkipBack, SkipForward, PictureInPicture2, AlertTriangle, RefreshCw, Loader2, Check,
  RectangleHorizontal, Clock, Subtitles, Settings, Layers
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
 *
 * Phase 5.2 Theater Mode & Autoplay Next:
 * ✅ Theater mode toggle button and 'T' keyboard shortcut
 * ✅ Full-width expansion preserving playback position & speed
 * ✅ Autoplay next video 5s countdown overlay with Play Now and Cancel
 * ✅ Automatic timer cleanup preventing duplicate timers or memory leaks
 *
 * Phase 5.3 Resume Playback & Timeline Hover Preview:
 * ✅ LocalStorage playback position persistence key: videoverse_playback_positions
 * ✅ Store by video ID: { "videoId": currentTime }
 * ✅ Save progress periodically during playback and on pause/leaving video
 * ✅ Minimum 5-second threshold and 95% completion exclusion
 * ✅ Safe initial load resume without overwriting positions with zero
 * ✅ Accessible resume toast ("Resumed from 02:35") with auto-fade
 * ✅ Boundary-clamped timeline hover timestamp preview tooltip
 * ✅ Mouse/pointer/touch hover tracking without altering playback position
 * ✅ Cleared saved position on video finish (ended)
 */

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SPEED_STORAGE_KEY = 'videoverse_playback_speed';
export const PLAYBACK_POSITIONS_STORAGE_KEY = 'videoverse_playback_positions';
export const SUBTITLE_STORAGE_KEY = 'videoverse_subtitle_preference';

export function isValidSubtitleTrack(track) {
  if (!track || typeof track !== 'object') return false;
  if (typeof track.src !== 'string' || typeof track.srclang !== 'string' || typeof track.label !== 'string') return false;
  const src = track.src.trim();
  const srclang = track.srclang.trim();
  const label = track.label.trim();
  if (!src || !srclang || !label) return false;

  // Reject dangerous protocols: javascript:, data:, vbscript:, etc.
  if (/^(javascript|data|vbscript):/i.test(src)) return false;

  // Accept relative paths starting with /subtitles/
  if (src.startsWith('/subtitles/')) return true;

  // Accept HTTPS URLs only (reject insecure http://, ftp:, etc.)
  try {
    const url = new URL(src, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getStoredSubtitlePreference() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(SUBTITLE_STORAGE_KEY);
      if (saved && typeof saved === 'string') {
        const trimmed = saved.trim();
        if (trimmed && trimmed.length <= 40 && !/[\r\n<>]/.test(trimmed)) {
          return trimmed;
        }
      }
    }
  } catch (err) {
    console.warn('Unable to read subtitle preference from localStorage:', err);
  }
  return 'off';
}

export function setStoredSubtitlePreference(pref) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = (typeof pref === 'string' && pref.trim()) ? pref.trim() : 'off';
      window.localStorage.setItem(SUBTITLE_STORAGE_KEY, val);
    }
  } catch (err) {
    console.warn('Unable to save subtitle preference to localStorage:', err);
  }
}

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

export function getStoredPlaybackPositions() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(PLAYBACK_POSITIONS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Unable to read playback positions from localStorage:', err);
  }
  return {};
}

export function getSavedPositionForVideo(videoId, duration) {
  if (!videoId) return null;
  const positions = getStoredPlaybackPositions();
  const rawPos = positions[videoId];
  if (typeof rawPos !== 'number' || isNaN(rawPos) || !isFinite(rawPos)) {
    return null;
  }
  // Must be at least 5 seconds
  if (rawPos < 5) return null;
  // Must be strictly below 95% completion if duration is known
  if (duration && duration > 0 && rawPos >= duration * 0.95) return null;
  return rawPos;
}

export function saveVideoPosition(videoId, time, duration) {
  if (!videoId || typeof time !== 'number' || isNaN(time) || !isFinite(time)) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const positions = getStoredPlaybackPositions();

    // Do not save positions below 5 seconds or >= 95% completion; clear if exists
    if (time < 5 || (duration && duration > 0 && time >= duration * 0.95)) {
      if (positions[videoId] !== undefined) {
        delete positions[videoId];
        window.localStorage.setItem(PLAYBACK_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
      }
      return;
    }

    positions[videoId] = Math.round(time * 10) / 10;
    window.localStorage.setItem(PLAYBACK_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch (err) {
    console.warn('Unable to save playback position to localStorage:', err);
  }
}

export function clearVideoPosition(videoId) {
  if (!videoId) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const positions = getStoredPlaybackPositions();
    if (positions[videoId] !== undefined) {
      delete positions[videoId];
      window.localStorage.setItem(PLAYBACK_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
    }
  } catch (err) {
    console.warn('Unable to clear playback position from localStorage:', err);
  }
}

export function formatResumeTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}

export function calculateHoverDetails(clientX, rect, duration) {
  if (!rect || rect.width <= 0) return { pct: 0, time: 0 };
  const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const pct = (offsetX / rect.width) * 100;
  const maxDur = duration > 0 ? duration : 0;
  const time = (pct / 100) * maxDur;
  return { pct, time };
}

export default function VideoPlayer({
  video,
  isTheaterMode: externalTheaterMode,
  onToggleTheaterMode,
  nextVideo,
  onPlayNext,
  onToast,
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const speedMenuRef = useRef(null);
  const subtitleMenuRef = useRef(null);
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

  // Phase 5.2: Theater Mode & Autoplay state
  const [internalTheaterMode, setInternalTheaterMode] = useState(false);
  const isTheaterMode = externalTheaterMode !== undefined ? externalTheaterMode : internalTheaterMode;

  const [autoplayActive, setAutoplayActive] = useState(false);
  const [autoplayCountdown, setAutoplayCountdown] = useState(5);
  const autoplayTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  // Phase 5.3: Resume Playback state & refs
  const [resumeToast, setResumeToast] = useState(null);
  const resumeToastTimerRef = useRef(null);
  const hasResumedRef = useRef(false);
  const lastSaveTimestampRef = useRef(0);

  // Phase 5.3: Timeline Hover Preview state
  const [showHoverPreview, setShowHoverPreview] = useState(false);
  const [hoverPct, setHoverPct] = useState(0);
  const [hoverTimeSec, setHoverTimeSec] = useState(null);

  // Phase 5.4: Subtitle & Caption state
  const [subtitlePreference, setSubtitlePreference] = useState(() => getStoredSubtitlePreference());
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [failedTracks, setFailedTracks] = useState(new Set());

  // Phase 2 Step 4: Adaptive HLS & Quality Selection State
  const [hlsSupported, setHlsSupported] = useState(false);
  const [availableQualities, setAvailableQualities] = useState([]); // [{ index: -1, name: 'Auto' }, { index: 0, name: '1080p', height: 1080 }]
  const [currentQualityIndex, setCurrentQualityIndex] = useState(-1); // -1 = Auto
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [hoverSpriteStyle, setHoverSpriteStyle] = useState(null);
  const hlsInstanceRef = useRef(null);
  const qualityMenuRef = useRef(null);
  const spriteVttDataRef = useRef([]); // [{ start, end, x, y, w, h }]

  // Filter valid subtitle tracks from video metadata
  const validSubtitles = Array.isArray(video?.subtitles)
    ? video.subtitles.filter(isValidSubtitleTrack)
    : [];

  // Available (unfailed) subtitle tracks
  const availableSubtitles = validSubtitles.filter(t => !failedTracks.has(t.src));
  const hasSubtitles = availableSubtitles.length > 0;

  // Resolved active subtitle language: preference if available in current video, otherwise 'off'
  const activeSubtitleLang = (subtitlePreference !== 'off' && availableSubtitles.some(t => t.srclang === subtitlePreference))
    ? subtitlePreference
    : 'off';

  const videoId = String(video?.id || video?._id || '');
  const primarySrc = videoId ? `/api/videos/${videoId}/stream` : (video?.videoUrl || '');

  const [currentSrc, setCurrentSrc] = useState(primarySrc);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const currentVideoIdRef = useRef(videoId);
  currentVideoIdRef.current = videoId;

  function handleToggleTheater() {
    if (onToggleTheaterMode) {
      onToggleTheaterMode();
    } else {
      setInternalTheaterMode(prev => !prev);
    }
  }

  const cancelAutoplay = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (autoplayTimerRef.current) {
      clearTimeout(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
    setAutoplayActive(false);
    setAutoplayCountdown(5);
  }, []);

  const playNextNow = useCallback(() => {
    cancelAutoplay();
    if (onPlayNext && nextVideo) {
      onPlayNext();
    }
  }, [cancelAutoplay, onPlayNext, nextVideo]);

  const startAutoplayCountdown = useCallback(() => {
    if (!nextVideo || !onPlayNext) return;
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);

    setAutoplayCountdown(5);
    setAutoplayActive(true);

    let remaining = 5;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setAutoplayCountdown(Math.max(0, remaining));
    }, 1000);

    autoplayTimerRef.current = setTimeout(() => {
      autoplayTimerRef.current = null;
      setAutoplayActive(false);
      onPlayNext();
    }, 5000);
  }, [nextVideo, onPlayNext]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
      if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current);
    };
  }, []);

  // Helper to save current progress for THIS specific video
  const saveCurrentProgress = useCallback(() => {
    if (!hasResumedRef.current || !videoRef.current || !currentVideoIdRef.current) return;
    const cur = videoRef.current.currentTime;
    const dur = (videoRef.current.duration && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
      ? videoRef.current.duration
      : durationSec;
    saveVideoPosition(currentVideoIdRef.current, cur, dur);
  }, [durationSec]);

  // Save progress on tab/window close
  useEffect(() => {
    function handleBeforeUnload() {
      saveCurrentProgress();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveCurrentProgress]);

  // Save progress on unmount specifically for THIS video instance
  useEffect(() => {
    return () => {
      if (videoRef.current && currentVideoIdRef.current) {
        const cur = videoRef.current.currentTime;
        const dur = (videoRef.current.duration && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
          ? videoRef.current.duration
          : durationSec;
        if (cur >= 5 && (!dur || cur < dur * 0.95)) {
          saveVideoPosition(currentVideoIdRef.current, cur, dur);
        }
      }
    };
  }, [durationSec]);

  // Attempt resume playback position safely on video load
  const attemptResume = useCallback((totalDuration) => {
    if (hasResumedRef.current || !videoId) return;
    hasResumedRef.current = true;

    const savedPos = getSavedPositionForVideo(videoId, totalDuration);
    if (savedPos !== null && savedPos >= 5) {
      if (videoRef.current) {
        videoRef.current.currentTime = savedPos;
      }
      setCurrentTimeSec(savedPos);
      if (totalDuration > 0) {
        setProgress((savedPos / totalDuration) * 100);
      }
      const formatted = formatResumeTime(savedPos);
      const toastMsg = `Resumed from ${formatted}`;
      setResumeToast(toastMsg);
      if (onToast) onToast(toastMsg);
      if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current);
      resumeToastTimerRef.current = setTimeout(() => {
        setResumeToast(null);
        resumeToastTimerRef.current = null;
      }, 3500);
    }
  }, [videoId, onToast]);

  // Load WebVTT Thumbnail Sprite Metadata if available
  useEffect(() => {
    spriteVttDataRef.current = [];
    if (!video?.thumbnailVttUrl) return;

    fetch(video.thumbnailVttUrl)
      .then(res => res.ok ? res.text() : '')
      .then(text => {
        if (!text || !text.includes('WEBVTT')) return;
        const cues = [];
        const lines = text.split('\n');
        let currentCue = null;

        lines.forEach(line => {
          const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
          if (timeMatch) {
            const start = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseInt(timeMatch[3], 10);
            const end = parseInt(timeMatch[5], 10) * 3600 + parseInt(timeMatch[6], 10) * 60 + parseInt(timeMatch[7], 10);
            currentCue = { start, end };
          } else if (currentCue && line.includes('#xywh=')) {
            const xywhMatch = line.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
            if (xywhMatch) {
              currentCue.x = parseInt(xywhMatch[1], 10);
              currentCue.y = parseInt(xywhMatch[2], 10);
              currentCue.w = parseInt(xywhMatch[3], 10);
              currentCue.h = parseInt(xywhMatch[4], 10);
              cues.push(currentCue);
              currentCue = null;
            }
          }
        });
        spriteVttDataRef.current = cues;
      })
      .catch(err => console.warn('[VideoPlayer] Failed to load thumbnail VTT:', err.message));
  }, [video?.thumbnailVttUrl]);

  // Initialize and attempt playback on video change or load (HLS + MP4 Fallback)
  useEffect(() => {
    cancelAutoplay();
    setHasError(false);
    setErrorMessage('');
    setProgress(0);
    setCurrentTimeSec(0);
    setIsBuffering(false);
    setShowSpeedMenu(false);
    setShowSubtitleMenu(false);
    setShowQualityMenu(false);
    setShowHoverPreview(false);
    setResumeToast(null);
    setFailedTracks(new Set());
    setAvailableQualities([]);
    setCurrentQualityIndex(-1);
    hasResumedRef.current = false;

    if (resumeToastTimerRef.current) {
      clearTimeout(resumeToastTimerRef.current);
      resumeToastTimerRef.current = null;
    }
    setDurationSec(parseDuration(video.duration) || 60);

    // Destroy previous HLS instance if any
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }

    const hlsUrl = video?.hlsMasterPlaylist;
    const fallbackSrc = videoId ? `/api/videos/${videoId}/stream` : (video?.videoUrl || '');

    let isMounted = true;

    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.playbackRate = playbackSpeed;

      // 1. Try HLS playback via Hls.js if hlsMasterPlaylist exists and Hls.isSupported()
      if (hlsUrl && Hls.isSupported()) {
        const hls = new Hls({
          capLevelToPlayerSize: true,
          autoStartLoad: true,
          startLevel: -1, // Auto
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(videoRef.current);

        hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
          if (!isMounted) return;
          setHlsSupported(true);
          const levels = (data.levels || []).map((lvl, index) => ({
            index,
            height: lvl.height,
            name: `${lvl.height}p`,
            bitrate: lvl.bitrate,
          }));

          // Sort descending: 1080p, 720p, etc.
          levels.sort((a, b) => b.height - a.height);
          setAvailableQualities([{ index: -1, name: 'Auto' }, ...levels]);
          setCurrentQualityIndex(-1);

          // Attempt play
          videoRef.current.play().then(() => {
            if (isMounted) setPlaying(true);
          }).catch(() => {
            if (isMounted) setPlaying(false);
          });
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('[Hls.js Fatal Error]', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                // Fallback to progressive MP4 stream
                hls.destroy();
                hlsInstanceRef.current = null;
                setHlsSupported(false);
                setCurrentSrc(fallbackSrc);
                if (videoRef.current) {
                  videoRef.current.src = fallbackSrc;
                  videoRef.current.load();
                }
                break;
            }
          }
        });

        hlsInstanceRef.current = hls;
      } else if (hlsUrl && videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari / iOS)
        videoRef.current.src = hlsUrl;
        setHlsSupported(true);
        videoRef.current.load();
        videoRef.current.play().then(() => {
          if (isMounted) setPlaying(true);
        }).catch(() => {
          if (isMounted) setPlaying(false);
        });
      } else {
        // Fallback to standard HTTP stream
        setHlsSupported(false);
        setCurrentSrc(fallbackSrc);
        videoRef.current.src = fallbackSrc;
        videoRef.current.load();
        videoRef.current.play().then(() => {
          if (isMounted) setPlaying(true);
        }).catch(() => {
          if (isMounted) setPlaying(false);
        });
      }
    }

    return () => {
      isMounted = false;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
  }, [videoId, video?.videoUrl, video?.hlsMasterPlaylist, video?.duration, playbackSpeed, cancelAutoplay]);

  // Synchronize playback rate on video element whenever playbackSpeed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, currentSrc]);

  // Auto-hide controls when playing (paused while speed, subtitle or quality menu is open)
  useEffect(() => {
    if (playing && !showSpeedMenu && !showSubtitleMenu && !showQualityMenu) {
      resetHideTimer();
    } else {
      clearTimeout(hideControlsTimer.current);
      setShowControls(true);
    }
    return () => clearTimeout(hideControlsTimer.current);
  }, [playing, showSpeedMenu, showSubtitleMenu, showQualityMenu]);

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

  // Close quality menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(event.target)) {
        setShowQualityMenu(false);
      }
    }
    if (showQualityMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showQualityMenu]);

  // Handler for Quality selection (Auto or manual resolution)
  const handleSelectQuality = useCallback((index) => {
    setCurrentQualityIndex(index);
    setShowQualityMenu(false);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.currentLevel = index; // -1 for Auto, or level index
    }
  }, []);

  // Apply active subtitle track on HTML5 video element without disrupting playback
  const applySubtitleTrack = useCallback((targetLang) => {
    if (!videoRef.current || !videoRef.current.textTracks) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (targetLang !== 'off' && (track.language === targetLang || track.label === targetLang)) {
        track.mode = 'showing';
      } else {
        track.mode = 'disabled';
      }
    }
  }, []);

  // Sync subtitle tracks when active language or source changes
  useEffect(() => {
    applySubtitleTrack(activeSubtitleLang);
  }, [activeSubtitleLang, applySubtitleTrack, currentSrc]);

  const handleSelectSubtitle = useCallback((lang) => {
    setSubtitlePreference(lang);
    setStoredSubtitlePreference(lang);
    applySubtitleTrack(lang);
    setShowSubtitleMenu(false);
  }, [applySubtitleTrack]);

  const toggleSubtitlesShortcut = useCallback(() => {
    if (availableSubtitles.length === 0) return;
    if (activeSubtitleLang === 'off') {
      const preferred = availableSubtitles.find(t => t.srclang === subtitlePreference);
      const nextLang = preferred ? preferred.srclang : availableSubtitles[0].srclang;
      handleSelectSubtitle(nextLang);
    } else {
      handleSelectSubtitle('off');
    }
  }, [availableSubtitles, activeSubtitleLang, subtitlePreference, handleSelectSubtitle]);

  const handleTrackError = useCallback((failedTrack) => {
    console.warn(`Subtitle track failed to load: ${failedTrack?.src}`);
    if (!failedTrack?.src) return;
    setFailedTracks(prev => {
      const next = new Set(prev);
      next.add(failedTrack.src);
      return next;
    });

    if (activeSubtitleLang === failedTrack.srclang) {
      applySubtitleTrack('off');
      setSubtitlePreference('off');
      setStoredSubtitlePreference('off');
      if (onToast) {
        onToast('Subtitles unavailable for this track');
      }
    }
  }, [activeSubtitleLang, applySubtitleTrack, onToast]);

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
    const dur = (videoRef.current.duration && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
      ? videoRef.current.duration
      : (durationSec || 1);
    setCurrentTimeSec(curr);
    setProgress(dur > 0 ? (curr / dur) * 100 : 0);

    // Periodically save playback progress during active playback (throttled to every 3.5s)
    const now = Date.now();
    if (hasResumedRef.current && playing && now - lastSaveTimestampRef.current >= 3500) {
      lastSaveTimestampRef.current = now;
      if (videoId) {
        saveVideoPosition(videoId, curr, dur);
      }
    }
  }, [durationSec, playing, videoId]);

  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    const dur = videoRef.current.duration;
    if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
      setDurationSec(dur);
      attemptResume(dur);
    } else {
      attemptResume(durationSec);
    }
    videoRef.current.playbackRate = playbackSpeed;
    applySubtitleTrack(activeSubtitleLang);
    setHasError(false);
  }, [playbackSpeed, attemptResume, durationSec, applySubtitleTrack, activeSubtitleLang]);

  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
    if (!hasResumedRef.current) {
      const dur = (videoRef.current && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
        ? videoRef.current.duration
        : durationSec;
      if (dur > 0) {
        attemptResume(dur);
      }
    }
  }, [attemptResume, durationSec]);

  const handleWaiting = () => setIsBuffering(true);
  const handlePlaying = () => {
    setIsBuffering(false);
    setPlaying(true);
    setHasError(false);
  };
  const handlePause = () => {
    setPlaying(false);
    saveCurrentProgress();
  };
  const handleEnded = () => {
    setPlaying(false);
    setProgress(100);
    if (videoId) {
      clearVideoPosition(videoId);
    }
    const dur = (videoRef.current && isFinite(videoRef.current.duration)) ? videoRef.current.duration : durationSec;
    if (nextVideo && onPlayNext && dur > 3) {
      startAutoplayCountdown();
    }
  };

  const handleVideoError = useCallback(() => {
    setIsBuffering(false);
    setPlaying(false);
    const mediaErr = videoRef.current?.error;
    let detail = 'The video stream could not be loaded.';
    if (mediaErr) {
      if (mediaErr.code === 1) detail = 'Video loading aborted by user.';
      if (mediaErr.code === 2) detail = 'Network error while loading video stream.';
      if (mediaErr.code === 3) detail = 'Video decoding failed or media corrupted.';
      if (mediaErr.code === 4) detail = 'Media format not supported or stream unreachable.';
    }

    // If backend streaming failed, try direct video source URL as secondary resolution
    if (currentSrc !== video.videoUrl && video.videoUrl) {
      console.warn(`[VideoPlayer] Backend stream for ${videoId} failed, attempting direct source URL.`);
      setCurrentSrc(video.videoUrl);
      if (videoRef.current) {
        videoRef.current.src = video.videoUrl;
        videoRef.current.load();
        const p = videoRef.current.play();
        if (p !== undefined) p.catch(() => {});
      }
      return;
    }

    setHasError(true);
    setErrorMessage(detail);
  }, [currentSrc, video.videoUrl, videoId]);

  const handleRetry = useCallback(() => {
    setHasError(false);
    setErrorMessage('');
    const retrySrc = videoId ? `/api/videos/${videoId}/stream` : video.videoUrl;
    setCurrentSrc(retrySrc);
    if (videoRef.current) {
      videoRef.current.src = retrySrc;
      videoRef.current.load();
      const p = videoRef.current.play();
      if (p !== undefined) {
        p.then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    }
  }, [videoId, video.videoUrl]);

  // Controls Handlers
  function togglePlay() {
    if (autoplayActive) {
      cancelAutoplay();
    }
    if (hasError) {
      handleRetry();
      return;
    }
    if (!videoRef.current) return;

    if (videoRef.current.paused || videoRef.current.ended) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setPlaying(true))
          .catch((err) => {
            console.warn('Playback request was prevented:', err);
            setPlaying(false);
          });
      }
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  }

  function handleProgressClick(e) {
    if (autoplayActive) {
      cancelAutoplay();
    }
    if (hasError || !videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = e.clientX - rect.left;
    const pct = Math.min(100, Math.max(0, (clickX / rect.width) * 100));
    const maxDur = (videoRef.current && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
      ? videoRef.current.duration
      : durationSec;
    const newTime = maxDur > 0 ? Math.max(0, Math.min(maxDur, (pct / 100) * maxDur)) : 0;
    videoRef.current.currentTime = newTime;
    setProgress(maxDur > 0 ? (newTime / maxDur) * 100 : 0);
    setCurrentTimeSec(newTime);
  }

  // Timeline Hover Preview handlers
  const handleProgressHover = useCallback((clientX, currentTarget) => {
    if (hasError || !currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const maxDur = (videoRef.current && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
      ? videoRef.current.duration
      : durationSec;

    if (maxDur <= 0) {
      setShowHoverPreview(false);
      return;
    }

    const { pct, time } = calculateHoverDetails(clientX, rect, maxDur);
    setHoverPct(pct);
    setHoverTimeSec(time);
    setShowHoverPreview(true);

    // Calculate sprite sheet background position if VTT cues exist
    if (spriteVttDataRef.current && spriteVttDataRef.current.length > 0 && video?.thumbnailSpriteUrl) {
      const cue = spriteVttDataRef.current.find(c => time >= c.start && time < c.end);
      if (cue) {
        setHoverSpriteStyle({
          backgroundImage: `url(${video.thumbnailSpriteUrl})`,
          backgroundPosition: `-${cue.x}px -${cue.y}px`,
          width: `${cue.w}px`,
          height: `${cue.h}px`,
        });
      } else {
        setHoverSpriteStyle(null);
      }
    } else {
      setHoverSpriteStyle(null);
    }
  }, [hasError, durationSec, video?.thumbnailSpriteUrl]);

  function handleProgressMouseMove(e) {
    handleProgressHover(e.clientX, e.currentTarget);
  }

  function handleProgressMouseEnter(e) {
    handleProgressHover(e.clientX, e.currentTarget);
  }

  function handleProgressMouseLeave() {
    setShowHoverPreview(false);
  }

  function handleProgressTouchMove(e) {
    if (e.touches && e.touches[0]) {
      handleProgressHover(e.touches[0].clientX, e.currentTarget);
    }
  }

  function handleProgressTouchEnd() {
    setShowHoverPreview(false);
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
    if (autoplayActive) {
      cancelAutoplay();
    }
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
    // If typing in input, textarea, select, or contentEditable element, don't trigger shortcuts
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) return;

    // If speed or subtitle menu is open, handle Escape or allow clicking/navigating menu
    if (e.target && e.target.closest && e.target.closest('.video-player__speed-menu')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSpeedMenu(false);
      }
      return;
    }
    if (e.target && e.target.closest && e.target.closest('.video-player__subtitle-menu')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSubtitleMenu(false);
      }
      return;
    }

    if (e.key === 'Escape' && autoplayActive) {
      e.preventDefault();
      cancelAutoplay();
      return;
    }

    if (e.key === ' ' || e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
    if (e.key === 'm' || e.key === 'M') { toggleMute(); }
    if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTheater();
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      toggleSubtitlesShortcut();
      return;
    }
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
    if (e.key === 'Escape' && (showSpeedMenu || showSubtitleMenu || showQualityMenu)) {
      e.preventDefault();
      setShowSpeedMenu(false);
      setShowSubtitleMenu(false);
      setShowQualityMenu(false);
    }
  }

  const effectiveDur = (videoRef.current && isFinite(videoRef.current.duration) && videoRef.current.duration > 0)
    ? videoRef.current.duration
    : durationSec;
  const formattedCurrentTime = formatTime(currentTimeSec);
  const formattedTotalTime = formatTime(effectiveDur);
  const remainingSec = Math.max(0, effectiveDur - currentTimeSec);
  const formattedRemainingTime = `-${formatTime(remainingSec)}`;
  const displayedTimeString = showRemainingTime
    ? `${formattedCurrentTime} / ${formattedRemainingTime}`
    : `${formattedCurrentTime} / ${formattedTotalTime}`;

  return (
    <div
      ref={containerRef}
      className={`video-player ${isTheaterMode ? 'video-player--theater' : ''} ${showControls ? 'video-player--controls-visible' : ''} ${hasError ? 'video-player--error' : ''}`}
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
        onCanPlay={handleCanPlay}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleVideoError}
        className="video-player__media"
        aria-hidden="true"
      >
        {validSubtitles.map((track) => (
          <track
            key={`${track.srclang}-${track.src}`}
            kind="subtitles"
            src={track.src}
            srcLang={track.srclang}
            label={track.label}
            onError={() => handleTrackError(track)}
          />
        ))}
      </video>

      {/* Surface Gradient / Poster background if not loaded */}
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
          <span className="badge badge--brand">
            <span className="video-player__status-dot" aria-hidden="true" />
            HTML5 Video Stream Active
          </span>
        ) : (
          <span className="badge badge--error">
            <AlertTriangle size={12} style={{ marginRight: 4 }} />
            Stream Error
          </span>
        )}
      </div>

      {/* Phase 5.3: Resume Playback Toast */}
      {resumeToast && (
        <div
          className="video-player__resume-toast animate-fade-in"
          role="status"
          aria-live="polite"
          id="player-resume-toast"
        >
          <Clock size={14} className="video-player__resume-icon" aria-hidden="true" />
          <span>{resumeToast}</span>
        </div>
      )}

      {/* Buffering Spinner */}
      {isBuffering && !hasError && (
        <div className="video-player__buffering" aria-label="Loading video stream">
          <Loader2 size={44} className="video-player__spin" />
        </div>
      )}

      {/* Big Play Overlay (when paused or ended and not autoplaying) */}
      {!playing && !hasError && !isBuffering && !autoplayActive && (
        <div className="video-player__big-play animate-fade-in" aria-hidden="true">
          <div className="video-player__big-play-btn">
            <Play size={46} fill="white" strokeWidth={0} />
          </div>
        </div>
      )}

      {/* Autoplay Next Overlay (when video ends and next video exists) */}
      {autoplayActive && nextVideo && (
        <div
          className="video-player__autoplay-overlay animate-fade-in"
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-label={`Up next: ${nextVideo.title}`}
          id="player-autoplay-overlay"
        >
          <div className="video-player__autoplay-card glass">
            <div className="video-player__autoplay-header">
              <span className="video-player__autoplay-tag">Up Next</span>
              <span className="video-player__autoplay-countdown" id="player-autoplay-countdown">
                Playing in {autoplayCountdown}s
              </span>
            </div>

            <div className="video-player__autoplay-bar">
              <div
                className="video-player__autoplay-bar-fill"
                style={{ width: `${(autoplayCountdown / 5) * 100}%` }}
              />
            </div>

            <div className="video-player__autoplay-video-info">
              {nextVideo.thumbnailUrl ? (
                <img
                  src={nextVideo.thumbnailUrl}
                  alt={nextVideo.title}
                  className="video-player__autoplay-thumb"
                />
              ) : (
                <div
                  className="video-player__autoplay-thumb video-player__autoplay-thumb--fallback"
                  style={getThumbnailStyle(nextVideo.thumbnailIndex || 0)}
                />
              )}
              <div className="video-player__autoplay-details">
                <span className="video-player__autoplay-title">{nextVideo.title}</span>
                <span className="video-player__autoplay-channel">
                  {nextVideo.channel?.name || 'VideoVerse Creator'}
                </span>
              </div>
            </div>

            <div className="video-player__autoplay-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={cancelAutoplay}
                id="player-autoplay-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={playNextNow}
                id="player-autoplay-play-btn"
              >
                <Play size={14} fill="currentColor" />
                Play Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Overlay if stream fails */}
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
            <p>{errorMessage || 'The requested video stream could not be loaded.'}</p>
            <div className="video-player__fallback-actions">
              <button
                className="btn btn--primary btn--sm"
                onClick={handleRetry}
                id="player-retry-btn"
              >
                <RefreshCw size={14} />
                Retry Video
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Controls Bar */}
      <div
        className="video-player__controls"
        onClick={e => e.stopPropagation()}
        aria-label="Video controls"
      >
        {/* Progress bar with interactive scrubbing & hover timestamp preview */}
        <div
          className="video-player__progress"
          onClick={handleProgressClick}
          onMouseMove={handleProgressMouseMove}
          onMouseEnter={handleProgressMouseEnter}
          onMouseLeave={handleProgressMouseLeave}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
          onTouchCancel={handleProgressTouchEnd}
          role="slider"
          aria-label="Video progress scrubber"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${formatTime(currentTimeSec)} of ${formatTime(durationSec)}`}
          tabIndex={0}
          id="video-progress-bar"
        >
          {showHoverPreview && hoverTimeSec !== null && durationSec > 0 && !hasError && (
            <div
              className={`video-player__hover-preview ${hoverSpriteStyle ? 'video-player__hover-preview--with-thumb' : ''}`}
              style={{ left: `clamp(40px, ${hoverPct}%, calc(100% - 40px))` }}
              aria-hidden="true"
              id="player-hover-preview"
            >
              {hoverSpriteStyle && (
                <div
                  className="video-player__hover-thumb"
                  style={hoverSpriteStyle}
                />
              )}
              <span className="video-player__hover-time">{formatTime(hoverTimeSec)}</span>
            </div>
          )}

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
            {/* Subtitles (Closed Captions) Control */}
            <div className="video-player__subtitle-wrapper" ref={subtitleMenuRef}>
              <button
                type="button"
                className={`video-player__btn video-player__subtitle-btn ${activeSubtitleLang !== 'off' ? 'video-player__btn--active' : ''} ${!hasSubtitles ? 'video-player__btn--disabled' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!hasSubtitles) return;
                  setShowSubtitleMenu(prev => !prev);
                }}
                disabled={!hasSubtitles}
                aria-label={
                  !hasSubtitles
                    ? 'No subtitles available'
                    : activeSubtitleLang === 'off'
                      ? 'Subtitles (Captions) Off (C)'
                      : `Subtitles: ${availableSubtitles.find(t => t.srclang === activeSubtitleLang)?.label || activeSubtitleLang} (C)`
                }
                aria-haspopup="true"
                aria-expanded={showSubtitleMenu}
                aria-pressed={activeSubtitleLang !== 'off'}
                title={
                  !hasSubtitles
                    ? 'No subtitles available'
                    : activeSubtitleLang === 'off'
                      ? 'Turn on subtitles (C)'
                      : 'Subtitles settings (C)'
                }
                id="player-subtitles-btn"
              >
                <Subtitles size={17} />
              </button>

              {showSubtitleMenu && hasSubtitles && (
                <div
                  className="video-player__subtitle-menu animate-fade-in"
                  role="menu"
                  aria-label="Subtitle and Closed Caption options"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="video-player__subtitle-header">Subtitles / CC</div>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={activeSubtitleLang === 'off'}
                    className={`video-player__subtitle-item ${activeSubtitleLang === 'off' ? 'video-player__subtitle-item--active' : ''}`}
                    onClick={() => handleSelectSubtitle('off')}
                    id="player-subtitle-opt-off"
                  >
                    <span className="video-player__subtitle-check">
                      {activeSubtitleLang === 'off' ? <Check size={14} /> : null}
                    </span>
                    <span className="video-player__subtitle-text">Off</span>
                  </button>
                  {availableSubtitles.map((track) => {
                    const isSelected = activeSubtitleLang === track.srclang;
                    return (
                      <button
                        key={track.srclang}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        className={`video-player__subtitle-item ${isSelected ? 'video-player__subtitle-item--active' : ''}`}
                        onClick={() => handleSelectSubtitle(track.srclang)}
                        id={`player-subtitle-opt-${track.srclang}`}
                      >
                        <span className="video-player__subtitle-check">
                          {isSelected ? <Check size={14} /> : null}
                        </span>
                        <span className="video-player__subtitle-text">{track.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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

            {/* Quality Selection Menu */}
            {hlsSupported && availableQualities.length > 0 && (
              <div className="video-player__quality-wrapper" ref={qualityMenuRef}>
                <button
                  type="button"
                  className={`video-player__btn video-player__quality-btn ${showQualityMenu ? 'video-player__btn--active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQualityMenu(prev => !prev);
                  }}
                  aria-label={`Video quality: ${availableQualities.find(q => q.index === currentQualityIndex)?.name || 'Auto'}`}
                  aria-haspopup="true"
                  aria-expanded={showQualityMenu}
                  title="Video Quality"
                  id="player-quality-btn"
                >
                  <Settings size={17} />
                </button>

                {showQualityMenu && (
                  <div
                    className="video-player__quality-menu animate-fade-in"
                    role="menu"
                    aria-label="Quality options"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="video-player__quality-header">Quality</div>
                    {availableQualities.map((q) => {
                      const isSelected = q.index === currentQualityIndex;
                      return (
                        <button
                          key={q.index}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          className={`video-player__quality-item ${isSelected ? 'video-player__quality-item--active' : ''}`}
                          onClick={() => handleSelectQuality(q.index)}
                          id={`player-quality-opt-${q.name.toLowerCase()}`}
                        >
                          <span className="video-player__quality-check">
                            {isSelected ? <Check size={14} /> : null}
                          </span>
                          <span className="video-player__quality-text">{q.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Theater Mode Button */}
            <button
              type="button"
              className={`video-player__btn video-player__theater-btn ${isTheaterMode ? 'video-player__btn--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleTheater();
              }}
              aria-label={isTheaterMode ? 'Exit theater mode (T)' : 'Theater mode (T)'}
              aria-pressed={isTheaterMode}
              title={isTheaterMode ? 'Default view (T)' : 'Theater mode (T)'}
              id="player-theater-btn"
            >
              <RectangleHorizontal size={17} />
            </button>

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
              aria-label={fullscreen ? 'Exit fullscreen' : 'Toggle fullscreen'}
              title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
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
