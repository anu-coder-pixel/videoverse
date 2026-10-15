import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getThumbnailStyle } from '../../data/mockData';
import './VideoCard.css';

export default function VideoCard({ video, compact = false, style }) {
  const { navigateToWatch } = useApp();
  const [hasImgError, setHasImgError] = useState(false);

  function handleClick() {
    navigateToWatch(video);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }

  // Curated reliable fallback image
  const defaultFallbackThumb = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=640&q=80';
  const displayThumbUrl = video.thumbnailUrl || defaultFallbackThumb;

  return (
    <article
      className={`video-card animate-fade-in ${compact ? 'video-card--compact' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`Watch "${video.title}" by ${video.channel.name}`}
      id={`video-card-${video.id}`}
    >
      {/* Thumbnail */}
      <div className="video-card__thumb-wrapper">
        {!hasImgError ? (
          <img
            className="video-card__thumb"
            src={displayThumbUrl}
            alt={video.title}
            loading="lazy"
            decoding="async"
            onError={() => setHasImgError(true)}
          />
        ) : (
          <div
            className="video-card__thumb video-card__thumb--fallback"
            style={getThumbnailStyle(video.thumbnailIndex || 0)}
            aria-label={video.title}
          >
            <span className="video-card__fallback-badge">VideoVerse</span>
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="video-card__play-overlay" aria-hidden="true">
          <svg className="video-card__play-icon" viewBox="0 0 24 24" fill="white">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>

        {/* Duration badge */}
        <span className="video-card__duration" aria-label={`Duration: ${video.duration}`}>
          {video.duration}
        </span>
      </div>

      {/* Info row */}
      <div className="video-card__info">
        {/* Channel avatar */}
        <div
          className="video-card__channel-avatar"
          style={{ background: video.channel.avatarColor }}
          aria-hidden="true"
        >
          {video.channel.initials}
        </div>

        {/* Meta */}
        <div className="video-card__meta">
          <h3 className="video-card__title line-clamp-2">{video.title}</h3>
          <div className="video-card__channel-row">
            <span className="video-card__channel-name">{video.channel.name}</span>
            {video.channel.verified && (
              <CheckCircle2
                size={13}
                className="video-card__verified"
                aria-label="Verified channel"
              />
            )}
          </div>
          <p className="video-card__stats">
            {video.views} views · {video.uploadedAt}
          </p>
        </div>
      </div>

      {/* Category tag */}
      <span className="video-card__category">{video.category}</span>
    </article>
  );
}
