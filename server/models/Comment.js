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
  dislikedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  dislikesCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
    type: Date,
  },
  location: {
    type: String,
    default: '',
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null,
    index: true,
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  mentions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    username: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
  }],
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
  reportCount: {
    type: Number,
    default: 0,
    min: 0,
    index: true,
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

// Compound indexes for optimal sorting and filtering
commentSchema.index({ videoId: 1, moderationStatus: 1, createdAt: -1 });
commentSchema.index({ videoId: 1, moderationStatus: 1, likesCount: -1 });

commentSchema.pre('save', function () {
  this.updatedAt = Date.now();
  if (Array.isArray(this.likedBy)) {
    this.likesCount = this.likedBy.length;
  }
  if (Array.isArray(this.dislikedBy)) {
    this.dislikesCount = this.dislikedBy.length;
  }
});

// Safe representation for frontend consumers
commentSchema.methods.toSafeObject = function (currentUserId = null) {
  const hasLiked = currentUserId && Array.isArray(this.likedBy)
    ? this.likedBy.some(id => id.toString() === currentUserId.toString())
    : false;
  const hasDisliked = currentUserId && Array.isArray(this.dislikedBy)
    ? this.dislikedBy.some(id => id.toString() === currentUserId.toString())
    : false;

  return {
    id: this._id.toString(),
    userId: this.userId ? this.userId.toString() : null,
    videoId: this.videoId,
    author: this.author,
    authorInitials: this.authorInitials,
    authorColor: this.authorColor,
    text: this.text,
    language: this.language,
    likesCount: this.likesCount || (this.likedBy ? this.likedBy.length : 0),
    dislikesCount: this.dislikesCount || (this.dislikedBy ? this.dislikedBy.length : 0),
    hasLiked: !!hasLiked,
    hasDisliked: !!hasDisliked,
    isEdited: !!this.isEdited,
    editedAt: this.editedAt,
    isDeleted: !!this.isDeleted,
    deletedAt: this.deletedAt || null,
    location: this.location || '',
    parentId: this.parentId ? this.parentId.toString() : null,
    mentions: Array.isArray(this.mentions) ? this.mentions.map(m => ({
      userId: m.userId ? m.userId.toString() : null,
      username: m.username || '',
      name: m.name || '',
    })) : [],
    reportCount: this.reportCount || 0,
    canEdit: (Date.now() - new Date(this.createdAt).getTime()) < 15 * 60 * 1000,
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
