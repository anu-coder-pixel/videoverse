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
};

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

  // ── Toast notification for user actions ──────────────────────────────
  const [appToast, setAppToast] = useState(null);

  const showToast = useCallback((message, duration = 3000) => {
    setAppToast(message);
    setTimeout(() => {
      setAppToast(null);
    }, duration);
  }, []);

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
      case 'downloads':
        showToast('⚠️ Controlled Downloads is planned for internship Task 2.');
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
  }, []);

  // ── Like / Unlike with independent state & localStorage persistence ────
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
  }, []);

  // ── Dislike with independent state & localStorage persistence ──────────
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
  }, []);

  // ── Save / Unsave (Watch Later) with localStorage persistence ───────────
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
  }, [showToast]);

  const clearHistory = useCallback(() => {
    setWatchHistory([]);
    saveArrayToStorage(STORAGE_KEYS.HISTORY, []);
    showToast('Watch history cleared');
  }, [showToast]);

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

    // Social & Activity (persistent localStorage)
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
