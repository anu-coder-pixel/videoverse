const mongoose = require('mongoose');

const downloadSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
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
  channelName: {
    type: String,
    default: '',
    trim: true,
  },
  thumbnailUrl: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['reserved', 'completed', 'interrupted', 'failed'],
    default: 'reserved',
    index: true,
  },
  reservedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  completedAt: {
    type: Date,
  },
  bytesDownloaded: {
    type: Number,
    default: 0,
  },
  fileSize: {
    type: Number,
    default: 0,
  },
  sourceUrl: {
    type: String,
    default: '',
  },
  errorMessage: {
    type: String,
    default: '',
  },
  isDeleted: {
    type: Boolean,
    default: false,
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

downloadSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

// Safe representation for frontend consumers
downloadSchema.methods.toSafeObject = function () {
  return {
    id: this._id.toString(),
    videoId: this.videoId,
    videoTitle: this.videoTitle,
    channelName: this.channelName,
    thumbnailUrl: this.thumbnailUrl,
    status: this.status,
    reservedAt: this.reservedAt,
    completedAt: this.completedAt,
    fileSize: this.fileSize,
    bytesDownloaded: this.bytesDownloaded,
    errorMessage: this.errorMessage,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Download', downloadSchema);
