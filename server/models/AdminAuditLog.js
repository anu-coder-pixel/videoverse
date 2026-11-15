const mongoose = require('mongoose');

/**
 * AdminAuditLog — Immutable record of administrative platform actions.
 *
 * Immutability Guarantee:
 * Once created, audit log records can NEVER be updated or deleted.
 * All update and delete hooks throw an explicit error to prevent tampering.
 */
const adminAuditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    adminEmail: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
      // e.g. 'USER_SUSPEND', 'USER_REACTIVATE', 'USER_ROLE_CHANGE',
      //      'VIDEO_PUBLISH', 'VIDEO_UNPUBLISH', 'VIDEO_REMOVE', 'VIDEO_RETRY_TRANSCODE',
      //      'COMMENT_RESOLVE', 'COMMENT_DELETE', 'SETTINGS_UPDATE'
    },
    targetType: {
      type: String,
      enum: ['user', 'video', 'comment', 'payment', 'system'],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    ipAddress: {
      type: String,
      default: '',
    },
    previousValues: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValues: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ['success', 'failure'],
      default: 'success',
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // No updatedAt: append-only
  }
);

// ── Strict Immutability Guard: Block all update and delete mutations ───────────
const immutableError = new Error('AdminAuditLog records are append-only and strictly immutable.');

adminAuditLogSchema.pre('updateOne', function () {
  throw immutableError;
});
adminAuditLogSchema.pre('updateMany', function () {
  throw immutableError;
});
adminAuditLogSchema.pre('findOneAndUpdate', function () {
  throw immutableError;
});
adminAuditLogSchema.pre('deleteOne', function () {
  throw immutableError;
});
adminAuditLogSchema.pre('deleteMany', function () {
  throw immutableError;
});
adminAuditLogSchema.pre('findOneAndDelete', function () {
  throw immutableError;
});
adminAuditLogSchema.pre('findByIdAndDelete', function () {
  throw immutableError;
});

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);

