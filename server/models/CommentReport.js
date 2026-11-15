const mongoose = require('mongoose');

/**
 * CommentReport — Persists user reports on comments for administrator review.
 *
 * Requirements:
 * - Predefined reasons: spam, harassment, hate_speech, misinformation, offensive, other.
 * - Enforces single report per user per comment (compound unique index).
 * - Flags comments for review without automatic deletion based on reports or dislikes.
 * - Maintains complete moderation audit history.
 */
const commentReportSchema = new mongoose.Schema(
  {
    commentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      required: [true, 'Comment ID is required'],
      index: true,
    },
    videoId: {
      type: String,
      required: [true, 'Video ID is required'],
      index: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reporter User ID is required'],
      index: true,
    },
    reason: {
      type: String,
      required: [true, 'Report reason is required'],
      enum: {
        values: ['spam', 'harassment', 'hate_speech', 'misinformation', 'offensive', 'other'],
        message: '{VALUE} is not a valid report reason',
      },
      index: true,
    },
    details: {
      type: String,
      maxlength: [500, 'Report details cannot exceed 500 characters'],
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'dismissed', 'action_taken'],
      default: 'pending',
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminNote: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate reports on the same comment by the same user
commentReportSchema.index({ commentId: 1, reportedBy: 1 }, { unique: true });

// Compound index for review queue sorting
commentReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('CommentReport', commentReportSchema);

