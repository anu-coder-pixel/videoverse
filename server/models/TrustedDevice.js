const mongoose = require('mongoose');

const trustedDeviceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  deviceTokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  deviceName: {
    type: String,
    default: 'Web Browser',
  },
  browser: {
    type: String,
    default: 'Unknown Browser',
  },
  browserVersion: {
    type: String,
    default: '',
  },
  os: {
    type: String,
    default: 'Unknown OS',
  },
  osVersion: {
    type: String,
    default: '',
  },
  deviceType: {
    type: String,
    enum: ['desktop', 'mobile', 'tablet', 'unknown'],
    default: 'desktop',
  },
  deviceModel: {
    type: String,
    default: '',
  },
  lastIp: {
    type: String,
    default: '',
  },
  lastLocation: {
    city: String,
    region: String,
    country: String,
    display: String,
    isApproximate: Boolean,
  },
  firstTrustedAt: {
    type: Date,
    default: Date.now,
  },
  lastUsedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  isRevoked: {
    type: Boolean,
    default: false,
    index: true,
  },
  revokedAt: {
    type: Date,
  },
});

module.exports = mongoose.model('TrustedDevice', trustedDeviceSchema);
