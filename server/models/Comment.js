const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  videoId: {
    type: String,
    required: [true, 'Video ID is required'],
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  author: {
    type: String,
    required: [true, 'Author name is required'],
    trim: true,
  },
  authorInitials: {
    type: String,
    required: [true, 'Author initials are required'],
    trim: true,
  },
  authorColor: {
    type: String,
    default: '#ff0000',
  },
  text: {
    type: String,
    required: [true, 'Comment text cannot be empty'],
    trim: true,
    minlength: [1, 'Comment must contain at least 1 character'],
    maxlength: [1000, 'Comment cannot exceed 1000 characters'],
  },
  language: {
    type: String,
    default: 'auto',
  },
  likedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  likesCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  moderationStatus: {
    type: String,
    enum: ['approved', 'flagged', 'rejected'],
    default: 'approved',
    index: true,
  },
  moderationReason: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

commentSchema.pre('save', function () {
  this.updatedAt = Date.now();
  if (Array.isArray(this.likedBy)) {
    this.likesCount = this.likedBy.length;
  }
});

// Safe representation for frontend consumers
commentSchema.methods.toSafeObject = function (currentUserId = null) {
  const hasLiked = currentUserId && Array.isArray(this.likedBy)
    ? this.likedBy.some(id => id.toString() === currentUserId.toString())
    : false;

  return {
    id: this._id.toString(),
    videoId: this.videoId,
    author: this.author,
    authorInitials: this.authorInitials,
    authorColor: this.authorColor,
    text: this.text,
    language: this.language,
    likesCount: this.likesCount || (this.likedBy ? this.likedBy.length : 0),
    hasLiked: !!hasLiked,
    createdAt: this.createdAt,
    timeAgo: formatTimeAgo(this.createdAt),
  };
};

function formatTimeAgo(date) {
  if (!date) return 'just now';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
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

module.exports = mongoose.model('Comment', commentSchema);
