import { useState } from 'react';
import {
  ThumbsUp, ThumbsDown, Share2, Download, Bell,
  CheckCircle2, ArrowLeft, Flag, MoreHorizontal, Clock, Loader2
} from 'lucide-react';
import VideoPlayer from '../../components/VideoPlayer/VideoPlayer';
import CommentsSection from '../../components/CommentsSection/CommentsSection';
import VideoCard from '../../components/VideoCard/VideoCard';
import { useApp } from '../../context/AppContext';
import { MOCK_VIDEOS } from '../../data/mockData';
import './WatchPage.css';

export default function WatchPage() {
  const {
    videos,
    selectedVideo,
    navigateToHome,
    subscribedChannels,
    toggleSubscribe,
    likedVideos,
    toggleLike,
    dislikedVideos,
    toggleDislike,
    watchLater,
    toggleWatchLater,
    showToast,
    currentUser,
    openAuthModal,
    downloadVideo,
    downloadingVideoId,
    quotaInfo,
  } = useApp();
  const [descExpanded, setDescExpanded] = useState(false);

  if (!selectedVideo) {
    navigateToHome();
    return null;
  }

  const video = selectedVideo;
  const isLiked = likedVideos.has(video.id);
  const isDisliked = dislikedVideos ? dislikedVideos.has(video.id) : false;
  const isSubscribed = subscribedChannels.has(video.channel.id);
  const isSaved = watchLater.has(video.id);

  // Recommended videos (exclude current video, prefer API videos with mock fallback)
  const videoList = videos?.length ? videos : MOCK_VIDEOS;
  const recommendations = videoList.filter(v => v.id !== video.id).slice(0, 8);

  function handleLike() {
    toggleLike(video.id);
  }

  function handleDislike() {
    toggleDislike(video.id);
  }

  function handleShare() {
    const url = window.location.origin + `?watch=${video.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast('🔗 Video share link copied to clipboard!');
  }

  function handleDownload() {
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to download videos.');
      return;
    }
    downloadVideo(video);
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
                    aria-label={isLiked ? "Unlike video" : "Like video"}
                    aria-pressed={isLiked}
                    id="like-btn"
                  >
                    <ThumbsUp size={16} />
                    <span>{isLiked ? formatCount(parseCount(video.likes) + 1, video.likes) : video.likes}</span>
                  </button>
                  <div className="watch-meta__like-divider" />
                  <button
                    className={`watch-meta__action-btn ${isDisliked ? 'watch-meta__action-btn--active' : ''}`}
                    onClick={handleDislike}
                    aria-label={isDisliked ? "Remove dislike" : "Dislike video"}
                    aria-pressed={isDisliked}
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
                  aria-pressed={isSaved}
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
                  disabled={downloadingVideoId === video.id}
                  aria-label={downloadingVideoId === video.id ? 'Downloading video file...' : 'Download video file'}
                  title={quotaInfo ? `${quotaInfo.remaining} daily downloads remaining` : 'Download video'}
                  id="download-btn"
                >
                  {downloadingVideoId === video.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  <span>{downloadingVideoId === video.id ? 'Downloading…' : 'Download'}</span>
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

function formatCount(n, originalStr = '') {
  if (n >= 1000000) {
    const m = n / 1000000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    if (originalStr && originalStr.includes('.')) {
      return `${k.toFixed(1)}K`;
    }
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(n);
}
