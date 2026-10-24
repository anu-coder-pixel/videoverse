import { useMemo } from 'react';
import {
  Flame, Bell, ThumbsUp, History, Clock, X,
  CheckCircle2, Sparkles, Film, Wifi, WifiOff,
  Download, Trash2, Play, Info
} from 'lucide-react';
import CategoryPills from '../../components/CategoryPills/CategoryPills';
import VideoCard from '../../components/VideoCard/VideoCard';
import SubscriptionPage from '../../components/SubscriptionPage/SubscriptionPage';
import SecurityPage from '../../components/SecurityPage/SecurityPage';
import { useApp } from '../../context/AppContext';
import { MOCK_CHANNELS } from '../../data/mockData';
import './HomePage.css';

export default function HomePage() {
  const {
    videos,          // live from API or local fallback
    videosLoading,   // true while first fetch is in-flight
    usingFallback,   // true if server was unreachable
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
    currentUser,
    openAuthModal,
    quotaInfo,
    downloadsHistory,
    downloadsLoading,
    downloadingVideoId,
    downloadVideo,
    deleteDownloadHistory,
    navigateToWatch,
  } = useApp();

  // Selected channel object for channel view
  const currentChannel = useMemo(() => {
    if (!activeChannelFilter) return null;
    return MOCK_CHANNELS.find(c => c.id === activeChannelFilter) || null;
  }, [activeChannelFilter]);

  // Compute filtered videos based on currentView, activeCategory, search, etc.
  const filteredVideos = useMemo(() => {
    // Use whichever dataset is available (API or fallback)
    let allVideos = Array.isArray(videos) ? videos : [];

    let result = [...allVideos];

    // 1. Channel filter
    if (activeChannelFilter) {
      result = result.filter(v => v.channel.id === activeChannelFilter);
    }
    // 2. Specific View filters
    else if (currentView === 'trending') {
      result = [...result].sort((a, b) => parseViews(b.views) - parseViews(a.views));
    } else if (currentView === 'subscriptions') {
      result = result.filter(v => subscribedChannels.has(v.channel.id));
    } else if (currentView === 'liked') {
      result = result.filter(v => likedVideos.has(v.id));
    } else if (currentView === 'history') {
      result = watchHistory
        .map(id => allVideos.find(v => v.id === id))
        .filter(Boolean);
    } else if (currentView === 'watch-later') {
      result = result.filter(v => watchLater.has(v.id));
    }

    // 3. Category filter
    if (!activeChannelFilter && currentView !== 'trending' && activeCategory && activeCategory !== 'All') {
      result = result.filter(v =>
        v.category.toLowerCase() === activeCategory.toLowerCase() ||
        v.tags.some(t => t.toLowerCase() === activeCategory.toLowerCase())
      );
    }

    // 4. Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(v =>
        v.title.toLowerCase().includes(q) ||
        v.channel.name.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        v.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    return result;
  }, [
    videos,
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
      {/* Fallback notice — shown when the backend is not running */}
      {usingFallback && (
        <div className="home-page__fallback-notice" role="alert">
          <WifiOff size={14} aria-hidden="true" />
          <span>
            <strong>Offline mode:</strong> Using local sample data — start the Express server
            to connect to the live API.
          </span>
        </div>
      )}

      {/* Loading skeleton */}
      {videosLoading && (
        <div className="home-page__skeleton-grid" aria-label="Loading videos" aria-busy="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="video-card-skeleton">
              <div className="video-card-skeleton__thumb" />
              <div className="video-card-skeleton__meta">
                <div className="video-card-skeleton__avatar" />
                <div className="video-card-skeleton__lines">
                  <div className="video-card-skeleton__line video-card-skeleton__line--title" />
                  <div className="video-card-skeleton__line video-card-skeleton__line--sub" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Normal content — hidden while loading */}
      {!videosLoading && (
        <>
          {/* Sticky category filter (hidden in upgrade view) */}
          {currentView !== 'upgrade' && (
            <div className="home-page__categories">
              <CategoryPills />
            </div>
          )}

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

      {currentView === 'downloads' && (
        <div className="home-page__downloads-view animate-fade-in" id="downloads-view-container">
          <div className="home-page__section-header">
            <div className="home-page__section-title">
              <Download size={22} className="text-brand-primary" />
              <h2>Controlled Video Downloads</h2>
              <span className="badge badge--success">
                {quotaInfo.remaining} of {quotaInfo.limit} Left Today
              </span>
            </div>
            <p>Download original high-quality video files directly to your device for offline viewing.</p>
          </div>

          {/* Quota & Browser Storage Disclaimer Card */}
          <div className="downloads-quota-card" id="downloads-quota-card">
            <div className="downloads-quota-card__header">
              <div className="downloads-quota-card__metric">
                <span className="downloads-quota-card__label">Daily Quota Status</span>
                <strong className="downloads-quota-card__value">
                  {quotaInfo.used} / {quotaInfo.limit} distinct videos downloaded
                </strong>
              </div>
              {quotaInfo.resetsInHours ? (
                <div className="downloads-quota-card__reset">
                  <span>Resets in ~{quotaInfo.resetsInHours}h</span>
                </div>
              ) : null}
            </div>
            <div className="downloads-quota-card__progress-bar">
              <div
                className="downloads-quota-card__progress-fill"
                style={{ width: `${(quotaInfo.used / quotaInfo.limit) * 100}%` }}
              />
            </div>
            <div className="downloads-quota-card__notice">
              <Info size={16} className="downloads-quota-card__notice-icon" />
              <p>
                <strong>Device Storage Notice:</strong> Video files are delivered via secure streaming directly through your browser's native download mechanism and saved to your device's download folder. Re-downloading previously saved videos within 24 hours does not consume additional quota.
              </p>
            </div>
          </div>

          {/* User state handling */}
          {!currentUser ? (
            <div className="home-page__empty animate-fade-in" role="status">
              <Download size={48} className="home-page__empty-icon" />
              <h2>Sign in to access video downloads</h2>
              <p>Download permissions and rolling 24-hour quotas are tied to your authenticated account.</p>
              <button
                className="btn btn--primary"
                onClick={openAuthModal}
                style={{ marginTop: 'var(--space-4)' }}
                id="downloads-signin-btn"
              >
                Sign In / Register
              </button>
            </div>
          ) : downloadsHistory.length === 0 ? (
            <div className="home-page__empty animate-fade-in" role="status">
              <Download size={48} className="home-page__empty-icon" />
              <h2>No downloads yet</h2>
              <p>Browse any video in VideoVerse and click the Download button below the player to save it to your device.</p>
              <button
                className="btn btn--primary"
                onClick={() => selectSidebarItem('home')}
                style={{ marginTop: 'var(--space-4)' }}
                id="downloads-browse-btn"
              >
                Browse Videos
              </button>
            </div>
          ) : (
            <div className="downloads-history-section">
              <div className="downloads-history-header">
                <h3>Download History ({downloadsHistory.length})</h3>
                <span className="downloads-history-subtitle">Saved video records linked to your account</span>
              </div>

              <div className="downloads-history-grid" role="list">
                {downloadsHistory.map(item => {
                  const matchingVideo = videos?.find(v => v.id === item.videoId);
                  return (
                    <div key={item.id} className="download-item-card animate-fade-in" role="listitem">
                      <div className="download-item-card__thumb-box">
                        <img
                          src={item.thumbnailUrl || matchingVideo?.thumbnailUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80'}
                          alt={item.videoTitle}
                          className="download-item-card__thumb"
                        />
                        {item.fileSize > 0 && (
                          <span className="download-item-card__size-badge">
                            {formatBytes(item.fileSize)}
                          </span>
                        )}
                      </div>

                      <div className="download-item-card__info">
                        <h4 className="download-item-card__title" title={item.videoTitle}>
                          {item.videoTitle}
                        </h4>
                        <p className="download-item-card__channel">{item.channelName}</p>

                        <div className="download-item-card__meta">
                          <span className={`badge ${item.status === 'completed' ? 'badge--success' : item.status === 'interrupted' ? 'badge--warning' : 'badge--danger'}`}>
                            {item.status === 'completed' ? '✓ Completed' : item.status === 'interrupted' ? '⚠ Interrupted' : '✕ Failed'}
                          </span>
                          <span className="download-item-card__date">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="download-item-card__actions">
                          {matchingVideo && (
                            <button
                              className="btn btn--sm btn--primary"
                              onClick={() => navigateToWatch(matchingVideo)}
                              title="Watch this video"
                            >
                              <Play size={13} />
                              <span>Watch</span>
                            </button>
                          )}
                          <button
                            className="btn btn--sm btn--secondary"
                            onClick={() => downloadVideo({ id: item.videoId, title: item.videoTitle })}
                            disabled={downloadingVideoId === item.videoId}
                            title="Re-download video file (does not consume additional quota)"
                          >
                            <Download size={13} />
                            <span>{downloadingVideoId === item.videoId ? 'Downloading…' : 'Re-download'}</span>
                          </button>
                          <button
                            className="btn btn--sm btn--ghost download-item-card__delete-btn"
                            onClick={() => deleteDownloadHistory(item.id)}
                            title="Remove from history"
                            aria-label={`Remove ${item.videoTitle} from download history`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subscription / Upgrade Pricing View */}
      {currentView === 'upgrade' && (
        <SubscriptionPage />
      )}

      {/* Security & Devices Telemetry View (Task 4) */}
      {currentView === 'security' && (
        <SecurityPage />
      )}

      {/* Normal Video Grid (shown for non-special views) */}
      {currentView !== 'downloads' && currentView !== 'upgrade' && currentView !== 'security' && (
        <>
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
        </>
      )}
        </>
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

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
