import { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, X, Film, CheckCircle, AlertCircle, Loader2,
  FileVideo, ArrowRight, RefreshCw, Eye
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './UploadModal.css';

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
const CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

const UPLOAD_CATEGORIES = [
  'Technology',
  'Gaming',
  'Music',
  'Education',
  'Travel',
  'Science',
  'Cooking',
  'Sports',
  'Animation',
  'Documentary',
  'Comedy',
  'News',
  'Fitness',
];

export default function UploadModal() {
  const {
    uploadModalOpen,
    closeUploadModal,
    currentUser,
    openAuthModal,
    refetchVideos,
    fetchCreatorVideos,
    navigateToWatch,
    selectSidebarItem,
    showToast,
  } = useApp();

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Technology');
  const [tags, setTags] = useState('');
  const [dragActive, setDragActive] = useState(false);

  // Upload state: 'idle' | 'uploading' | 'processing' | 'ready' | 'failed'
  const [uploadState, setUploadState] = useState('idle');
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100%
  const [processingProgress, setProcessingProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [completedVideo, setCompletedVideo] = useState(null);
  const [activeUploadId, setActiveUploadId] = useState(null);

  const fileInputRef = useRef(null);
  const isCancelledRef = useRef(false);
  const pollTimerRef = useRef(null);

  // Reset state when modal is closed
  const resetForm = useCallback(() => {
    setFile(null);
    setTitle('');
    setDescription('');
    setCategory('Technology');
    setTags('');
    setUploadState('idle');
    setUploadProgress(0);
    setProcessingProgress(0);
    setStatusMessage('');
    setErrorMessage('');
    setCompletedVideo(null);
    setActiveUploadId(null);
    isCancelledRef.current = false;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!uploadModalOpen) {
      resetForm();
    }
  }, [uploadModalOpen, resetForm]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  if (!uploadModalOpen) return null;

  function handleFileSelect(selectedFile) {
    if (!selectedFile) return;

    // Validate type
    const validMimes = ['video/mp4', 'video/webm'];
    const validExts = ['.mp4', '.webm'];
    const nameLower = selectedFile.name.toLowerCase();
    const hasValidExt = validExts.some(ext => nameLower.endsWith(ext));

    if (!validMimes.includes(selectedFile.type) && !hasValidExt) {
      setErrorMessage('Unsupported file format. Please select an MP4 or WebM video.');
      return;
    }

    // Validate size (500 MB limit)
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(`File exceeds the 500 MB limit (${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB).`);
      return;
    }

    setErrorMessage('');
    setFile(selectedFile);
    if (!title.trim()) {
      // Auto-populate title without extension
      const defaultTitle = selectedFile.name.replace(/\.[^/.]+$/, '').slice(0, 100);
      setTitle(defaultTitle);
    }
  }

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  // Poll processing status
  function startStatusPolling(uploadId) {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    const poll = async () => {
      if (isCancelledRef.current) return;

      try {
        const res = await fetch(`/api/upload/${uploadId}/status`, {
          credentials: 'include',
        });
        if (!res.ok) return;

        const data = await res.json();
        if (isCancelledRef.current) return;

        if (data.status === 'processing') {
          setUploadState('processing');
          setProcessingProgress(data.processingProgress || 50);
          setStatusMessage(
            data.processingProgress >= 70
              ? 'Extracting metadata, duration, and generating thumbnails...'
              : 'Assembling uploaded video chunks...'
          );
        } else if (data.status === 'completed' || data.video?.processingStatus === 'ready') {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setUploadState('ready');
          setProcessingProgress(100);
          setCompletedVideo(data.video);
          showToast('🎉 Video processed successfully and published!');
          if (typeof refetchVideos === 'function') refetchVideos();
          if (typeof fetchCreatorVideos === 'function') fetchCreatorVideos();
        } else if (data.status === 'failed' || data.video?.processingStatus === 'failed') {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setUploadState('failed');
          setErrorMessage(data.video?.processingError || data.errorMessage || 'Video processing failed.');
        }
      } catch (err) {
        console.warn('[UploadModal] Status poll error:', err.message);
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, 1500);
  }

  // Cancel in-flight upload
  async function handleCancel() {
    isCancelledRef.current = true;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (activeUploadId) {
      try {
        await fetch(`/api/upload/${activeUploadId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch (err) {
        console.warn('[UploadModal] Cancel cleanup warning:', err.message);
      }
    }

    showToast('Upload cancelled.');
    resetForm();
  }

  // Execute chunked upload
  async function handleSubmit(e) {
    e.preventDefault();

    if (!currentUser) {
      closeUploadModal();
      openAuthModal();
      showToast('Please sign in to upload videos.');
      return;
    }

    if (!file) {
      setErrorMessage('Please select a video file.');
      return;
    }

    if (!title.trim()) {
      setErrorMessage('Video title is required.');
      return;
    }

    setErrorMessage('');
    setUploadState('uploading');
    setUploadProgress(0);
    setStatusMessage('Initializing upload session...');
    isCancelledRef.current = false;

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);

    try {
      // Step 1: Initialize session
      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || (file.name.endsWith('.webm') ? 'video/webm' : 'video/mp4'),
          totalChunks,
        }),
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(errData.error || `Initialization failed (HTTP ${initRes.status})`);
      }

      const { uploadId } = await initRes.json();
      setActiveUploadId(uploadId);

      // Step 2: Upload chunks sequentially
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (isCancelledRef.current) return;

        const start = chunkIndex * CHUNK_SIZE_BYTES;
        const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
        const chunkBlob = file.slice(start, end);

        setStatusMessage(`Uploading chunk ${chunkIndex + 1} of ${totalChunks}...`);

        const chunkRes = await fetch(`/api/upload/${uploadId}/chunk/${chunkIndex}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          credentials: 'include',
          body: chunkBlob,
        });

        if (!chunkRes.ok) {
          const errData = await chunkRes.json().catch(() => ({}));
          throw new Error(errData.error || `Chunk ${chunkIndex + 1} upload failed`);
        }

        const pct = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        setUploadProgress(pct);
      }

      // Step 3: All chunks uploaded, transition to processing & poll status
      setStatusMessage('All chunks uploaded! Assembling video and extracting metadata...');
      setUploadState('processing');
      setProcessingProgress(25);
      startStatusPolling(uploadId);

    } catch (err) {
      if (!isCancelledRef.current) {
        setUploadState('failed');
        setErrorMessage(err.message || 'Upload encountered an error.');
      }
    }
  }

  function handleWatchUploadedVideo() {
    closeUploadModal();
    if (completedVideo) {
      navigateToWatch(completedVideo);
    }
  }

  function handleGoToMyVideos() {
    closeUploadModal();
    selectSidebarItem('my-videos');
  }

  return (
    <div className="upload-modal__overlay animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title">
      <div className="upload-modal__dialog glass">
        {/* Header */}
        <div className="upload-modal__header">
          <div className="upload-modal__brand">
            <div className="upload-modal__icon-badge">
              <UploadCloud size={18} />
            </div>
            <h2 id="upload-modal-title" className="upload-modal__title">
              {uploadState === 'ready' ? 'Upload Complete' : 'Upload Video'}
            </h2>
          </div>
          <button
            type="button"
            className="upload-modal__close-btn"
            onClick={uploadState === 'uploading' ? handleCancel : closeUploadModal}
            aria-label="Close upload modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="upload-modal__error-alert animate-fade-in" role="alert">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* State: Ready / Success */}
        {uploadState === 'ready' && completedVideo && (
          <div className="upload-modal__success-view animate-fade-in">
            <div className="upload-modal__success-icon">
              <CheckCircle size={54} className="text-success" />
            </div>
            <h3>Your video is ready to stream!</h3>
            <p className="upload-modal__success-sub">
              Processed with duration <strong>{completedVideo.duration || '0:00'}</strong>{completedVideo.durationEstimated ? ' (estimated)' : ''} and resolution <strong>{completedVideo.resolution || '1080p'}</strong>{completedVideo.resolutionEstimated ? ' (estimated)' : ''}.
              {completedVideo.thumbnailType === 'placeholder_svg' && (
                <span className="upload-modal__placeholder-notice"> · Branded SVG Graphic (FFmpeg frame extraction fallback)</span>
              )}
            </p>

            <div className="upload-modal__video-preview-card">
              <img
                src={completedVideo.thumbnailUrl || '/api/placeholder/400/225'}
                alt={completedVideo.title}
                className="upload-modal__preview-thumb"
              />
              <div className="upload-modal__preview-meta">
                <span className="upload-modal__preview-title truncate">{completedVideo.title}</span>
                <span className="upload-modal__preview-category badge badge--category">{completedVideo.category}</span>
                <span className="upload-modal__preview-id">ID: {completedVideo.id}</span>
              </div>
            </div>

            <div className="upload-modal__success-actions">
              <button
                type="button"
                className="btn btn--primary upload-modal__action-btn"
                onClick={handleWatchUploadedVideo}
                id="upload-watch-btn"
              >
                <Eye size={16} />
                <span>Watch Video</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary upload-modal__action-btn"
                onClick={handleGoToMyVideos}
                id="upload-my-videos-btn"
              >
                <Film size={16} />
                <span>My Videos</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost upload-modal__action-btn"
                onClick={resetForm}
              >
                Upload Another
              </button>
            </div>
          </div>
        )}

        {/* State: Uploading or Processing Progress */}
        {(uploadState === 'uploading' || uploadState === 'processing') && (
          <div className="upload-modal__progress-view animate-fade-in">
            <div className="upload-modal__progress-header">
              <div className="upload-modal__status-badge">
                <Loader2 size={16} className="animate-spin text-brand-primary" />
                <span>{uploadState === 'uploading' ? 'Uploading...' : 'Processing on Server...'}</span>
              </div>
              <span className="upload-modal__progress-pct">
                {uploadState === 'uploading' ? `${uploadProgress}%` : `${processingProgress}%`}
              </span>
            </div>

            <div className="upload-modal__progress-bar">
              <div
                className="upload-modal__progress-fill"
                style={{
                  width: `${uploadState === 'uploading' ? uploadProgress : processingProgress}%`,
                }}
              />
            </div>

            <p className="upload-modal__status-detail">
              {statusMessage || 'Processing your video pipeline...'}
            </p>

            <div className="upload-modal__file-info-badge">
              <FileVideo size={16} />
              <span className="truncate">{file?.name}</span>
              <span>({(file ? file.size / (1024 * 1024) : 0).toFixed(1)} MB)</span>
            </div>

            <div className="upload-modal__progress-footer">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleCancel}
                id="upload-cancel-btn"
              >
                Cancel Upload
              </button>
            </div>
          </div>
        )}

        {/* State: Failed */}
        {uploadState === 'failed' && (
          <div className="upload-modal__failed-view animate-fade-in">
            <div className="upload-modal__failed-icon">
              <AlertCircle size={48} className="text-danger" />
            </div>
            <h3>Upload Failed</h3>
            <p className="text-secondary">{errorMessage || 'An error occurred during upload or video processing.'}</p>
            <div className="upload-modal__failed-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setUploadState('idle')}
              >
                <RefreshCw size={16} />
                <span>Try Again</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeUploadModal}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* State: Idle / Form input */}
        {uploadState === 'idle' && (
          <form className="upload-modal__form" onSubmit={handleSubmit}>
            {/* File Drag and Drop Zone */}
            <div
              className={`upload-modal__dropzone ${dragActive ? 'upload-modal__dropzone--active' : ''} ${file ? 'upload-modal__dropzone--has-file' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,.mp4,.webm"
                className="upload-modal__file-input"
                onChange={e => e.target.files && handleFileSelect(e.target.files[0])}
                style={{ display: 'none' }}
                id="video-file-picker"
              />

              {file ? (
                <div className="upload-modal__selected-file">
                  <FileVideo size={36} className="text-brand-primary" />
                  <div className="upload-modal__file-meta">
                    <p className="upload-modal__filename truncate">{file.name}</p>
                    <p className="upload-modal__filesize">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB · {file.type || 'video'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="upload-modal__change-file-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="upload-modal__dropzone-prompt">
                  <UploadCloud size={44} className="upload-modal__dropzone-icon" />
                  <p className="upload-modal__dropzone-title">
                    Drag and drop video files to upload
                  </p>
                  <p className="upload-modal__dropzone-sub">
                    MP4 or WebM up to 500 MB · Chunked & Resumable
                  </p>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm upload-modal__select-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Select File
                  </button>
                </div>
              )}
            </div>

            {/* Video Details */}
            <div className="upload-modal__fields">
              <div className="form-group">
                <label htmlFor="upload-title">Title (required)</label>
                <input
                  id="upload-title"
                  type="text"
                  maxLength={200}
                  className="input upload-modal__input"
                  placeholder="Add a title that describes your video"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                />
                <span className="upload-modal__char-count">{title.length}/200</span>
              </div>

              <div className="form-row">
                <div className="form-group form-group--half">
                  <label htmlFor="upload-category">Category</label>
                  <select
                    id="upload-category"
                    className="input upload-modal__select"
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                  >
                    {UPLOAD_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group form-group--half">
                  <label htmlFor="upload-tags">Tags (comma-separated)</label>
                  <input
                    id="upload-tags"
                    type="text"
                    className="input upload-modal__input"
                    placeholder="e.g. react, tutorial, coding"
                    value={tags}
                    onChange={e => setTags(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="upload-description">Description</label>
                <textarea
                  id="upload-description"
                  rows={3}
                  className="input upload-modal__textarea"
                  placeholder="Tell viewers about your video"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={5000}
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="upload-modal__footer">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeUploadModal}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!file || !title.trim()}
                id="submit-upload-btn"
              >
                <span>Upload & Publish</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

