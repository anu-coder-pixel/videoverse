const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide your name'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
  email: {
    type: String,
    required: [true, 'Please provide an email address'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      'Please provide a valid email address',
    ],
  },
  passwordHash: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false, // Never return password in queries by default
  },
  avatar: {
    type: String,
    default: '',
  },
  avatarColor: {
    type: String,
    default: '#ff0000',
  },
  initials: {
    type: String,
    default: function () {
      if (!this.name) return 'U';
      const parts = this.name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },
  },
  themePreference: {
    type: String,
    enum: ['dark', 'light', 'auto', 'system'],
    default: 'auto',
  },
  subscriptionTier: {
    type: String,
    enum: ['free', 'premium', 'vip'],
    default: 'free', // All new users start on the Free tier
  },
  // User activity linked directly to the account
  likedVideos: {
    type: [String],
    default: [],
  },
  dislikedVideos: {
    type: [String],
    default: [],
  },
  watchLater: {
    type: [String],
    default: [],
  },
  watchHistory: {
    type: [String],
    default: [],
  },
  subscribedChannels: {
    type: [String],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
userSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

// Instance method to verify password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error('Password hash not loaded');
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Safe representation for frontend consumers
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    avatar: this.avatar,
    avatarColor: this.avatarColor,
    initials: this.initials,
    themePreference: this.themePreference,
    subscriptionTier: this.subscriptionTier,
    likedVideos: this.likedVideos || [],
    dislikedVideos: this.dislikedVideos || [],
    watchLater: this.watchLater || [],
    watchHistory: this.watchHistory || [],
    subscribedChannels: this.subscribedChannels || [],
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
