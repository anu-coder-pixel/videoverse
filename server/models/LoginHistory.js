const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  ip: {
    type: String,
    default: '',
  },
  browser: {
    type: String,
    default: '',
  },
  browserVersion: {
    type: String,
    default: '',
  },
  os: {
    type: String,
    default: '',
  },
  osVersion: {
    type: String,
    default: '',
  },
  deviceType: {
    type: String,
    default: 'desktop',
  },
  deviceModel: {
    type: String,
    default: '',
  },
  location: {
    city: String,
    region: String,
    country: String,
    display: String,
    isApproximate: Boolean,
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'otp_required'],
    required: true,
    index: true,
  },
  failureReason: {
    type: String,
    default: '',
  },
  userAgent: {
    type: String,
    default: '',
  },
});

// Auto-expire login history records after 90 days
loginHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 86400 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
