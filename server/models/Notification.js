const mongoose = require('mongoose');

/**
 * VideoVerse — In-App Notifications Model
 * Handles mention and reply notifications.
 */
const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Recipient ID is required'],
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender ID is required'],
  },
  senderName: {
    type: String,
    required: [true, 'Sender name is required'],
    trim: true,
  },
  senderInitials: {
    type: String,
    default: 'U',
    trim: true,
  },
  senderColor: {
    type: String,
    default: '#6c63ff',
  },
  type: {
    type: String,
    enum: ['mention', 'reply'],
    default: 'mention',
    index: true,
  },
  videoId: {
    type: String,
    required: [true, 'Video ID is required'],
    index: true,
  },
  videoTitle: {
    type: String,
    default: '',
    trim: true,
  },
  commentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    required: [true, 'Comment ID is required'],
    index: true,
  },
  commentText: {
    type: String,
    default: '',
    trim: true,
    maxlength: 200,
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Compound unique index to strictly prevent duplicate notifications per recipient, comment, and event type
notificationSchema.index({ recipient: 1, commentId: 1, type: 1 }, { unique: true });

notificationSchema.methods.toSafeObject = function () {
  return {
    id: this._id.toString(),
    recipient: this.recipient.toString(),
    sender: this.sender.toString(),
    senderName: this.senderName,
    senderInitials: this.senderInitials,
    senderColor: this.senderColor,
    type: this.type,
    videoId: this.videoId,
    videoTitle: this.videoTitle,
    commentId: this.commentId.toString(),
    commentText: this.commentText,
    isRead: !!this.isRead,
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
  return `${Math.floor(days / 30)}mo ago`;
}

module.exports = mongoose.model('Notification', notificationSchema);
