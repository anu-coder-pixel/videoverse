import { useState, useEffect, useCallback } from 'react';
import {
  ThumbsUp,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Globe,
  AlertCircle,
  ShieldAlert,
  Send,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './CommentsSection.css';

/**
 * Language script labels for user clarity
 */
const LANGUAGE_NAMES = {
  hi: 'Hindi',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  en: 'English',
};

export default function CommentsSection({ videoId }) {
  const { currentUser, openAuthModal, showToast } = useApp();

  const [comments, setComments] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [sortBy, setSortBy] = useState('top'); // 'top' | 'newest'
  const [showAll, setShowAll] = useState(false);

  // Moderation & Feedback notices
  const [moderationNotice, setModerationNotice] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Translation states
  const [translatingMap, setTranslatingMap] = useState({});
  const [translationsMap, setTranslationsMap] = useState({});
  const [translationFeedbackMap, setTranslationFeedbackMap] = useState({});

  // ── Fetch comments from MongoDB ──────────────────────────────────────────
  const fetchComments = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/videos/${videoId}/comments?sort=${sortBy}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(`Failed to load comments (HTTP ${res.status})`);
      }

      const data = await res.json();
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setTotalCount(typeof data.total === 'number' ? data.total : (data.comments ? data.comments.length : 0));
    } catch (err) {
      console.error('[Fetch Comments Error]', err);
      // Keep comments empty on fetch failure, never display mock comments
      setComments([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [videoId, sortBy]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // ── Handle new comment submission ────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();

    if (!newCommentText.trim()) return;

    // Requirement 7: Require authentication for posting
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to post a comment.');
      return;
    }

    setSubmitting(true);
    setModerationNotice(null);
    setErrorMessage(null);

    try {
      // Requirement 5: Author identity is derived exclusively from authenticated session.
      // We only send the text field to the server.
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          text: newCommentText.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Moderation Option A: Severe prohibited content rejected (HTTP 400)
        const errorText = data.error || 'Failed to post comment.';
        setErrorMessage(errorText);
        showToast(errorText, 4000);
        return;
      }

      // Moderation Option A: Borderline content flagged
      if (data.flagged) {
        setModerationNotice(
          data.message || 'Your comment was submitted and is pending automated review before appearing publicly.'
        );
        setNewCommentText('');
        showToast('Comment submitted for automated review.', 3500);
        return;
      }

      // Approved comment
      if (data.comment) {
        setComments(prev => [data.comment, ...prev]);
        setTotalCount(prev => prev + 1);
        setNewCommentText('');
        showToast('Comment posted successfully!');
      }
    } catch (err) {
      console.error('[Submit Comment Error]', err);
      setErrorMessage('Network error while posting comment. Please try again.');
      showToast('Network error while posting comment.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Concurrency-Safe Like Toggle ─────────────────────────────────────────
  async function handleLikeToggle(commentId) {
    // Requirement 7: Require authentication for liking
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to like comments.');
      return;
    }

    const currentComment = comments.find(c => c.id === commentId);
    if (!currentComment) return;

    const currentlyLiked = !!currentComment.hasLiked;
    const targetAction = currentlyLiked ? 'unlike' : 'like';

    // Optimistic UI update
    setComments(prev =>
      prev.map(c => {
        if (c.id === commentId) {
          return {
            ...c,
            hasLiked: !currentlyLiked,
            likesCount: Math.max(0, c.likesCount + (currentlyLiked ? -1 : 1)),
          };
        }
        return c;
      })
    );

    try {
      const res = await fetch(`/api/comments/${commentId}/like`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ action: targetAction }),
      });

      if (!res.ok) {
        throw new Error('Failed to update like status');
      }

      const result = await res.json();

      // Sync with authoritative server count
      setComments(prev =>
        prev.map(c => {
          if (c.id === commentId) {
            return {
              ...c,
              hasLiked: !!result.liked,
              likesCount: typeof result.likesCount === 'number' ? result.likesCount : c.likesCount,
            };
          }
          return c;
        })
      );
    } catch (err) {
      console.error('[Like Comment Error]', err);
      // Rollback optimistic update
      setComments(prev =>
        prev.map(c => {
          if (c.id === commentId) {
            return {
              ...c,
              hasLiked: currentlyLiked,
              likesCount: currentComment.likesCount,
            };
          }
          return c;
        })
      );
      showToast('Could not update like. Please try again.');
    }
  }

  // ── Multilingual Translation ─────────────────────────────────────────────
  async function handleTranslate(comment) {
    const commentId = comment.id;

    // Toggle back to original if already translated
    if (translationsMap[commentId]) {
      setTranslationsMap(prev => ({
        ...prev,
        [commentId]: {
          ...prev[commentId],
          isShowingTranslated: !prev[commentId].isShowingTranslated,
        },
      }));
      return;
    }

    setTranslatingMap(prev => ({ ...prev, [commentId]: true }));
    setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: null }));

    try {
      const res = await fetch(`/api/comments/${commentId}/translate?target=en`);
      const data = await res.json();

      if (data.translated && data.translatedText) {
        setTranslationsMap(prev => ({
          ...prev,
          [commentId]: {
            translatedText: data.translatedText,
            sourceLanguage: data.sourceLanguage,
            targetLanguage: data.targetLanguage,
            provider: data.provider,
            privacyNote: data.privacyNote,
            limitations: data.limitations,
            isShowingTranslated: true,
          },
        }));
      } else {
        // Handle failure or already-target gracefully
        const feedback = data.message || data.error || 'Translation is not available for this comment.';
        setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: feedback }));
        setTimeout(() => {
          setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: null }));
        }, 4000);
      }
    } catch (err) {
      console.error('[Translation Error]', err);
      setTranslationFeedbackMap(prev => ({
        ...prev,
        [commentId]: 'Translation request timed out or failed.',
      }));
      setTimeout(() => {
        setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: null }));
      }, 4000);
    } finally {
      setTranslatingMap(prev => ({ ...prev, [commentId]: false }));
    }
  }

  const displayedComments = showAll ? comments : comments.slice(0, 5);

  return (
    <section className="comments" aria-labelledby="comments-heading">
      {/* Header */}
      <div className="comments__header">
        <h2 className="comments__title" id="comments-heading">
          {totalCount} {totalCount === 1 ? 'Comment' : 'Comments'}
        </h2>
        <div className="comments__controls">
          <select
            className="comments__sort"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            aria-label="Sort comments"
            id="comments-sort-select"
          >
            <option value="top">Top Comments</option>
            <option value="newest">Newest First</option>
          </select>
        </div>
      </div>

      {/* Moderation Notices */}
      {moderationNotice && (
        <div className="comments__notice comments__notice--flagged" role="status">
          <ShieldAlert size={18} className="comments__notice-icon" />
          <div className="comments__notice-content">
            <strong>Pending Moderation Review:</strong>
            <p>{moderationNotice}</p>
          </div>
          <button
            type="button"
            className="comments__notice-close"
            onClick={() => setModerationNotice(null)}
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="comments__notice comments__notice--error" role="alert">
          <AlertCircle size={18} className="comments__notice-icon" />
          <div className="comments__notice-content">
            <strong>Community Guidelines:</strong>
            <p>{errorMessage}</p>
          </div>
          <button
            type="button"
            className="comments__notice-close"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      )}

      {/* Add comment form */}
      <form className="comments__add-form" onSubmit={handleSubmit}>
        <div
          className="comments__add-avatar"
          style={{ background: currentUser?.avatarColor || '#6c63ff' }}
          aria-hidden="true"
        >
          {currentUser?.initials || 'G'}
        </div>
        <div className="comments__add-input-wrapper">
          <label htmlFor="new-comment-input" className="sr-only">
            Add a public comment
          </label>
          <input
            id="new-comment-input"
            type="text"
            className="comments__add-input"
            placeholder={
              currentUser
                ? 'Add a comment (supports multilingual Unicode: हिंदी, 日本語, العربية…)'
                : 'Sign in to add a public comment…'
            }
            value={newCommentText}
            onChange={e => setNewCommentText(e.target.value)}
            onFocus={() => {
              if (!currentUser) {
                openAuthModal();
                showToast('Please sign in to post a comment.');
              }
            }}
            maxLength={1000}
            disabled={submitting}
          />
          {newCommentText && (
            <div className="comments__add-actions">
              <button
                type="button"
                className="comments__cancel-btn"
                onClick={() => setNewCommentText('')}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="comments__submit-btn"
                id="submit-comment-btn"
                disabled={submitting || !newCommentText.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Posting…</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>Comment</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Loading state */}
      {loading && (
        <div className="comments__loading">
          <Loader2 size={24} className="animate-spin comments__spinner" />
          <span>Loading comments…</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && comments.length === 0 && (
        <div className="comments__empty" id="comments-empty-state">
          <MessageSquare size={32} className="comments__empty-icon" />
          <p className="comments__empty-title">No comments yet</p>
          <p className="comments__empty-subtitle">
            Be the first to share your thoughts on this video!
          </p>
        </div>
      )}

      {/* Comment list */}
      {!loading && comments.length > 0 && (
        <ul className="comments__list" aria-label="Comments">
          {displayedComments.map(comment => {
            const translation = translationsMap[comment.id];
            const isTranslating = !!translatingMap[comment.id];
            const translationFeedback = translationFeedbackMap[comment.id];
            const showTranslated = translation && translation.isShowingTranslated;
            const isNonEnglish = comment.language && comment.language !== 'en';

            return (
              <li key={comment.id} className="comment animate-fade-in" id={`comment-${comment.id}`}>
                <div
                  className="comment__avatar"
                  style={{ background: comment.authorColor || '#6c63ff' }}
                  aria-hidden="true"
                >
                  {comment.authorInitials || 'U'}
                </div>
                <div className="comment__body">
                  <div className="comment__meta">
                    <span className="comment__author">{comment.author}</span>
                    <span className="comment__time">{comment.timeAgo || 'recently'}</span>
                    {isNonEnglish && (
                      <span className="comment__lang-badge" title={`Detected script: ${LANGUAGE_NAMES[comment.language] || comment.language}`}>
                        {LANGUAGE_NAMES[comment.language] || comment.language.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Comment text with native Unicode RTL/LTR support */}
                  <p className="comment__text" dir="auto">
                    {showTranslated ? translation.translatedText : comment.text}
                  </p>

                  {/* Translation Box / Attribution */}
                  {showTranslated && (
                    <div className="comment__translation-info">
                      <Sparkles size={12} className="comment__translation-icon" />
                      <span>
                        Translated to English via {translation.provider || 'MyMemory'}
                      </span>
                      <button
                        type="button"
                        className="comment__toggle-original-btn"
                        onClick={() => handleTranslate(comment)}
                      >
                        Show original
                      </button>
                    </div>
                  )}

                  {/* Translation Feedback (failure / already in language) */}
                  {translationFeedback && (
                    <div className="comment__translation-feedback">
                      <AlertCircle size={12} />
                      <span>{translationFeedback}</span>
                    </div>
                  )}

                  {/* Comment Actions */}
                  <div className="comment__actions">
                    <button
                      className={`comment__action-btn ${comment.hasLiked ? 'comment__action-btn--liked' : ''}`}
                      onClick={() => handleLikeToggle(comment.id)}
                      aria-label={`Like comment by ${comment.author}. Current likes: ${comment.likesCount}`}
                      aria-pressed={!!comment.hasLiked}
                    >
                      <ThumbsUp size={13} />
                      <span>{comment.likesCount || 0}</span>
                    </button>

                    {/* Translation Button */}
                    <button
                      className={`comment__action-btn ${showTranslated ? 'comment__action-btn--active' : ''}`}
                      onClick={() => handleTranslate(comment)}
                      disabled={isTranslating}
                      aria-label={`Translate comment by ${comment.author}`}
                      title="Translate comment to English"
                    >
                      {isTranslating ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Globe size={13} />
                      )}
                      <span>
                        {isTranslating
                          ? 'Translating…'
                          : showTranslated
                          ? 'Show Original'
                          : 'Translate'}
                      </span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Show more toggle */}
      {!loading && comments.length > 5 && (
        <button
          className="comments__show-more"
          onClick={() => setShowAll(p => !p)}
          id="show-more-comments-btn"
        >
          {showAll ? (
            <>
              <ChevronUp size={14} /> Show fewer comments
            </>
          ) : (
            <>
              <ChevronDown size={14} /> Show all {comments.length} comments
            </>
          )}
        </button>
      )}
    </section>
  );
}
