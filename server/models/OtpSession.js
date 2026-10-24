const mongoose = require('mongoose');

const otpSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tempTokenHash: {
    type: String,
    required: true,
    index: true,
  },
  salt: {
    type: String,
    required: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 5,
  },
  resendAvailableAt: {
    type: Date,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'exhausted', 'expired'],
    default: 'pending',
    index: true,
  },
  verifiedAt: {
    type: Date,
  },
  deviceContext: {
    browser: String,
    os: String,
    deviceType: String,
    ip: String,
    location: Object,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-expire documents after 24 hours to keep collection clean
otpSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('OtpSession', otpSessionSchema);
