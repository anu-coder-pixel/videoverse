/**
 * VideoVerse — App Context
 *
 * Manages global UI state: sidebar, current page/video, search, category, theme.
 * Fetches the video list from the Express backend (falls back to local data if offline).
 * Persists user actions (Like, Save/Watch Later, Dislike, Subscriptions, Watch History)
 * into browser localStorage so that selections survive page refreshes and reloads.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useVideos } from '../hooks/useVideos';
import { MOCK_VIDEOS } from '../data/mockData';

const AppContext = createContext(null);

// ── Persistent Storage Keys ──────────────────────────────────────────────────
export const STORAGE_KEYS = {
  LIKED: 'videoverse_liked_videos',
  SAVED: 'videoverse_saved_videos',
  DISLIKED: 'videoverse_disliked_videos',
  SUBSCRIBED: 'videoverse_subscribed_channels',
  HISTORY: 'videoverse_watch_history',
  CURRENT_VIDEO_ID: 'videoverse_current_video_id',
  CURRENT_PAGE: 'videoverse_current_page',
  THEME_PREFERENCE: 'videoverse_theme_preference',
};

/**
 * Calculates current theme based on Indian Standard Time (UTC+05:30).
 * Rule: 05:00:00 inclusive to 12:00:00 exclusive is 'light'; otherwise 'dark'.
 */
export function calculateIstTheme() {
  const now = new Date();
  const utcMillis = now.getTime() + now.getTimezoneOffset() * 60000;
  const istMillis = utcMillis + 5.5 * 3600000;
  const istDate = new Date(istMillis);
  const minutes = istDate.getHours() * 60 + istDate.getMinutes();
  return (minutes >= 300 && minutes < 720) ? 'light' : 'dark';
}

/**
 * Safely loads a Set of string IDs from localStorage.
 * Handles missing keys, malformed JSON, non-array types, and invalid IDs.
 * Automatically deduplicates items.
 */
function loadSetFromStorage(key, fallback = []) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return new Set(fallback);
    }
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return new Set(fallback);
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const validStrings = parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
      return new Set(validStrings);
    }
  } catch (err) {
    console.warn(`[VideoVerse] Error loading localStorage key "${key}":`, err);
  }
  return new Set(fallback);
}

/**
 * Safely writes a Set or Array of string IDs to localStorage as a JSON array.
 * Ensures deduplication and ignores empty or invalid items.
 */
function saveSetToStorage(key, setOrArray) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const array = Array.isArray(setOrArray) ? setOrArray : Array.from(setOrArray || []);
    const uniqueClean = Array.from(
      new Set(array.filter(item => typeof item === 'string' && item.trim().length > 0))
    );
    localStorage.setItem(key, JSON.stringify(uniqueClean));
  } catch (err) {
    console.warn(`[VideoVerse] Error saving to localStorage key "${key}":`, err);
  }
}

/**
 * Safely loads an ordered array of IDs from localStorage (used for history).
 */
function loadArrayFromStorage(key, fallback = []) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return fallback;
    }
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const unique = [];
      for (const id of parsed) {
        if (typeof id === 'string' && id.trim().length > 0 && !unique.includes(id)) {
          unique.push(id);
        }
      }
      return unique;
    }
  } catch (err) {
    console.warn(`[VideoVerse] Error loading array from localStorage "${key}":`, err);
  }
  return fallback;
}

/**
 * Safely writes an ordered array of IDs to localStorage.
 */
function saveArrayToStorage(key, array) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const unique = [];
    if (Array.isArray(array)) {
      for (const id of array) {
        if (typeof id === 'string' && id.trim().length > 0 && !unique.includes(id)) {
          unique.push(id);
        }
      }
    }
    localStorage.setItem(key, JSON.stringify(unique));
  } catch (err) {
    console.warn(`[VideoVerse] Error saving array to localStorage "${key}":`, err);
  }
}

/**
 * Resolves the initial page and video on initial load or browser refresh.
 * Checks URL search params (?watch= or ?v=) first, then falls back to localStorage.
 */
function getInitialNavigationState() {
  if (typeof window === 'undefined') {
    return { page: 'home', video: null };
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const watchId = params.get('watch') || params.get('v') ||
      (localStorage.getItem(STORAGE_KEYS.CURRENT_PAGE) === 'watch' ? localStorage.getItem(STORAGE_KEYS.CURRENT_VIDEO_ID) : null);

    if (watchId) {
      const found = MOCK_VIDEOS.find(v => v.id === watchId);
      if (found) {
        return { page: 'watch', video: found };
      }
    }
  } catch (err) {
    console.warn('[VideoVerse] Failed to determine initial navigation state:', err);
  }
  return { page: 'home', video: null };
}

export function AppProvider({ children }) {
  // ── Fetch videos from backend (with local fallback) ─────────────────────
  const { videos, loading: videosLoading, usingFallback } = useVideos();

  // ── Navigation state with refresh/reopen persistence ────────────────────
  const initialNav = getInitialNavigationState();
  const [currentPage, setCurrentPage] = useState(initialNav.page); // 'home' | 'watch'
  const [selectedVideo, setSelectedVideo] = useState(initialNav.video);

  // Sync selectedVideo with live API dataset once videos finish loading
  useEffect(() => {
    if (selectedVideo && Array.isArray(videos) && videos.length > 0) {
      const liveMatch = videos.find(v => v.id === selectedVideo.id);
      if (liveMatch && liveMatch !== selectedVideo) {
        setSelectedVideo(liveMatch);
      }
    }
  }, [videos, selectedVideo]);

  // Handle browser Back/Forward navigation (popstate)
  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const watchId = params.get('watch') || params.get('v');
      if (watchId) {
        const pool = (Array.isArray(videos) && videos.length > 0) ? videos : MOCK_VIDEOS;
        const found = pool.find(v => v.id === watchId);
        if (found) {
          setSelectedVideo(found);
          setCurrentPage('watch');
          return;
        }
      }
      setSelectedVideo(null);
      setCurrentPage('home');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [videos]);

  // ── Sidebar view / special section ──────────────────────────────────
  // 'all' | 'trending' | 'subscriptions' | 'history' | 'watch-later' | 'liked' | 'channel'
  const [currentView, setCurrentView] = useState('all');
  const [activeChannelFilter, setActiveChannelFilter] = useState(null);

  // ── Sidebar collapse/open state ──────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Search & Filter state ───────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  // ── Persistent Social & Activity state (Saved across page reloads) ───
  const [subscribedChannels, setSubscribedChannels] = useState(() =>
    loadSetFromStorage(STORAGE_KEYS.SUBSCRIBED, ['ch-001', 'ch-003'])
  );
  const [likedVideos, setLikedVideos] = useState(() =>
    loadSetFromStorage(STORAGE_KEYS.LIKED, ['vid-001'])
  );
  const [dislikedVideos, setDislikedVideos] = useState(() =>
    loadSetFromStorage(STORAGE_KEYS.DISLIKED, [])
  );
  const [watchLater, setWatchLater] = useState(() =>
    loadSetFromStorage(STORAGE_KEYS.SAVED, [])
  );
  const [watchHistory, setWatchHistory] = useState(() =>
    loadArrayFromStorage(STORAGE_KEYS.HISTORY, ['vid-001', 'vid-002'])
  );

  // ── User Authentication & Profiles (Task 4) ──────────────────────────
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // ── Theme State & IST Automatic Rules (Task 4) ────────────────────────
  const [themePreference, setThemePreference] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.THEME_PREFERENCE) || 'auto';
  });
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME_PREFERENCE) || 'auto';
    return saved === 'auto' ? calculateIstTheme() : saved;
  });

  // Apply data-theme attribute on document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Periodic IST evaluation: automatically changes theme at 5 AM & 12 PM IST
  useEffect(() => {
    if (themePreference !== 'auto') return;
    const interval = setInterval(() => {
      const autoTheme = calculateIstTheme();
      setTheme(prev => (prev !== autoTheme ? autoTheme : prev));
    }, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [themePreference]);

  // ── Subscription & Payment (Task 3) ──────────────────────────────────
  const [paymentLoading, setPaymentLoading] = useState(false);

  const openAuthModal = useCallback(() => setAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setAuthModalOpen(false), []);

  // ── Toast notification for user actions ──────────────────────────────
  const [appToast, setAppToast] = useState(null);

  const showToast = useCallback((message, duration = 3000) => {
    setAppToast(message);
    setTimeout(() => {
      setAppToast(null);
    }, duration);
  }, []);

  // Update theme preference (auto, light, dark) and sync with MongoDB profile
  const updateThemePreference = useCallback(async (newPref) => {
    if (!['auto', 'light', 'dark'].includes(newPref)) return;
    setThemePreference(newPref);
    localStorage.setItem(STORAGE_KEYS.THEME_PREFERENCE, newPref);

    const resolved = newPref === 'auto' ? calculateIstTheme() : newPref;
    setTheme(resolved);

    if (currentUser) {
      try {
        await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ themePreference: newPref }),
          credentials: 'include',
        });
      } catch (err) {
        console.warn('[AppContext] Failed to sync theme preference:', err.message);
      }
    }
    showToast(`Appearance: ${newPref === 'auto' ? `Auto IST (${resolved.toUpperCase()})` : newPref.toUpperCase()}`);
  }, [currentUser, showToast]);

  // Check existing session via HTTP-only cookie on application mount
  useEffect(() => {
    let isMounted = true;
    async function checkAuthSession() {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.user) {
            setCurrentUser(data.user);
            if (data.resolvedTheme) setTheme(data.resolvedTheme);
            if (data.user.themePreference) setThemePreference(data.user.themePreference);

            // Sync MongoDB activity state
            if (Array.isArray(data.user.likedVideos)) {
              setLikedVideos(new Set(data.user.likedVideos));
            }
            if (Array.isArray(data.user.dislikedVideos)) {
              setDislikedVideos(new Set(data.user.dislikedVideos));
            }
            if (Array.isArray(data.user.watchLater)) {
              setWatchLater(new Set(data.user.watchLater));
            }
            if (Array.isArray(data.user.subscribedChannels)) {
              setSubscribedChannels(new Set(data.user.subscribedChannels));
            }
            if (Array.isArray(data.user.watchHistory)) {
              setWatchHistory(data.user.watchHistory);
            }
          }
        }
      } catch (err) {
        console.warn('[AppContext] Session check skipped or offline:', err.message);
      } finally {
        if (isMounted) setAuthLoading(false);
      }
    }
    checkAuthSession();
    return () => { isMounted = false; };
  }, []);

  // Sign in with email & password, safely handling step-up OTP if untrusted device
  const login = useCallback(async (email, password) => {
    try {
      const guestData = {
        likedVideos: Array.from(likedVideos),
        dislikedVideos: Array.from(dislikedVideos),
        watchLater: Array.from(watchLater),
        watchHistory: watchHistory,
        subscribedChannels: Array.from(subscribedChannels),
      };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, guestData }),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign in');
      }

      // If untrusted device, return OTP step-up challenge
      if (data.requiresOtp) {
        return {
          success: true,
          requiresOtp: true,
          tempToken: data.tempToken,
          sessionId: data.sessionId,
          destinationMasked: data.destinationMasked,
          expiresIn: data.expiresIn,
          resendAvailableIn: data.resendAvailableIn,
        };
      }

      setCurrentUser(data.user);
      if (data.resolvedTheme) setTheme(data.resolvedTheme);
      if (data.user.themePreference) setThemePreference(data.user.themePreference);

      if (Array.isArray(data.user.likedVideos)) setLikedVideos(new Set(data.user.likedVideos));
      if (Array.isArray(data.user.dislikedVideos)) setDislikedVideos(new Set(data.user.dislikedVideos));
      if (Array.isArray(data.user.watchLater)) setWatchLater(new Set(data.user.watchLater));
      if (Array.isArray(data.user.subscribedChannels)) setSubscribedChannels(new Set(data.user.subscribedChannels));
      if (Array.isArray(data.user.watchHistory)) setWatchHistory(data.user.watchHistory);

      showToast(`Welcome back, ${data.user.name}!`);
      setAuthModalOpen(false);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [likedVideos, dislikedVideos, watchLater, watchHistory, subscribedChannels, showToast]);

  // Complete Step-Up OTP Verification
  const verifyOtp = useCallback(async (tempToken, otp, deviceName) => {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ otp, deviceName }),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Failed to verify code',
          attemptsRemaining: data.attemptsRemaining,
          code: data.code,
        };
      }

      setCurrentUser(data.user);
      if (data.resolvedTheme) setTheme(data.resolvedTheme);
      if (data.user.themePreference) setThemePreference(data.user.themePreference);

      if (Array.isArray(data.user.likedVideos)) setLikedVideos(new Set(data.user.likedVideos));
      if (Array.isArray(data.user.dislikedVideos)) setDislikedVideos(new Set(data.user.dislikedVideos));
      if (Array.isArray(data.user.watchLater)) setWatchLater(new Set(data.user.watchLater));
      if (Array.isArray(data.user.subscribedChannels)) setSubscribedChannels(new Set(data.user.subscribedChannels));
      if (Array.isArray(data.user.watchHistory)) setWatchHistory(data.user.watchHistory);

      showToast(`Device verified! Welcome back, ${data.user.name}!`);
      setAuthModalOpen(false);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [showToast]);

  // Resend OTP code adhering to 60s cooldown
  const resendOtp = useCallback(async (tempToken) => {
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Failed to resend code',
          canResendIn: data.canResendIn,
        };
      }

      showToast(data.message || 'A new verification code has been sent.');
      return {
        success: true,
        sessionId: data.sessionId,
        message: data.message,
        resendAvailableIn: data.resendAvailableIn || 60,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [showToast]);

  // Development-only OTP helper: retrieves current OTP for local dev testing
  const getDevLastOtp = useCallback(async (tempToken) => {
    try {
      const res = await fetch('/api/auth/dev/last-otp', {
        headers: { Authorization: `Bearer ${tempToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, otp: data.otp };
      }
    } catch (err) {
      // Ignore in production or offline
    }
    return { success: false };
  }, []);

  // Register new account, safely merging guest activity into the account
  const register = useCallback(async (name, email, password) => {
    try {
      const guestData = {
        likedVideos: Array.from(likedVideos),
        dislikedVideos: Array.from(dislikedVideos),
        watchLater: Array.from(watchLater),
        watchHistory: watchHistory,
        subscribedChannels: Array.from(subscribedChannels),
      };

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, guestData }),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create account');
      }

      setCurrentUser(data.user);
      if (data.resolvedTheme) setTheme(data.resolvedTheme);
      if (data.user.themePreference) setThemePreference(data.user.themePreference);

      if (Array.isArray(data.user.likedVideos)) setLikedVideos(new Set(data.user.likedVideos));
      if (Array.isArray(data.user.dislikedVideos)) setDislikedVideos(new Set(data.user.dislikedVideos));
      if (Array.isArray(data.user.watchLater)) setWatchLater(new Set(data.user.watchLater));
      if (Array.isArray(data.user.subscribedChannels)) setSubscribedChannels(new Set(data.user.subscribedChannels));
      if (Array.isArray(data.user.watchHistory)) setWatchHistory(data.user.watchHistory);

      showToast(`Welcome to VideoVerse, ${data.user.name}!`);
      setAuthModalOpen(false);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [likedVideos, dislikedVideos, watchLater, watchHistory, subscribedChannels, showToast]);

  // Sign out: clears cookie and reverts to guest state
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.warn('[AppContext] Logout API call error:', err.message);
    }
    setCurrentUser(null);
    // Revert to clean guest storage
    setLikedVideos(loadSetFromStorage(STORAGE_KEYS.LIKED, []));
    setDislikedVideos(loadSetFromStorage(STORAGE_KEYS.DISLIKED, []));
    setWatchLater(loadSetFromStorage(STORAGE_KEYS.SAVED, []));
    setSubscribedChannels(loadSetFromStorage(STORAGE_KEYS.SUBSCRIBED, ['ch-001', 'ch-003']));
    setWatchHistory(loadArrayFromStorage(STORAGE_KEYS.HISTORY, []));
    showToast('Signed out successfully');
  }, [showToast]);

  // ── Handlers ─────────────────────────────────────────────────────────
  const navigateToWatch = useCallback((video) => {
    if (!video) return;
    setSelectedVideo(video);
    setCurrentPage('watch');

    // Persist current page & video for refresh/reopen
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PAGE, 'watch');
      localStorage.setItem(STORAGE_KEYS.CURRENT_VIDEO_ID, video.id);
      const url = new URL(window.location.href);
      url.searchParams.set('watch', video.id);
      url.searchParams.delete('v');
      window.history.pushState({ page: 'watch', videoId: video.id }, '', url.toString());
    } catch {
      // Safe fallback
    }

    // Track in watch history (move to front, deduplicate, persist)
    setWatchHistory(prev => {
      const next = [video.id, ...prev.filter(id => id !== video.id)];
      saveArrayToStorage(STORAGE_KEYS.HISTORY, next);
      return next;
    });

    // If authenticated, sync history directly with MongoDB
    if (currentUser) {
      fetch('/api/auth/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.id }),
        credentials: 'include',
      }).catch(err => console.warn('[AppContext] Failed to sync history to MongoDB:', err));
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentUser]);

  const navigateToHome = useCallback(() => {
    setCurrentPage('home');
    setSelectedVideo(null);

    // Clear current watch page from URL & storage
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PAGE, 'home');
      localStorage.removeItem(STORAGE_KEYS.CURRENT_VIDEO_ID);
      const url = new URL(window.location.href);
      url.searchParams.delete('watch');
      url.searchParams.delete('v');
      window.history.pushState({ page: 'home' }, '', url.pathname + (url.search ? url.search : ''));
    } catch {
      // Safe fallback
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const selectSidebarItem = useCallback((itemId) => {
    switch (itemId) {
      case 'home':
        setCurrentView('all');
        setActiveCategory('All');
        setActiveChannelFilter(null);
        setSearchQuery('');
        navigateToHome();
        break;
      case 'trending':
        setCurrentView('trending');
        setActiveCategory('Trending');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'subscriptions':
        setCurrentView('subscriptions');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'history':
        setCurrentView('history');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'watch-later':
        setCurrentView('watch-later');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'liked':
        setCurrentView('liked');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'upgrade':
        setCurrentView('upgrade');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'downloads':
        setCurrentView('downloads');
        setActiveCategory('Downloads');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      case 'security':
        setCurrentView('security');
        setActiveCategory('Security');
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      default: {
        const catName = itemId.charAt(0).toUpperCase() + itemId.slice(1);
        setCurrentView('all');
        setActiveCategory(catName);
        setActiveChannelFilter(null);
        navigateToHome();
        break;
      }
    }
  }, [navigateToHome, showToast]);

  const filterByChannel = useCallback((channelId) => {
    setActiveChannelFilter(channelId);
    setCurrentView('channel');
    navigateToHome();
  }, [navigateToHome]);

  const handleSearchSubmit = useCallback((e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (currentPage !== 'home') {
      navigateToHome();
    }
  }, [currentPage, navigateToHome]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const toggleSubscribe = useCallback((channelId) => {
    if (!channelId || typeof channelId !== 'string') return;
    setSubscribedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      saveSetToStorage(STORAGE_KEYS.SUBSCRIBED, next);
      return next;
    });

    // If authenticated, sync with MongoDB
    if (currentUser) {
      fetch('/api/auth/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
        credentials: 'include',
      }).catch(err => console.warn('[AppContext] Failed to sync subscription to MongoDB:', err));
    }
  }, [currentUser]);

  // ── Like / Unlike with independent state, localStorage & MongoDB sync ──
  const toggleLike = useCallback((videoId) => {
    if (!videoId || typeof videoId !== 'string') return;
    setLikedVideos(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      saveSetToStorage(STORAGE_KEYS.LIKED, next);
      return next;
    });

    // If video was disliked, remove it from disliked
    setDislikedVideos(prev => {
      if (prev.has(videoId)) {
        const next = new Set(prev);
        next.delete(videoId);
        saveSetToStorage(STORAGE_KEYS.DISLIKED, next);
        return next;
      }
      return prev;
    });

    // If authenticated, sync with MongoDB
    if (currentUser) {
      fetch('/api/auth/likes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
        credentials: 'include',
      }).catch(err => console.warn('[AppContext] Failed to sync like to MongoDB:', err));
    }
  }, [currentUser]);

  // ── Dislike with independent state, localStorage & MongoDB sync ────────
  const toggleDislike = useCallback((videoId) => {
    if (!videoId || typeof videoId !== 'string') return;
    setDislikedVideos(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      saveSetToStorage(STORAGE_KEYS.DISLIKED, next);
      return next;
    });

    // If video was liked, remove it from liked
    setLikedVideos(prev => {
      if (prev.has(videoId)) {
        const next = new Set(prev);
        next.delete(videoId);
        saveSetToStorage(STORAGE_KEYS.LIKED, next);
        return next;
      }
      return prev;
    });

    // If authenticated, sync with MongoDB
    if (currentUser) {
      fetch('/api/auth/dislikes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
        credentials: 'include',
      }).catch(err => console.warn('[AppContext] Failed to sync dislike to MongoDB:', err));
    }
  }, [currentUser]);

  // ── Save / Unsave (Watch Later) with localStorage & MongoDB sync ───────
  const toggleWatchLater = useCallback((videoId) => {
    if (!videoId || typeof videoId !== 'string') return;
    setWatchLater(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
        showToast('Removed from Watch Later');
      } else {
        next.add(videoId);
        showToast('Saved to Watch Later');
      }
      saveSetToStorage(STORAGE_KEYS.SAVED, next);
      return next;
    });

    // If authenticated, sync with MongoDB
    if (currentUser) {
      fetch('/api/auth/watch-later', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
        credentials: 'include',
      }).catch(err => console.warn('[AppContext] Failed to sync Watch Later to MongoDB:', err));
    }
  }, [currentUser, showToast]);

  const clearHistory = useCallback(() => {
    setWatchHistory([]);
    saveArrayToStorage(STORAGE_KEYS.HISTORY, []);
    showToast('Watch history cleared');

    // If authenticated, sync with MongoDB
    if (currentUser) {
      fetch('/api/auth/history', {
        method: 'DELETE',
        credentials: 'include',
      }).catch(err => console.warn('[AppContext] Failed to clear history in MongoDB:', err));
    }
  }, [currentUser, showToast]);

  // ── Controlled Video Downloads (Task 2) ──────────────────────────────────
  const [quotaInfo, setQuotaInfo] = useState({
    limit: 5,
    used: 0,
    remaining: 5,
    resetsAt: null,
    resetsInHours: null,
    distinctVideoIds: [],
  });
  const [downloadsHistory, setDownloadsHistory] = useState([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadingVideoId, setDownloadingVideoId] = useState(null);

  const fetchDownloadStatus = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/downloads/status', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.quota) setQuotaInfo(data.quota);
      }
    } catch (err) {
      console.warn('[AppContext] Failed to fetch download status:', err.message);
    }
  }, [currentUser]);

  const fetchDownloadHistory = useCallback(async () => {
    if (!currentUser) return;
    setDownloadsLoading(true);
    try {
      const res = await fetch('/api/downloads/history', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDownloadsHistory(Array.isArray(data.downloads) ? data.downloads : []);
      }
    } catch (err) {
      console.warn('[AppContext] Failed to fetch download history:', err.message);
    } finally {
      setDownloadsLoading(false);
    }
  }, [currentUser]);

  // Sync downloads whenever currentUser logs in or session initializes
  useEffect(() => {
    if (currentUser) {
      fetchDownloadStatus();
      fetchDownloadHistory();
    } else {
      setDownloadsHistory([]);
      setQuotaInfo({
        limit: 5,
        used: 0,
        remaining: 5,
        resetsAt: null,
        resetsInHours: null,
        distinctVideoIds: [],
      });
    }
  }, [currentUser, fetchDownloadStatus, fetchDownloadHistory]);

  const deleteDownloadHistory = useCallback(async (recordId) => {
    if (!currentUser || !recordId) return;
    try {
      const res = await fetch(`/api/downloads/${recordId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setDownloadsHistory(prev => prev.filter(d => d.id !== recordId));
        showToast('Download record removed from history');
      }
    } catch (err) {
      console.error('[AppContext] Failed to remove download record:', err);
      showToast('Failed to remove download record');
    }
  }, [currentUser, showToast]);

  const downloadVideo = useCallback(async (video) => {
    if (!video) return;

    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to download videos.');
      return;
    }

    setDownloadingVideoId(video.id);
    showToast(`⏳ Preparing secure download: "${video.title.slice(0, 28)}..."`);

    try {
      const res = await fetch(`/api/videos/${video.id}/download`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || `Download failed with HTTP ${res.status}`;
        showToast(`❌ ${errMsg}`, 4500);
        fetchDownloadStatus();
        return;
      }

      // Extract safe filename from server Content-Disposition header
      const disposition = res.headers.get('content-disposition');
      let filename = `VideoVerse-${video.id}.mp4`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      window.URL.revokeObjectURL(blobUrl);

      showToast(`✅ "${video.title.slice(0, 25)}..." downloaded to your device!`, 3500);
      fetchDownloadStatus();
      fetchDownloadHistory();
    } catch (err) {
      console.error('[Download execution error]', err);
      showToast('❌ Video download was interrupted or network disconnected.');
    } finally {
      setDownloadingVideoId(null);
    }
  }, [currentUser, openAuthModal, showToast, fetchDownloadStatus, fetchDownloadHistory]);

  // ── Razorpay Subscription Upgrade (Task 3) ───────────────────────────────
  /**
   * Initiates a Razorpay checkout flow for the given tier.
   * 1. Creates an order server-side (amount derived from tier on server).
   * 2. Loads Razorpay checkout script if not already loaded.
   * 3. Opens the Razorpay modal.
   * 4. On payment.success, verifies signature server-side.
   * 5. On success, updates currentUser tier in context.
   *
   * @param {'premium'|'vip'} tier
   */
  const upgradeTier = useCallback(async (tier) => {
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to upgrade your plan.');
      return;
    }

    setPaymentLoading(true);

    try {
      // Step 1: Create order on server (amount is authoritative on server)
      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
        credentials: 'include',
      });

      const orderData = await orderRes.json();

      if (!orderRes.ok) {
        showToast(`❌ ${orderData.error || 'Failed to create payment order.'}`, 5000);
        setPaymentLoading(false);
        return;
      }

      const { orderId, amount, currency, keyId } = orderData;

      // Step 2: Load Razorpay checkout script dynamically if not already present
      await new Promise((resolve, reject) => {
        if (window.Razorpay) return resolve();
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Razorpay checkout script.'));
        document.head.appendChild(script);
      });

      // Step 3: Open Razorpay checkout modal
      await new Promise((resolve, reject) => {
        const options = {
          key: keyId,
          amount,
          currency,
          name: 'VideoVerse',
          description: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Subscription`,
          order_id: orderId,
          theme: { color: tier === 'vip' ? '#a855f7' : '#f59e0b' },
          prefill: {
            name: currentUser.name,
            email: currentUser.email,
          },
          handler: async function (response) {
            // Step 4: Verify payment signature server-side
            try {
              const verifyRes = await fetch('/api/payments/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  razorpayOrderId:   response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                }),
                credentials: 'include',
              });

              const verifyData = await verifyRes.json();

              if (verifyRes.ok && verifyData.success) {
                // Step 5: Update user tier in context
                setCurrentUser(verifyData.user);
                const tierLabel = tier === 'vip' ? '👑 VIP' : '⭐ Premium';
                showToast(`🎉 Upgraded to ${tierLabel}! Enjoy your new benefits.`, 5000);
                resolve();
              } else {
                showToast(`❌ Payment verification failed: ${verifyData.error || 'Unknown error'}`, 6000);
                reject(new Error(verifyData.error));
              }
            } catch (verifyErr) {
              showToast('❌ Payment verification could not be completed.', 5000);
              reject(verifyErr);
            }
          },
          modal: {
            ondismiss: () => {
              showToast('Payment cancelled.');
              resolve(); // Resolve (not reject) so we don't treat cancel as error
            },
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (response) => {
          const errDesc = response?.error?.description || 'Payment failed.';
          showToast(`❌ ${errDesc}`, 5000);
          resolve();
        });
        rzp.open();
      });
    } catch (err) {
      console.error('[upgradeTier Error]', err);
      if (err.message && err.message.includes('Razorpay')) {
        showToast('❌ Could not load the payment provider. Check your internet connection.', 5000);
      } else {
        showToast('❌ Upgrade failed. Please try again.', 4000);
      }
    } finally {
      setPaymentLoading(false);
    }
  }, [currentUser, openAuthModal, showToast]);

  const value = {
    // Video data (live from API or local fallback)
    videos,
    videosLoading,
    usingFallback,

    // Navigation
    currentPage,
    selectedVideo,
    navigateToWatch,
    navigateToHome,

    // Views & Filters
    currentView,
    setCurrentView,
    activeChannelFilter,
    filterByChannel,
    selectSidebarItem,

    // Sidebar
    sidebarOpen,
    sidebarCollapsed,
    toggleSidebar,
    toggleSidebarCollapse,

    // Search & Category
    searchQuery,
    setSearchQuery,
    handleSearchSubmit,
    activeCategory,
    setActiveCategory,

    // Social & Activity (persistent localStorage & MongoDB)
    subscribedChannels,
    toggleSubscribe,
    likedVideos,
    toggleLike,
    dislikedVideos,
    toggleDislike,
    watchLater,
    toggleWatchLater,
    watchHistory,
    clearHistory,

    // User Authentication & Profiles (Task 4)
    currentUser,
    authLoading,
    authModalOpen,
    openAuthModal,
    closeAuthModal,
    login,
    verifyOtp,
    resendOtp,
    getDevLastOtp,
    register,
    logout,

    // Automatic IST Theme & Appearance Preferences (Task 4)
    theme,
    themePreference,
    updateThemePreference,

    // Controlled Video Downloads (Task 2)
    quotaInfo,
    downloadsHistory,
    downloadsLoading,
    downloadingVideoId,
    fetchDownloadStatus,
    fetchDownloadHistory,
    deleteDownloadHistory,
    downloadVideo,

    // Subscriptions & Payments (Task 3)
    paymentLoading,
    upgradeTier,

    // Global App Toast
    appToast,
    showToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
