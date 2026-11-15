const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide your name'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
  username: {
    type: String,
    trim: true,
    lowercase: true,
    index: true,
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
    enum: ['free', 'bronze', 'silver', 'gold', 'premium', 'vip'],
    default: 'free', // All new users start on the Free tier
    index: true,
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null,
    index: true,
  },
  subscriptionBillingCycle: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly', null],
    default: null,
  },
  subscriptionCancelledAt: {
    type: Date,
    default: null,
  },
  // Role-based access control
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  // Phase 2 Step 6: Administrative Account Suspension
  isSuspended: {
    type: Boolean,
    default: false,
    index: true,
  },
  suspendedReason: {
    type: String,
    default: null,
  },
  suspendedAt: {
    type: Date,
    default: null,
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
  // Version guard for quota reservations and Gold path concurrency
  quotaReservationVersion: {
    type: Number,
    default: 0,
    index: true,
  },
});

// Compound index for subscription expiry audits
userSchema.index({ subscriptionTier: 1, subscriptionExpiresAt: 1 });

// Update timestamp on save
userSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

// Helper: Calculate effective tier based on expiration
userSchema.methods.getEffectiveTier = function () {
  const tier = this.subscriptionTier || 'free';

  if (tier !== 'free') {
    if (this.subscriptionExpiresAt && new Date(this.subscriptionExpiresAt).getTime() < Date.now()) {
      return 'free';
    }
  }
  return tier;
};

// Helper: Get canonical plan tier (maps 'vip' -> 'gold', 'premium' -> 'silver')
userSchema.methods.getNormalizedTier = function () {
  const eff = this.getEffectiveTier();
  if (eff === 'vip') return 'gold';
  if (eff === 'premium') return 'silver';
  return eff;
};

// Instance method to verify password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error('Password hash not loaded');
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Safe representation for frontend consumers
userSchema.methods.toSafeObject = function () {
  const effectiveTier = this.getEffectiveTier ? this.getEffectiveTier() : (this.subscriptionTier || 'free');
  const normalizedTier = this.getNormalizedTier ? this.getNormalizedTier() : (
    effectiveTier === 'vip' ? 'gold' : effectiveTier === 'premium' ? 'silver' : effectiveTier
  );
  const isExpired = Boolean(
    this.subscriptionTier &&
    this.subscriptionTier !== 'free' &&
    this.subscriptionExpiresAt &&
    new Date(this.subscriptionExpiresAt).getTime() < Date.now()
  );

  return {
    id: this._id.toString(),
    name: this.name,
    username: this.username || this.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    email: this.email,
    avatar: this.avatar,
    avatarColor: this.avatarColor,
    initials: this.initials,
    role: this.role || 'user',
    isSuspended: Boolean(this.isSuspended),
    suspendedReason: this.suspendedReason || null,
    suspendedAt: this.suspendedAt || null,
    themePreference: this.themePreference,
    subscriptionTier: effectiveTier,
    normalizedSubscriptionTier: normalizedTier,
    rawSubscriptionTier: this.subscriptionTier,
    subscriptionExpiresAt: this.subscriptionExpiresAt,
    subscriptionBillingCycle: this.subscriptionBillingCycle,
    subscriptionCancelledAt: this.subscriptionCancelledAt,
    isSubscriptionExpired: isExpired,
    likedVideos: this.likedVideos || [],
    dislikedVideos: this.dislikedVideos || [],
    watchLater: this.watchLater || [],
    watchHistory: this.watchHistory || [],
    subscribedChannels: this.subscribedChannels || [],
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
