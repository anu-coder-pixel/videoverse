import { useState } from 'react';
import {
  ThumbsUp, ThumbsDown, Share2, Download, Bell,
  CheckCircle2, ArrowLeft, Flag, MoreHorizontal, Clock
} from 'lucide-react';
import VideoPlayer from '../../components/VideoPlayer/VideoPlayer';
import CommentsSection from '../../components/CommentsSection/CommentsSection';
import VideoCard from '../../components/VideoCard/VideoCard';
import { useApp } from '../../context/AppContext';
import { MOCK_VIDEOS } from '../../data/mockData';
import './WatchPage.css';

/**
 * ⚠️  NOTICE — VideoVerse WatchPage Status:
 * ✅  Working: HTML5 video player with legitimate sample MP4 streaming
 * ✅  Working: Video selection & switching via Up Next recommendations
 * ✅  Working: Back to home navigation button
 * ✅  Working: Like / Dislike toggle (local state)
 * ✅  Working: Subscribe / Unsubscribe toggle (local state)
 * ✅  Working: Save to Watch Later (local state)
 * ✅  Working: Local comments submission
 * ❌  Task 1: Multilingual comments & moderation backend
 * ❌  Task 2: Controlled video downloads
 * ❌  Task 3: Subscriptions with Razorpay payments
 * ❌  Task 4: Authentication & user profiles
 * ❌  Task 5: Adaptive bitrate streaming (HLS/DASH) & CDN pipeline
 * ❌  Task 6: Real-time video calling
 */

export default function WatchPage() {
  const {
    selectedVideo,
    navigateToHome,
    subscribedChannels,
    toggleSubscribe,
    likedVideos,
    toggleLike,
    watchLater,
    toggleWatchLater,
    showToast,
  } = useApp();
  const [disliked, setDisliked] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  if (!selectedVideo) {
    navigateToHome();
    return null;
  }

  const video = selectedVideo;
  const isLiked = likedVideos.has(video.id);
  const isSubscribed = subscribedChannels.has(video.channel.id);
  const isSaved = watchLater.has(video.id);

  // Recommended videos (exclude current video)
  const recommendations = MOCK_VIDEOS.filter(v => v.id !== video.id).slice(0, 8);

  function handleLike() {
    toggleLike(video.id);
    if (disliked) setDisliked(false);
  }

  function handleDislike() {
    setDisliked(d => !d);
    if (isLiked) toggleLike(video.id);
  }

  function handleShare() {
    const url = window.location.origin + `?watch=${video.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast('🔗 Video share link copied to clipboard!');
  }

  function handleDownload() {
    showToast('⚠️ Controlled video downloads will be built in internship Task 2.');
  }

  return (
    <div className="watch-page" id="watch-page">
      {/* Back button */}
      <button
        className="watch-page__back"
        onClick={navigateToHome}
        aria-label="Go back to home"
        id="back-to-home-btn"
      >
        <ArrowLeft size={18} />
        <span>Back to Videos</span>
      </button>

      <div className="watch-page__layout">
        {/* ── Main Column ── */}
        <main className="watch-page__main" role="main">
          {/* Player */}
          <VideoPlayer video={video} />

          {/* Video meta */}
          <div className="watch-meta">
            {/* Tags */}
            <div className="watch-meta__tags" aria-label="Tags">
              {video.tags.map(tag => (
                <span key={tag} className="watch-meta__tag">#{tag}</span>
              ))}
            </div>

            <h1 className="watch-meta__title">{video.title}</h1>

            {/* Channel row + actions */}
            <div className="watch-meta__row">
              {/* Channel info */}
              <div className="watch-meta__channel">
                <div
                  className="watch-meta__channel-avatar"
                  style={{ background: video.channel.avatarColor }}
                  aria-hidden="true"
                >
                  {video.channel.initials}
                </div>
                <div className="watch-meta__channel-info">
                  <div className="watch-meta__channel-name-row">
                    <span className="watch-meta__channel-name">{video.channel.name}</span>
                    {video.channel.verified && (
                      <CheckCircle2 size={14} className="watch-meta__verified" aria-label="Verified" />
                    )}
                  </div>
                  <span className="watch-meta__subs">{video.channel.subscribers} subscribers</span>
                </div>

                {/* Subscribe button */}
                <button
                  className={`watch-meta__subscribe-btn ${isSubscribed ? 'watch-meta__subscribe-btn--subscribed' : ''}`}
                  onClick={() => toggleSubscribe(video.channel.id)}
                  aria-label={isSubscribed ? `Unsubscribe from ${video.channel.name}` : `Subscribe to ${video.channel.name}`}
                  aria-pressed={isSubscribed}
                  id="subscribe-btn"
                >
                  {isSubscribed ? (
                    <><Bell size={14} /> Subscribed</>
                  ) : (
                    'Subscribe'
                  )}
                </button>
              </div>

              {/* Action buttons */}
              <div className="watch-meta__actions">
                {/* Like/Dislike */}
                <div className="watch-meta__like-group">
                  <button
                    className={`watch-meta__action-btn ${isLiked ? 'watch-meta__action-btn--active' : ''}`}
                    onClick={handleLike}
                    aria-label="Like video"
                    aria-pressed={isLiked}
                    id="like-btn"
                  >
                    <ThumbsUp size={16} />
                    <span>{isLiked ? formatCount(parseCount(video.likes) + 1) : video.likes}</span>
                  </button>
                  <div className="watch-meta__like-divider" />
                  <button
                    className={`watch-meta__action-btn ${disliked ? 'watch-meta__action-btn--active' : ''}`}
                    onClick={handleDislike}
                    aria-label="Dislike video"
                    aria-pressed={disliked}
                    id="dislike-btn"
                  >
                    <ThumbsDown size={16} />
                  </button>
                </div>

                <button
                  className={`watch-meta__action-btn ${isSaved ? 'watch-meta__action-btn--active' : ''}`}
                  onClick={() => toggleWatchLater(video.id)}
                  aria-label={isSaved ? "Remove from Watch Later" : "Save to Watch Later"}
                  title={isSaved ? "Saved to Watch Later" : "Save to Watch Later"}
                  id="save-watch-later-btn"
                >
                  <Clock size={16} />
                  <span>{isSaved ? 'Saved' : 'Save'}</span>
                </button>

                <button
                  className="watch-meta__action-btn"
                  onClick={handleShare}
                  aria-label="Share video link"
                  id="share-btn"
                >
                  <Share2 size={16} />
                  <span>Share</span>
                </button>

                <button
                  className="watch-meta__action-btn"
                  onClick={handleDownload}
                  aria-label="Download video (planned feature)"
                  title="Coming in Task 2"
                  id="download-btn"
                >
                  <Download size={16} />
                  <span>Download</span>
                </button>

                <button
                  className="watch-meta__action-btn"
                  onClick={() => showToast('ℹ️ More settings and options will be added in future stages.')}
                  aria-label="More options"
                  id="more-options-btn"
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>

            {/* Description */}
            <div
              className={`watch-meta__desc ${descExpanded ? 'watch-meta__desc--expanded' : ''}`}
              role="region"
              aria-label="Video description"
            >
              <div className="watch-meta__desc-stats">
                <strong>{video.views} views</strong>
                <span>·</span>
                <span>{video.uploadedAt}</span>
              </div>
              <p className="watch-meta__desc-text">{video.description}</p>
              <button
                className="watch-meta__desc-toggle"
                onClick={() => setDescExpanded(d => !d)}
                aria-expanded={descExpanded}
                id="desc-toggle-btn"
              >
                {descExpanded ? 'Show less' : 'Show more'}
              </button>
            </div>
          </div>

          {/* Comments */}
          <div className="watch-page__comments">
            <CommentsSection videoId={video.id} />
          </div>
        </main>

        {/* ── Sidebar (Recommendations) ── */}
        <aside className="watch-page__sidebar" aria-label="Recommended videos">
          <h2 className="watch-page__sidebar-title">Up Next</h2>
          <div className="watch-page__recommendations">
            {recommendations.map(rec => (
              <VideoCard key={rec.id} video={rec} compact />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function parseCount(str) {
  if (!str) return 0;
  if (str.endsWith('K')) return parseFloat(str) * 1000;
  if (str.endsWith('M')) return parseFloat(str) * 1000000;
  return parseInt(str, 10) || 0;
}

function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}
