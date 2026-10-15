import { useMemo } from 'react';
import {
  Flame, Bell, ThumbsUp, History, Clock, X,
  CheckCircle2, Sparkles, Film
} from 'lucide-react';
import CategoryPills from '../../components/CategoryPills/CategoryPills';
import VideoCard from '../../components/VideoCard/VideoCard';
import { useApp } from '../../context/AppContext';
import { MOCK_VIDEOS, MOCK_CHANNELS } from '../../data/mockData';
import './HomePage.css';

export default function HomePage() {
  const {
    searchQuery,
    setSearchQuery,
    activeCategory,
    currentView,
    activeChannelFilter,
    subscribedChannels,
    likedVideos,
    watchHistory,
    watchLater,
    clearHistory,
    selectSidebarItem,
    toggleSubscribe,
  } = useApp();

  // Selected channel object for channel view
  const currentChannel = useMemo(() => {
    if (!activeChannelFilter) return null;
    return MOCK_CHANNELS.find(c => c.id === activeChannelFilter) || null;
  }, [activeChannelFilter]);

  // Compute filtered videos based on currentView, activeCategory, search, etc.
  const filteredVideos = useMemo(() => {
    let videos = [...MOCK_VIDEOS];

    // 1. Channel filter
    if (activeChannelFilter) {
      videos = videos.filter(v => v.channel.id === activeChannelFilter);
    }
    // 2. Specific View filters
    else if (currentView === 'trending') {
      // Sort by views parsed
      videos = [...videos].sort((a, b) => parseViews(b.views) - parseViews(a.views));
    } else if (currentView === 'subscriptions') {
      videos = videos.filter(v => subscribedChannels.has(v.channel.id));
    } else if (currentView === 'liked') {
      videos = videos.filter(v => likedVideos.has(v.id));
    } else if (currentView === 'history') {
      // Order by history array order
      const historySet = new Set(watchHistory);
      videos = watchHistory
        .map(id => videos.find(v => v.id === id))
        .filter(Boolean);
    } else if (currentView === 'watch-later') {
      videos = videos.filter(v => watchLater.has(v.id));
    }

    // 3. Category filter (applies when not in channel view)
    if (!activeChannelFilter && currentView !== 'trending' && activeCategory && activeCategory !== 'All') {
      videos = videos.filter(v =>
        v.category.toLowerCase() === activeCategory.toLowerCase() ||
        v.tags.some(t => t.toLowerCase() === activeCategory.toLowerCase())
      );
    }

    // 4. Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      videos = videos.filter(v =>
        v.title.toLowerCase().includes(q) ||
        v.channel.name.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        v.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    return videos;
  }, [
    currentView,
    activeCategory,
    searchQuery,
    activeChannelFilter,
    subscribedChannels,
    likedVideos,
    watchHistory,
    watchLater,
  ]);

  return (
    <main className="home-page" id="main-content" role="main">
      {/* Sticky category filter */}
      <div className="home-page__categories">
        <CategoryPills />
      </div>

      {/* Special View Headers */}
      {currentChannel && (
        <div className="home-page__channel-banner animate-fade-in">
          <div
            className="home-page__channel-avatar"
            style={{ background: currentChannel.avatarColor }}
          >
            {currentChannel.initials}
          </div>
          <div className="home-page__channel-details">
            <div className="home-page__channel-title-row">
              <h2>{currentChannel.name}</h2>
              {currentChannel.verified && (
                <CheckCircle2 size={16} className="text-brand-primary" aria-label="Verified" />
              )}
            </div>
            <p className="home-page__channel-meta">
              {currentChannel.handle} · {currentChannel.subscribers} subscribers
            </p>
          </div>
          <button
            className={`btn ${subscribedChannels.has(currentChannel.id) ? 'btn--secondary' : 'btn--primary'}`}
            onClick={() => toggleSubscribe(currentChannel.id)}
            id="channel-banner-subscribe-btn"
          >
            {subscribedChannels.has(currentChannel.id) ? 'Subscribed' : 'Subscribe'}
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => selectSidebarItem('home')}
            title="Close channel view"
            aria-label="Back to all videos"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {currentView === 'trending' && !activeChannelFilter && (
        <div className="home-page__section-header animate-fade-in">
          <div className="home-page__section-title">
            <Flame size={22} className="text-warning" />
            <h2>Trending on VideoVerse</h2>
            <span className="badge badge--mock">Sorted by Popularity</span>
          </div>
          <p>The most watched videos across all categories right now.</p>
        </div>
      )}

      {currentView === 'subscriptions' && !activeChannelFilter && (
        <div className="home-page__section-header animate-fade-in">
          <div className="home-page__section-title">
            <Bell size={20} className="text-brand-primary" />
            <h2>Subscriptions Feed</h2>
            <span className="badge badge--mock">{subscribedChannels.size} Channels</span>
          </div>
          <p>Latest uploads from channels you subscribe to.</p>
        </div>
      )}

      {currentView === 'liked' && !activeChannelFilter && (
        <div className="home-page__section-header animate-fade-in">
          <div className="home-page__section-title">
            <ThumbsUp size={20} className="text-brand-accent" />
            <h2>Liked Videos</h2>
            <span className="badge badge--mock">{likedVideos.size} Videos</span>
          </div>
          <p>Videos you've liked during your viewing sessions.</p>
        </div>
      )}

      {currentView === 'history' && !activeChannelFilter && (
        <div className="home-page__section-header animate-fade-in">
          <div className="home-page__section-title">
            <History size={20} className="text-brand-primary" />
            <h2>Watch History</h2>
            <span className="badge badge--mock">{watchHistory.length} Watched</span>
          </div>
          <div className="home-page__section-actions">
            <p>Videos you have opened and watched.</p>
            {watchHistory.length > 0 && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={clearHistory}
                id="clear-history-btn"
              >
                Clear History
              </button>
            )}
          </div>
        </div>
      )}

      {currentView === 'watch-later' && !activeChannelFilter && (
        <div className="home-page__section-header animate-fade-in">
          <div className="home-page__section-title">
            <Clock size={20} className="text-brand-primary" />
            <h2>Watch Later</h2>
            <span className="badge badge--mock">{watchLater.size} Saved</span>
          </div>
          <p>Videos you saved to enjoy when you have time.</p>
        </div>
      )}

      {/* Search result heading */}
      {searchQuery && (
        <div className="home-page__result-info animate-fade-in">
          <p>
            Search results for <strong>"{searchQuery}"</strong>
            {' '}— {filteredVideos.length} video{filteredVideos.length !== 1 ? 's' : ''} found
          </p>
          <button
            className="home-page__clear-search-btn"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
          >
            Clear Search
          </button>
        </div>
      )}

      {/* Video grid */}
      {filteredVideos.length > 0 ? (
        <section className="home-page__grid" aria-label="Video feed">
          {filteredVideos.map((video, i) => (
            <VideoCard
              key={video.id}
              video={video}
              style={{ animationDelay: `${i * 35}ms` }}
            />
          ))}
        </section>
      ) : (
        <div className="home-page__empty animate-fade-in" role="status" aria-live="polite">
          <div className="home-page__empty-icon" aria-hidden="true">🎬</div>
          <h2>
            {currentView === 'subscriptions'
              ? 'No subscription videos found'
              : currentView === 'liked'
              ? 'No liked videos yet'
              : currentView === 'history'
              ? 'Your watch history is empty'
              : currentView === 'watch-later'
              ? 'No videos in Watch Later'
              : 'No videos found'}
          </h2>
          <p>
            {searchQuery
              ? `No results matching "${searchQuery}". Try searching for another topic or creator.`
              : currentView === 'subscriptions'
              ? 'Subscribe to channels in the sidebar or video cards to see their uploads here.'
              : currentView === 'liked'
              ? 'Click the Thumbs Up button on any video while watching to collect your favorites here.'
              : currentView === 'history'
              ? 'Videos you watch will automatically be recorded here so you can easily rewatch them.'
              : `No videos available in the "${activeCategory}" filter.`}
          </p>
          <button
            className="btn btn--primary"
            onClick={() => selectSidebarItem('home')}
            style={{ marginTop: 'var(--space-4)' }}
            id="empty-state-browse-btn"
          >
            Browse All Videos
          </button>
        </div>
      )}
    </main>
  );
}

function parseViews(v) {
  if (!v) return 0;
  if (v.endsWith('M')) return parseFloat(v) * 1000000;
  if (v.endsWith('K')) return parseFloat(v) * 1000;
  return parseInt(v, 10) || 0;
}
