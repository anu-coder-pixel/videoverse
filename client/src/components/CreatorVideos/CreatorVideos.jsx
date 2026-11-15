import { useEffect, useState } from 'react';
import {
  UploadCloud, Film, Play, AlertCircle, Clock, CheckCircle2,
  Trash2, RefreshCw, Layers
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './CreatorVideos.css';

export default function CreatorVideos() {
  const {
    currentUser,
    openAuthModal,
    openUploadModal,
    navigateToWatch,
    creatorVideos,
    creatorVideosLoading,
    fetchCreatorVideos,
    showToast,
  } = useApp();

  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (currentUser) {
      fetchCreatorVideos();
    }
  }, [currentUser, fetchCreatorVideos]);

  async function handleDeleteVideo(video) {
    if (!window.confirm(`Are you sure you want to delete "${video.title}"?`)) {
      return;
    }

    setDeletingId(video.id);
    try {
      // Find matching session if any or delete via upload endpoint
      const res = await fetch(`/api/upload/my/videos/${video.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        showToast('Video removed successfully.');
        fetchCreatorVideos();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Could not delete: ${err.error || 'Server error'}`);
      }
    } catch (err) {
      showToast(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  if (!currentUser) {
    return (
      <div className="creator-videos creator-videos--unauth animate-fade-in">
        <div className="creator-videos__unauth-card glass">
          <UploadCloud size={48} className="text-brand-primary" />
          <h2>Creator Studio & Uploads</h2>
          <p>Sign in to your VideoVerse account to upload videos and manage your video library.</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={openAuthModal}
            id="creator-signin-btn"
          >
            Sign In to Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="creator-videos animate-fade-in" id="creator-videos-container">
      {/* Header */}
      <div className="creator-videos__header">
        <div className="creator-videos__title-area">
          <div className="creator-videos__icon-badge">
            <Layers size={22} />
          </div>
          <div>
            <h2>My Uploaded Videos</h2>
            <p className="creator-videos__sub">
              Manage, monitor processing status, and review videos you've published.
            </p>
          </div>
        </div>

        <div className="creator-videos__header-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={fetchCreatorVideos}
            title="Refresh list"
            disabled={creatorVideosLoading}
          >
            <RefreshCw size={15} className={creatorVideosLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={openUploadModal}
            id="creator-upload-btn"
          >
            <UploadCloud size={16} />
            <span>Upload Video</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {creatorVideosLoading && !creatorVideos.length && (
        <div className="creator-videos__loading-skeleton" aria-label="Loading your videos">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="creator-video-skeleton glass">
              <div className="creator-video-skeleton__thumb" />
              <div className="creator-video-skeleton__details">
                <div className="creator-video-skeleton__line creator-video-skeleton__line--title" />
                <div className="creator-video-skeleton__line creator-video-skeleton__line--sub" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!creatorVideosLoading && creatorVideos.length === 0 && (
        <div className="creator-videos__empty-state glass animate-fade-in">
          <div className="creator-videos__empty-icon">
            <Film size={54} />
          </div>
          <h3>No videos uploaded yet</h3>
          <p>Upload your first video to start building your channel on VideoVerse!</p>
          <button
            type="button"
            className="btn btn--primary creator-videos__empty-btn"
            onClick={openUploadModal}
            id="empty-upload-cta-btn"
          >
            <UploadCloud size={16} />
            <span>Upload Your First Video</span>
          </button>
        </div>
      )}

      {/* Videos List */}
      {creatorVideos.length > 0 && (
        <div className="creator-videos__list">
          {creatorVideos.map((vid) => {
            const isReady = vid.processingStatus === 'ready' || !vid.processingStatus;
            const isProcessing = vid.processingStatus === 'processing';
            const isUploading = vid.processingStatus === 'uploading';
            const isFailed = vid.processingStatus === 'failed';

            return (
              <div key={vid.id || vid._id} className="creator-video-item glass animate-fade-in">
                {/* Thumbnail */}
                <div
                  className={`creator-video-item__thumb-wrapper ${isReady ? 'creator-video-item__thumb-wrapper--clickable' : ''}`}
                  onClick={() => isReady && navigateToWatch(vid)}
                >
                  <img
                    src={vid.thumbnailUrl || '/api/placeholder/320/180'}
                    alt={vid.title}
                    className="creator-video-item__thumb"
                  />
                  {vid.duration && (
                    <span className="creator-video-item__duration">{vid.duration}</span>
                  )}
                  {isReady && (
                    <div className="creator-video-item__play-overlay">
                      <Play size={24} fill="white" />
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="creator-video-item__details">
                  <div className="creator-video-item__top-row">
                    <h3
                      className={`creator-video-item__title truncate ${isReady ? 'creator-video-item__title--clickable' : ''}`}
                      onClick={() => isReady && navigateToWatch(vid)}
                    >
                      {vid.title}
                    </h3>

                    {/* Status Badge */}
                    <div className="creator-video-item__badge-wrapper">
                      {isReady && (
                        <span className="badge badge--success creator-video-item__badge">
                          <CheckCircle2 size={12} /> Ready
                        </span>
                      )}
                      {isProcessing && (
                        <span className="badge badge--category creator-video-item__badge">
                          <Clock size={12} className="animate-spin" /> Processing ({vid.processingProgress || 50}%)
                        </span>
                      )}
                      {isUploading && (
                        <span className="badge badge--mock creator-video-item__badge">
                          <Clock size={12} /> Uploading...
                        </span>
                      )}
                      {isFailed && (
                        <span className="badge badge--danger creator-video-item__badge" title={vid.processingError || 'Processing error'}>
                          <AlertCircle size={12} /> Failed
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="creator-video-item__meta">
                    <span className="badge badge--category">{vid.category || 'General'}</span>
                    <span>·</span>
                    <span>ID: <code>{vid.id}</code></span>
                    {vid.uploadedAt && (
                      <>
                        <span>·</span>
                        <span>{vid.uploadedAt}</span>
                      </>
                    )}
                    {vid.views && (
                      <>
                        <span>·</span>
                        <span>{vid.views} views</span>
                      </>
                    )}
                    {vid.fileSize && (
                      <>
                        <span>·</span>
                        <span>{(vid.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                      </>
                    )}
                    {vid.thumbnailType === 'placeholder_svg' && (
                      <>
                        <span>·</span>
                        <span className="badge badge--mock" title="Generated graphic placeholder (FFmpeg unavailable)">SVG Graphic</span>
                      </>
                    )}
                  </p>

                  {isProcessing && (
                    <div className="creator-video-item__progress-bar">
                      <div
                        className="creator-video-item__progress-fill"
                        style={{ width: `${vid.processingProgress || 50}%` }}
                      />
                    </div>
                  )}

                  {isFailed && vid.processingError && (
                    <p className="creator-video-item__error-text">
                      <AlertCircle size={14} />
                      <span>{vid.processingError}</span>
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="creator-video-item__actions">
                  {isReady && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => navigateToWatch(vid)}
                    >
                      <Play size={14} />
                      <span>Watch</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm text-danger"
                    onClick={() => handleDeleteVideo(vid)}
                    disabled={deletingId === vid.id}
                    title="Delete Video"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

