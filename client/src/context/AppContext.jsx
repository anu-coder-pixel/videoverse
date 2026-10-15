/**
 * VideoVerse — App Context
 *
 * Manages global UI state: sidebar, current page/video, search, category, theme.
 * Note: Authentication and user data are NOT implemented yet (planned for Task 4).
 */
import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ── Navigation state ────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState('home'); // 'home' | 'watch'
  const [selectedVideo, setSelectedVideo] = useState(null);

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

  // ── Social & Activity state (In-memory / Local State) ─────────────────
  const [subscribedChannels, setSubscribedChannels] = useState(new Set(['ch-001', 'ch-003']));
  const [likedVideos, setLikedVideos] = useState(new Set(['vid-001']));
  const [watchLater, setWatchLater] = useState(new Set());
  const [watchHistory, setWatchHistory] = useState(['vid-001', 'vid-002']);

  // ── Toast notification for simulated features ────────────────────────
  const [appToast, setAppToast] = useState(null);

  const showToast = useCallback((message, duration = 3000) => {
    setAppToast(message);
    setTimeout(() => {
      setAppToast(null);
    }, duration);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────
  const navigateToWatch = useCallback((video) => {
    if (!video) return;
    setSelectedVideo(video);
    setCurrentPage('watch');
    // Track in watch history (move to front, deduplicate)
    setWatchHistory(prev => [video.id, ...prev.filter(id => id !== video.id)]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigateToHome = useCallback(() => {
    setCurrentPage('home');
    setSelectedVideo(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const selectSidebarItem = useCallback((itemId) => {
    switch (itemId) {
      case 'home':
        setCurrentView('all');
        setActiveCategory('All');
        setActiveChannelFilter(null);
        setSearchQuery('');
        setCurrentPage('home');
        break;
      case 'trending':
        setCurrentView('trending');
        setActiveCategory('Trending');
        setActiveChannelFilter(null);
        setCurrentPage('home');
        break;
      case 'subscriptions':
        setCurrentView('subscriptions');
        setActiveChannelFilter(null);
        setCurrentPage('home');
        break;
      case 'history':
        setCurrentView('history');
        setActiveChannelFilter(null);
        setCurrentPage('home');
        break;
      case 'watch-later':
        setCurrentView('watch-later');
        setActiveChannelFilter(null);
        setCurrentPage('home');
        break;
      case 'liked':
        setCurrentView('liked');
        setActiveChannelFilter(null);
        setCurrentPage('home');
        break;
      case 'downloads':
        showToast('⚠️ Controlled Downloads is planned for internship Task 2.');
        break;
      default: {
        // Any explore category (Technology, Gaming, Music, Education, Travel, Science, Cooking, Sports, Animation, Documentary, Comedy, News, Fitness)
        const catName = itemId.charAt(0).toUpperCase() + itemId.slice(1);
        setCurrentView('all');
        setActiveCategory(catName);
        setActiveChannelFilter(null);
        setCurrentPage('home');
        break;
      }
    }
  }, [showToast]);

  const filterByChannel = useCallback((channelId) => {
    setActiveChannelFilter(channelId);
    setCurrentView('channel');
    setCurrentPage('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSearchSubmit = useCallback((e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (currentPage !== 'home') {
      setCurrentPage('home');
    }
  }, [currentPage]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const toggleSubscribe = useCallback((channelId) => {
    setSubscribedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  }, []);

  const toggleLike = useCallback((videoId) => {
    setLikedVideos(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  }, []);

  const toggleWatchLater = useCallback((videoId) => {
    setWatchLater(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
        showToast('Removed from Watch Later');
      } else {
        next.add(videoId);
        showToast('Saved to Watch Later');
      }
      return next;
    });
  }, [showToast]);

  const clearHistory = useCallback(() => {
    setWatchHistory([]);
    showToast('Watch history cleared');
  }, [showToast]);

  const value = {
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

    // Social & Activity (in-memory)
    subscribedChannels,
    toggleSubscribe,
    likedVideos,
    toggleLike,
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
