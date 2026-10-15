import { useState } from 'react';
import { ThumbsUp, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { MOCK_COMMENTS } from '../../data/mockData';
import './CommentsSection.css';

/**
 * ⚠️  NOTICE: Comments are MOCK DATA only.
 * Multilingual comments, moderation, and real-time updates are planned
 * for internship Task 1 (backend integration required).
 * Submitting a comment here does NOT persist anywhere.
 */

export default function CommentsSection({ videoId }) {
  const [comments, setComments] = useState(MOCK_COMMENTS);
  const [newComment, setNewComment] = useState('');
  const [likedComments, setLikedComments] = useState(new Set());
  const [sortBy, setSortBy] = useState('top'); // 'top' | 'newest'
  const [showAll, setShowAll] = useState(false);

  const displayedComments = showAll ? comments : comments.slice(0, 3);

  function handleSubmit(e) {
    e.preventDefault();
    if (!newComment.trim()) return;

    // ⚠️ MOCK: Comment is added to local state only — NOT saved to any backend
    const mockNew = {
      id: `cmt-${Date.now()}`,
      author: 'You (Guest)',
      authorInitials: 'YG',
      authorColor: '#6c63ff',
      text: newComment.trim(),
      likes: 0,
      timeAgo: 'just now',
      replies: 0,
    };
    setComments(prev => [mockNew, ...prev]);
    setNewComment('');
  }

  function toggleLike(id) {
    setLikedComments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const sorted = [...displayedComments].sort((a, b) =>
    sortBy === 'top' ? b.likes - a.likes : 0
  );

  return (
    <section className="comments" aria-labelledby="comments-heading">
      {/* Header */}
      <div className="comments__header">
        <h2 className="comments__title" id="comments-heading">
          {comments.length} Comments
        </h2>
        <div className="comments__controls">
          <span className="badge badge--mock">Mock Data</span>
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

      {/* Add comment form */}
      <form className="comments__add-form" onSubmit={handleSubmit}>
        <div className="comments__add-avatar" style={{ background: '#6c63ff' }} aria-hidden="true">
          YG
        </div>
        <div className="comments__add-input-wrapper">
          <label htmlFor="new-comment-input" className="sr-only">Add a comment</label>
          <input
            id="new-comment-input"
            type="text"
            className="comments__add-input"
            placeholder="Add a comment… (stored locally only — mock)"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            maxLength={500}
          />
          {newComment && (
            <div className="comments__add-actions">
              <button
                type="button"
                className="comments__cancel-btn"
                onClick={() => setNewComment('')}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="comments__submit-btn"
                id="submit-comment-btn"
              >
                Comment
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Comment list */}
      <ul className="comments__list" aria-label="Comments">
        {sorted.map(comment => (
          <li key={comment.id} className="comment animate-fade-in">
            <div
              className="comment__avatar"
              style={{ background: comment.authorColor }}
              aria-hidden="true"
            >
              {comment.authorInitials}
            </div>
            <div className="comment__body">
              <div className="comment__meta">
                <span className="comment__author">{comment.author}</span>
                <span className="comment__time">{comment.timeAgo}</span>
              </div>
              <p className="comment__text">{comment.text}</p>
              <div className="comment__actions">
                <button
                  className={`comment__action-btn ${likedComments.has(comment.id) ? 'comment__action-btn--liked' : ''}`}
                  onClick={() => toggleLike(comment.id)}
                  aria-label={`Like comment by ${comment.author}`}
                  aria-pressed={likedComments.has(comment.id)}
                >
                  <ThumbsUp size={13} />
                  <span>{likedComments.has(comment.id) ? comment.likes + 1 : comment.likes}</span>
                </button>
                <button
                  className="comment__action-btn"
                  aria-label={`Reply to ${comment.author} (not implemented)`}
                >
                  <MessageSquare size={13} />
                  <span>Reply</span>
                </button>
                {comment.replies > 0 && (
                  <button className="comment__replies-btn" aria-label={`View ${comment.replies} replies`}>
                    <ChevronDown size={13} />
                    {comment.replies} {comment.replies === 1 ? 'reply' : 'replies'}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Show more */}
      {comments.length > 3 && (
        <button
          className="comments__show-more"
          onClick={() => setShowAll(p => !p)}
          id="show-more-comments-btn"
        >
          {showAll ? (
            <><ChevronUp size={14} /> Show fewer comments</>
          ) : (
            <><ChevronDown size={14} /> Show all {comments.length} comments</>
          )}
        </button>
      )}
    </section>
  );
}
