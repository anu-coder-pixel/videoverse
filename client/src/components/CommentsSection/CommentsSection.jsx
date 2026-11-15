import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Globe,
  AlertCircle,
  ShieldAlert,
  Send,
  Loader2,
  Sparkles,
  Edit2,
  Trash2,
  Check,
  X,
  Flag,
  Reply,
  AtSign,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './CommentsSection.css';

/**
 * Complete language script labels for user clarity
 */
const LANGUAGE_NAMES = {
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  pa: 'Punjabi',
  gu: 'Gujarati',
  ml: 'Malayalam',
  ur: 'Urdu',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  en: 'English',
};

/**
 * Format timestamp into relative time string matching server format
 */
function formatTimeAgo(date) {
  if (!date) return 'just now';
  const parsed = new Date(date).getTime();
  if (isNaN(parsed)) return 'recently';
  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (seconds < 0 || seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Renders comment text with clickable @username tags
 */
function renderCommentTextWithMentions(text, showToast) {
  if (!text) return null;
  const parts = text.split(/(@[a-zA-Z0-9_]{2,30})/g);
  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      const handle = part.slice(1);
      return (
        <span
          key={index}
          className="comment__mention-tag"
          onClick={(e) => {
            e.stopPropagation();
            if (showToast) showToast(`Viewing profile for @${handle}`);
          }}
          title={`Mentioned user @${handle}`}
          role="button"
          tabIndex={0}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export default function CommentsSection({ videoId }) {
  const { currentUser, openAuthModal, showToast } = useApp();

  const [comments, setComments] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [sortBy, setSortBy] = useState('top'); // 'top' | 'newest' | 'oldest'
  const [showAll, setShowAll] = useState(false);

  // Edit & Delete state
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);

  // Moderation & Feedback notices
  const [moderationNotice, setModerationNotice] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Translation states
  const [translatingMap, setTranslatingMap] = useState({});
  const [translationsMap, setTranslationsMap] = useState({});
  const [translationFeedbackMap, setTranslationFeedbackMap] = useState({});

  // CAPTCHA / Challenge state
  const [captchaChallenge, setCaptchaChallenge] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  // Report state
  const [reportingCommentId, setReportingCommentId] = useState(null);
  const [reportReason, setReportReason] = useState('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [reportingSubmitting, setReportingSubmitting] = useState(false);

  // Nested Replies states
  const [replyingCommentId, setReplyingCommentId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState({}); // commentId -> boolean

  // Autocomplete @mention states
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionTargetInput, setMentionTargetInput] = useState(null); // 'main' | 'reply' | 'edit'
  const mentionSearchTimeout = useRef(null);

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
      setComments([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [videoId, sortBy]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // ── Autocomplete @mention Search ──────────────────────────────────────────
  const handleMentionSearch = useCallback((text, cursorPosition, targetInput) => {
    const textBeforeCursor = text.slice(0, cursorPosition);
    const lastAtMatch = textBeforeCursor.match(/@([a-zA-Z0-9_]*)$/);

    if (lastAtMatch) {
      const query = lastAtMatch[1];
      setMentionQuery(query);
      setMentionTargetInput(targetInput);

      if (mentionSearchTimeout.current) clearTimeout(mentionSearchTimeout.current);
      mentionSearchTimeout.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/comments/mention-search?q=${encodeURIComponent(query || 'a')}`, {
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            setMentionSuggestions(data.users || []);
            setMentionActiveIndex(0);
          }
        } catch (err) {
          console.error('[Mention Autocomplete Error]', err);
        }
      }, 150);
    } else {
      setMentionQuery(null);
      setMentionSuggestions([]);
    }
  }, []);

  function handleSelectMention(user) {
    const usernameTag = `@${user.username} `;
    if (mentionTargetInput === 'main') {
      const newText = newCommentText.replace(/@([a-zA-Z0-9_]*)$/, usernameTag);
      setNewCommentText(newText);
    } else if (mentionTargetInput === 'reply') {
      const newText = replyText.replace(/@([a-zA-Z0-9_]*)$/, usernameTag);
      setReplyText(newText);
    } else if (mentionTargetInput === 'edit') {
      const newText = editingText.replace(/@([a-zA-Z0-9_]*)$/, usernameTag);
      setEditingText(newText);
    }
    setMentionQuery(null);
    setMentionSuggestions([]);
  }

  // ── Handle new top-level comment submission ──────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!newCommentText.trim()) return;

    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to post a comment.');
      return;
    }

    setSubmitting(true);
    setModerationNotice(null);
    setErrorMessage(null);

    try {
      const payload = {
        text: newCommentText.trim(),
      };
      if (captchaChallenge && captchaAnswer) {
        payload.challengeToken = captchaChallenge.token;
        payload.challengeAnswer = captchaAnswer.trim();
      }

      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.requiresChallenge) {
        setCaptchaChallenge(data.challenge);
        setCaptchaAnswer('');
        showToast(data.error || 'Please solve the security challenge to post.');
        return;
      }

      if (!res.ok) {
        const errorText = data.error || 'Failed to post comment.';
        setErrorMessage(errorText);
        showToast(errorText, 4000);
        return;
      }

      setCaptchaChallenge(null);
      setCaptchaAnswer('');

      if (data.flagged) {
        setModerationNotice(
          data.message || 'Your comment was submitted and is pending automated review before appearing publicly.'
        );
        setNewCommentText('');
        showToast('Comment submitted for automated review.', 3500);
        return;
      }

      if (data.comment) {
        const created = { ...data.comment, replies: [] };
        setComments(prev => [created, ...prev]);
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

  // ── Handle Reply Submission ──────────────────────────────────────────────
  async function handleReplySubmit(parentId) {
    if (!replyText.trim()) return;

    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to reply.');
      return;
    }

    setReplySubmitting(true);

    try {
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: replyText.trim(),
          parentId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Failed to post reply.');
        return;
      }

      if (data.flagged) {
        showToast('Reply submitted and pending automated review.');
        setReplyText('');
        setReplyingCommentId(null);
        return;
      }

      if (data.comment) {
        setComments(prev =>
          prev.map(c => {
            if (c.id === parentId) {
              const currentReplies = Array.isArray(c.replies) ? c.replies : [];
              return {
                ...c,
                replies: [...currentReplies, data.comment],
                repliesCount: currentReplies.length + 1,
              };
            }
            return c;
          })
        );
        setTotalCount(prev => prev + 1);
        setExpandedReplies(prev => ({ ...prev, [parentId]: true }));
        setReplyText('');
        setReplyingCommentId(null);
        showToast('Reply posted successfully!');
      }
    } catch (err) {
      console.error('[Reply Submit Error]', err);
      showToast('Network error while posting reply.');
    } finally {
      setReplySubmitting(false);
    }
  }

  // ── Toggle Replies Thread ────────────────────────────────────────────────
  function toggleReplies(commentId) {
    setExpandedReplies(prev => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  }

  // ── Concurrency-Safe Like Toggle ─────────────────────────────────────────
  async function handleLikeToggle(commentId, isReply = false, parentId = null) {
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to like comments.');
      return;
    }

    let targetComment = null;
    if (isReply && parentId) {
      const parent = comments.find(c => c.id === parentId);
      targetComment = parent?.replies?.find(r => r.id === commentId);
    } else {
      targetComment = comments.find(c => c.id === commentId);
    }
    if (!targetComment) return;

    const currentlyLiked = !!targetComment.hasLiked;
    const targetAction = currentlyLiked ? 'unlike' : 'like';

    // Optimistic UI update
    const updateLikesInTree = (prev) =>
      prev.map(c => {
        if (!isReply && c.id === commentId) {
          return {
            ...c,
            hasLiked: !currentlyLiked,
            likesCount: Math.max(0, c.likesCount + (currentlyLiked ? -1 : 1)),
          };
        }
        if (isReply && c.id === parentId && Array.isArray(c.replies)) {
          return {
            ...c,
            replies: c.replies.map(r =>
              r.id === commentId
                ? {
                    ...r,
                    hasLiked: !currentlyLiked,
                    likesCount: Math.max(0, r.likesCount + (currentlyLiked ? -1 : 1)),
                  }
                : r
            ),
          };
        }
        return c;
      });

    setComments(updateLikesInTree);

    try {
      const res = await fetch(`/api/comments/${commentId}/like`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: targetAction }),
      });

      if (!res.ok) throw new Error('Failed to update like status');
      const result = await res.json();

      setComments(prev =>
        prev.map(c => {
          if (!isReply && c.id === commentId) {
            return {
              ...c,
              hasLiked: !!result.liked,
              likesCount: typeof result.likesCount === 'number' ? result.likesCount : c.likesCount,
            };
          }
          if (isReply && c.id === parentId && Array.isArray(c.replies)) {
            return {
              ...c,
              replies: c.replies.map(r =>
                r.id === commentId
                  ? {
                      ...r,
                      hasLiked: !!result.liked,
                      likesCount: typeof result.likesCount === 'number' ? result.likesCount : r.likesCount,
                    }
                  : r
              ),
            };
          }
          return c;
        })
      );
    } catch (err) {
      console.error('[Like Comment Error]', err);
      // Revert optimistic update
      fetchComments();
      showToast('Could not update like. Please try again.');
    }
  }

  // ── Concurrency-Safe Dislike Toggle ──────────────────────────────────────
  async function handleDislikeToggle(commentId, isReply = false, parentId = null) {
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to react to comments.');
      return;
    }

    try {
      const res = await fetch(`/api/comments/${commentId}/dislike`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'dislike' }),
      });

      if (!res.ok) throw new Error('Failed to update dislike');
      const result = await res.json();

      setComments(prev =>
        prev.map(c => {
          if (!isReply && c.id === commentId) {
            return {
              ...c,
              hasDisliked: !!result.disliked,
              dislikesCount: typeof result.dislikesCount === 'number' ? result.dislikesCount : c.dislikesCount,
              hasLiked: !!result.liked,
              likesCount: typeof result.likesCount === 'number' ? result.likesCount : c.likesCount,
            };
          }
          if (isReply && c.id === parentId && Array.isArray(c.replies)) {
            return {
              ...c,
              replies: c.replies.map(r =>
                r.id === commentId
                  ? {
                      ...r,
                      hasDisliked: !!result.disliked,
                      dislikesCount: typeof result.dislikesCount === 'number' ? result.dislikesCount : r.dislikesCount,
                      hasLiked: !!result.liked,
                      likesCount: typeof result.likesCount === 'number' ? result.likesCount : r.likesCount,
                    }
                  : r
              ),
            };
          }
          return c;
        })
      );
    } catch (err) {
      console.error('[Dislike Error]', err);
      showToast('Could not update dislike.');
    }
  }

  // ── Edit Comment ──────────────────────────────────────────────────────────
  function handleStartEdit(comment) {
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
  }

  function handleCancelEdit() {
    setEditingCommentId(null);
    setEditingText('');
  }

  async function handleSaveEdit(commentId, isReply = false, parentId = null) {
    if (!editingText.trim()) return;
    setEditingSubmitting(true);

    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: editingText.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to edit comment.');
        return;
      }

      setComments(prev =>
        prev.map(c => {
          if (!isReply && c.id === commentId) {
            return { ...c, text: data.comment.text, isEdited: true, language: data.comment.language };
          }
          if (isReply && c.id === parentId && Array.isArray(c.replies)) {
            return {
              ...c,
              replies: c.replies.map(r =>
                r.id === commentId ? { ...r, text: data.comment.text, isEdited: true, language: data.comment.language } : r
              ),
            };
          }
          return c;
        })
      );
      setEditingCommentId(null);
      setEditingText('');
      showToast('Comment updated successfully!');
    } catch (err) {
      console.error('[Edit Error]', err);
      showToast('Network error while editing comment.');
    } finally {
      setEditingSubmitting(false);
    }
  }

  // ── Delete Comment (Soft or Hard Delete) ──────────────────────────────────
  async function handleDeleteComment(commentId, isReply = false, parentId = null) {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;
    setDeletingCommentId(commentId);

    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to delete comment.');
        return;
      }

      if (data.softDeleted) {
        // Parent was soft-deleted to preserve replies
        setComments(prev =>
          prev.map(c =>
            c.id === commentId
              ? {
                  ...c,
                  isDeleted: true,
                  text: '[This comment has been deleted]',
                  author: '[Deleted]',
                  authorInitials: 'D',
                  authorColor: '#666666',
                }
              : c
          )
        );
      } else {
        // Hard deleted
        if (isReply && parentId) {
          setComments(prev =>
            prev.map(c =>
              c.id === parentId && Array.isArray(c.replies)
                ? { ...c, replies: c.replies.filter(r => r.id !== commentId), repliesCount: Math.max(0, c.replies.length - 1) }
                : c
            )
          );
        } else {
          setComments(prev => prev.filter(c => c.id !== commentId));
        }
        setTotalCount(prev => Math.max(0, prev - 1));
      }
      showToast('Comment deleted successfully.');
    } catch (err) {
      console.error('[Delete Error]', err);
      showToast('Network error while deleting comment.');
    } finally {
      setDeletingCommentId(null);
    }
  }

  // ── Report Modal ──────────────────────────────────────────────────────────
  function handleOpenReport(commentId) {
    if (!currentUser) {
      openAuthModal();
      showToast('Please sign in to report comments.');
      return;
    }
    setReportingCommentId(commentId);
    setReportReason('spam');
    setReportDetails('');
  }

  function handleCancelReport() {
    setReportingCommentId(null);
    setReportReason('spam');
    setReportDetails('');
  }

  async function handleSubmitReport(commentId) {
    if (!reportReason) return;
    setReportingSubmitting(true);

    try {
      const res = await fetch(`/api/comments/${commentId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reportReason, details: reportDetails.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to report comment.');
        return;
      }

      showToast('Comment reported for administrator review. Thank you!');
      setReportingCommentId(null);
    } catch (err) {
      console.error('[Report Error]', err);
      showToast('Network error while reporting comment.');
    } finally {
      setReportingSubmitting(false);
    }
  }

  // ── Multilingual Translation ─────────────────────────────────────────────
  async function handleTranslate(comment) {
    const commentId = comment.id;

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
            provider: data.provider,
            isShowingTranslated: true,
          },
        }));
      } else {
        const feedback = data.message || data.error || 'Translation is not available for this comment.';
        setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: feedback }));
        setTimeout(() => setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: null })), 4000);
      }
    } catch (err) {
      console.error('[Translation Error]', err);
      setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: 'Translation request timed out.' }));
      setTimeout(() => setTranslationFeedbackMap(prev => ({ ...prev, [commentId]: null })), 4000);
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
            <option value="oldest">Oldest First</option>
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
        <div className="comments__add-input-wrapper" style={{ position: 'relative' }}>
          <label htmlFor="new-comment-input" className="sr-only">
            Add a public comment
          </label>
          <input
            id="new-comment-input"
            type="text"
            className="comments__add-input"
            placeholder={
              currentUser
                ? 'Add a comment (type @ to mention someone)...'
                : 'Sign in to add a public comment…'
            }
            value={newCommentText}
            onChange={e => {
              setNewCommentText(e.target.value);
              handleMentionSearch(e.target.value, e.target.selectionStart, 'main');
            }}
            onFocus={() => {
              if (!currentUser) {
                openAuthModal();
                showToast('Please sign in to post a comment.');
              }
            }}
            maxLength={1000}
            disabled={submitting}
          />

          {/* Autocomplete Dropdown */}
          {mentionQuery !== null && mentionTargetInput === 'main' && mentionSuggestions.length > 0 && (
            <div className="comments__mention-dropdown" role="listbox">
              {mentionSuggestions.map((user, idx) => (
                <div
                  key={user.id}
                  className={`comments__mention-item ${idx === mentionActiveIndex ? 'comments__mention-item--selected' : ''}`}
                  onClick={() => handleSelectMention(user)}
                  role="option"
                  aria-selected={idx === mentionActiveIndex}
                >
                  <div className="comments__mention-avatar" style={{ background: user.avatarColor }}>
                    {user.initials}
                  </div>
                  <div className="comments__mention-info">
                    <span className="comments__mention-name">{user.name}</span>
                    <span className="comments__mention-handle">@{user.username}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {captchaChallenge && (
            <div className="comments__captcha-box" style={{ margin: '8px 0', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <ShieldAlert size={16} color="#ef4444" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f87171' }}>Security Challenge: {captchaChallenge.question}</span>
              </div>
              <input
                type="text"
                placeholder="Your answer"
                value={captchaAnswer}
                onChange={e => setCaptchaAnswer(e.target.value)}
                style={{ width: '140px', padding: '6px 10px', borderRadius: '4px', background: '#222', color: '#fff', border: '1px solid #555', fontSize: '13px' }}
              />
            </div>
          )}

          {newCommentText && (
            <div className="comments__add-actions">
              <button
                type="button"
                className="comments__cancel-btn"
                onClick={() => {
                  setNewCommentText('');
                  setMentionQuery(null);
                }}
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
            const replies = Array.isArray(comment.replies) ? comment.replies : [];
            const hasReplies = replies.length > 0;
            const isRepliesExpanded = !!expandedReplies[comment.id];
            const isReplying = replyingCommentId === comment.id;

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
                    {comment.isEdited && !comment.isDeleted && (
                      <span className="comment__edited-badge" title={comment.editedAt ? `Edited ${formatTimeAgo(comment.editedAt)}` : 'Edited'}>
                        (edited)
                      </span>
                    )}
                    {comment.location && (
                      <span className="comment__location-badge">📍 {comment.location}</span>
                    )}
                    {isNonEnglish && !comment.isDeleted && (
                      <span className="comment__lang-badge" title={`Detected script: ${LANGUAGE_NAMES[comment.language] || comment.language}`}>
                        {LANGUAGE_NAMES[comment.language] || comment.language.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Comment text with inline edit mode or standard display */}
                  {editingCommentId === comment.id ? (
                    <div className="comment__edit-form" style={{ position: 'relative' }}>
                      <textarea
                        className="comment__edit-input"
                        value={editingText}
                        onChange={e => {
                          setEditingText(e.target.value);
                          handleMentionSearch(e.target.value, e.target.selectionStart, 'edit');
                        }}
                        maxLength={1000}
                        rows={2}
                        disabled={editingSubmitting}
                        aria-label="Edit comment text"
                      />
                      {mentionQuery !== null && mentionTargetInput === 'edit' && mentionSuggestions.length > 0 && (
                        <div className="comments__mention-dropdown" role="listbox">
                          {mentionSuggestions.map((user, idx) => (
                            <div
                              key={user.id}
                              className={`comments__mention-item ${idx === mentionActiveIndex ? 'comments__mention-item--selected' : ''}`}
                              onClick={() => handleSelectMention(user)}
                              role="option"
                              aria-selected={idx === mentionActiveIndex}
                            >
                              <div className="comments__mention-avatar" style={{ background: user.avatarColor }}>
                                {user.initials}
                              </div>
                              <div className="comments__mention-info">
                                <span className="comments__mention-name">{user.name}</span>
                                <span className="comments__mention-handle">@{user.username}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="comment__edit-actions">
                        <button
                          type="button"
                          className="comment__edit-btn comment__edit-btn--cancel"
                          onClick={handleCancelEdit}
                          disabled={editingSubmitting}
                        >
                          <X size={12} />
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="comment__edit-btn comment__edit-btn--save"
                          onClick={() => handleSaveEdit(comment.id, false)}
                          disabled={editingSubmitting || !editingText.trim()}
                        >
                          {editingSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={`comment__text ${comment.isDeleted ? 'comment__deleted-tag' : ''}`} dir="auto">
                      {comment.isDeleted ? (
                        '[This comment has been deleted]'
                      ) : showTranslated ? (
                        renderCommentTextWithMentions(translation.translatedText, showToast)
                      ) : (
                        renderCommentTextWithMentions(comment.text, showToast)
                      )}
                    </p>
                  )}

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

                  {/* Translation Feedback */}
                  {translationFeedback && (
                    <div className="comment__translation-feedback">
                      <AlertCircle size={12} />
                      <span>{translationFeedback}</span>
                    </div>
                  )}

                  {/* Comment Actions (Disabled if deleted) */}
                  {!comment.isDeleted && (
                    <div className="comment__actions">
                      {/* Like Button */}
                      <button
                        className={`comment__action-btn ${comment.hasLiked ? 'comment__action-btn--liked' : ''}`}
                        onClick={() => handleLikeToggle(comment.id, false)}
                        aria-label={`Like comment by ${comment.author}. Current likes: ${comment.likesCount}`}
                        aria-pressed={!!comment.hasLiked}
                      >
                        <ThumbsUp size={13} />
                        <span>{comment.likesCount || 0}</span>
                      </button>

                      {/* Dislike Button */}
                      <button
                        className={`comment__action-btn ${comment.hasDisliked ? 'comment__action-btn--disliked' : ''}`}
                        onClick={() => handleDislikeToggle(comment.id, false)}
                        aria-label={`Dislike comment by ${comment.author}. Current dislikes: ${comment.dislikesCount || 0}`}
                        aria-pressed={!!comment.hasDisliked}
                      >
                        <ThumbsDown size={13} />
                        {comment.dislikesCount > 0 && <span>{comment.dislikesCount}</span>}
                      </button>

                      {/* Reply Button */}
                      <button
                        className={`comment__action-btn ${isReplying ? 'comment__action-btn--active' : ''}`}
                        onClick={() => {
                          if (!currentUser) {
                            openAuthModal();
                            showToast('Please sign in to reply.');
                            return;
                          }
                          setReplyingCommentId(prev => (prev === comment.id ? null : comment.id));
                          setReplyText(`@${comment.author.toLowerCase().replace(/\s+/g, '_')} `);
                        }}
                        title="Reply to this comment"
                        aria-label="Reply"
                      >
                        <Reply size={13} />
                        <span>Reply</span>
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

                      {/* Report Button */}
                      {currentUser && String(comment.userId) !== String(currentUser._id || currentUser.id) && (
                        <button
                          className="comment__action-btn comment__action-btn--report"
                          onClick={() => handleOpenReport(comment.id)}
                          title="Report inappropriate comment"
                          aria-label="Report comment"
                        >
                          <Flag size={12} />
                          <span>Report</span>
                        </button>
                      )}

                      {/* Owner Edit & Delete Buttons */}
                      {currentUser && (String(comment.userId) === String(currentUser._id || currentUser.id) || currentUser.role === 'admin') && (
                        <>
                          {(comment.canEdit !== false || currentUser.role === 'admin') ? (
                            <>
                              <button
                                className="comment__action-btn comment__action-btn--edit"
                                onClick={() => handleStartEdit(comment)}
                                title="Edit your comment"
                                aria-label="Edit comment"
                              >
                                <Edit2 size={12} />
                                <span>Edit</span>
                              </button>
                              <button
                                className="comment__action-btn comment__action-btn--delete"
                                onClick={() => handleDeleteComment(comment.id, false)}
                                disabled={deletingCommentId === comment.id}
                                title="Delete your comment"
                                aria-label="Delete comment"
                              >
                                {deletingCommentId === comment.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Trash2 size={12} />
                                )}
                                <span>Delete</span>
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#888', alignSelf: 'center', marginLeft: '4px' }} title="Comments can only be edited or deleted within 15 minutes of posting">
                              (15m window expired)
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Inline Report Modal */}
                  {reportingCommentId === comment.id && (
                    <div className="comment__report-modal" style={{ marginTop: '8px', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: '12px', fontWeight: 600, color: '#f87171' }}>Report this comment for administrator review:</p>
                      <select
                        value={reportReason}
                        onChange={e => setReportReason(e.target.value)}
                        style={{ width: '100%', padding: '6px', marginBottom: '6px', borderRadius: '4px', background: '#222', color: '#fff', border: '1px solid #444', fontSize: '12px' }}
                      >
                        <option value="spam">Spam or commercial advertising</option>
                        <option value="harassment">Harassment or personal attack</option>
                        <option value="hate_speech">Hate speech or discrimination</option>
                        <option value="misinformation">Misinformation or misleading content</option>
                        <option value="offensive">Offensive or vulgar language</option>
                        <option value="other">Other community guideline violation</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Optional details (max 500 chars)..."
                        value={reportDetails}
                        onChange={e => setReportDetails(e.target.value)}
                        maxLength={500}
                        style={{ width: '100%', padding: '6px', marginBottom: '8px', borderRadius: '4px', background: '#222', color: '#fff', border: '1px solid #444', fontSize: '12px' }}
                      />
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={handleCancelReport}
                          style={{ padding: '4px 10px', background: 'transparent', border: '1px solid #666', borderRadius: '4px', color: '#ccc', cursor: 'pointer', fontSize: '12px' }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSubmitReport(comment.id)}
                          disabled={reportingSubmitting}
                          style={{ padding: '4px 12px', background: '#ef4444', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                        >
                          {reportingSubmitting ? 'Reporting...' : 'Submit Report'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Inline Reply Composer */}
                  {isReplying && (
                    <div className="comment__reply-form" style={{ position: 'relative' }}>
                      <div
                        className="comment__reply-avatar"
                        style={{ background: currentUser?.avatarColor || '#6c63ff' }}
                        aria-hidden="true"
                      >
                        {currentUser?.initials || 'U'}
                      </div>
                      <div style={{ flex: 1, position: 'relative' }}>
                        <input
                          type="text"
                          className="comments__add-input"
                          placeholder={`Reply to @${comment.author}...`}
                          value={replyText}
                          onChange={e => {
                            setReplyText(e.target.value);
                            handleMentionSearch(e.target.value, e.target.selectionStart, 'reply');
                          }}
                          maxLength={1000}
                          autoFocus
                          disabled={replySubmitting}
                        />
                        {mentionQuery !== null && mentionTargetInput === 'reply' && mentionSuggestions.length > 0 && (
                          <div className="comments__mention-dropdown" role="listbox">
                            {mentionSuggestions.map((user, idx) => (
                              <div
                                key={user.id}
                                className={`comments__mention-item ${idx === mentionActiveIndex ? 'comments__mention-item--selected' : ''}`}
                                onClick={() => handleSelectMention(user)}
                                role="option"
                                aria-selected={idx === mentionActiveIndex}
                              >
                                <div className="comments__mention-avatar" style={{ background: user.avatarColor }}>
                                  {user.initials}
                                </div>
                                <div className="comments__mention-info">
                                  <span className="comments__mention-name">{user.name}</span>
                                  <span className="comments__mention-handle">@{user.username}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                          <button
                            type="button"
                            className="comments__cancel-btn"
                            onClick={() => {
                              setReplyingCommentId(null);
                              setReplyText('');
                            }}
                            disabled={replySubmitting}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="comments__submit-btn"
                            onClick={() => handleReplySubmit(comment.id)}
                            disabled={replySubmitting || !replyText.trim()}
                          >
                            {replySubmitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                            <span>Reply</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Toggle Threaded Replies Button */}
                  {hasReplies && (
                    <button
                      type="button"
                      className="comment__toggle-replies-btn"
                      onClick={() => toggleReplies(comment.id)}
                      aria-expanded={isRepliesExpanded}
                    >
                      {isRepliesExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <span>
                        {isRepliesExpanded
                          ? `Hide ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                          : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                      </span>
                    </button>
                  )}

                  {/* Nested Replies Thread Display */}
                  {hasReplies && isRepliesExpanded && (
                    <div className="comment__replies-container">
                      {replies.map(reply => {
                        const isReplyNonEnglish = reply.language && reply.language !== 'en';
                        const replyTranslation = translationsMap[reply.id];
                        const showReplyTranslated = replyTranslation && replyTranslation.isShowingTranslated;

                        return (
                          <div key={reply.id} className="comment__reply-item" id={`reply-${reply.id}`}>
                            <div
                              className="comment__reply-avatar"
                              style={{ background: reply.authorColor || '#6c63ff' }}
                              aria-hidden="true"
                            >
                              {reply.authorInitials || 'U'}
                            </div>
                            <div className="comment__reply-body">
                              <div className="comment__meta">
                                <span className="comment__author">{reply.author}</span>
                                <span className="comment__time">{reply.timeAgo || 'recently'}</span>
                                {reply.isEdited && !reply.isDeleted && (
                                  <span className="comment__edited-badge">(edited)</span>
                                )}
                                {isReplyNonEnglish && !reply.isDeleted && (
                                  <span className="comment__lang-badge">
                                    {LANGUAGE_NAMES[reply.language] || reply.language.toUpperCase()}
                                  </span>
                                )}
                              </div>

                              {editingCommentId === reply.id ? (
                                <div className="comment__edit-form">
                                  <textarea
                                    className="comment__edit-input"
                                    value={editingText}
                                    onChange={e => setEditingText(e.target.value)}
                                    maxLength={1000}
                                    rows={2}
                                    disabled={editingSubmitting}
                                  />
                                  <div className="comment__edit-actions">
                                    <button
                                      type="button"
                                      className="comment__edit-btn comment__edit-btn--cancel"
                                      onClick={handleCancelEdit}
                                      disabled={editingSubmitting}
                                    >
                                      <X size={12} /> Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="comment__edit-btn comment__edit-btn--save"
                                      onClick={() => handleSaveEdit(reply.id, true, comment.id)}
                                      disabled={editingSubmitting || !editingText.trim()}
                                    >
                                      <Check size={12} /> Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className={`comment__text ${reply.isDeleted ? 'comment__deleted-tag' : ''}`} dir="auto">
                                  {reply.isDeleted
                                    ? '[This comment has been deleted]'
                                    : showReplyTranslated
                                    ? renderCommentTextWithMentions(replyTranslation.translatedText, showToast)
                                    : renderCommentTextWithMentions(reply.text, showToast)}
                                </p>
                              )}

                              {/* Reply Action buttons */}
                              {!reply.isDeleted && (
                                <div className="comment__actions">
                                  <button
                                    className={`comment__action-btn ${reply.hasLiked ? 'comment__action-btn--liked' : ''}`}
                                    onClick={() => handleLikeToggle(reply.id, true, comment.id)}
                                    aria-label="Like reply"
                                  >
                                    <ThumbsUp size={12} />
                                    <span>{reply.likesCount || 0}</span>
                                  </button>
                                  <button
                                    className={`comment__action-btn ${reply.hasDisliked ? 'comment__action-btn--disliked' : ''}`}
                                    onClick={() => handleDislikeToggle(reply.id, true, comment.id)}
                                    aria-label="Dislike reply"
                                  >
                                    <ThumbsDown size={12} />
                                    {reply.dislikesCount > 0 && <span>{reply.dislikesCount}</span>}
                                  </button>

                                  {/* Quick Mention Reply */}
                                  <button
                                    className="comment__action-btn"
                                    onClick={() => {
                                      if (!currentUser) {
                                        openAuthModal();
                                        showToast('Please sign in to reply.');
                                        return;
                                      }
                                      setReplyingCommentId(comment.id);
                                      setReplyText(`@${reply.author.toLowerCase().replace(/\s+/g, '_')} `);
                                    }}
                                    title={`Reply mentioning @${reply.author}`}
                                  >
                                    <AtSign size={12} />
                                    <span>Reply</span>
                                  </button>

                                  {/* Report reply */}
                                  {currentUser && String(reply.userId) !== String(currentUser._id || currentUser.id) && (
                                    <button
                                      className="comment__action-btn comment__action-btn--report"
                                      onClick={() => handleOpenReport(reply.id)}
                                    >
                                      <Flag size={11} />
                                    </button>
                                  )}

                                  {/* Owner Edit & Delete */}
                                  {currentUser && (String(reply.userId) === String(currentUser._id || currentUser.id) || currentUser.role === 'admin') && (
                                    <>
                                      <button
                                        className="comment__action-btn comment__action-btn--edit"
                                        onClick={() => handleStartEdit(reply)}
                                      >
                                        <Edit2 size={11} />
                                      </button>
                                      <button
                                        className="comment__action-btn comment__action-btn--delete"
                                        onClick={() => handleDeleteComment(reply.id, true, comment.id)}
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
