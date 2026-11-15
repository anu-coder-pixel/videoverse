const mongoose = require('mongoose');

const uploadSessionSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Video title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
      default: '',
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      required: true,
      max: [524288000, 'File size cannot exceed 500 MB'], // 500 * 1024 * 1024
    },
    mimeType: {
      type: String,
      required: true,
      enum: ['video/mp4', 'video/webm'],
    },
    totalChunks: {
      type: Number,
      required: true,
      min: [1, 'Must have at least 1 chunk'],
    },
    chunkSize: {
      type: Number,
      required: true,
    },
    uploadedChunks: {
      type: [Number],
      default: [],
    },
    bytesReceived: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['uploading', 'processing', 'completed', 'failed', 'abandoned'],
      default: 'uploading',
      index: true,
    },
    tempDir: {
      type: String,
      required: true,
    },
    videoId: {
      type: String,
      default: null,
      index: true,
    },
    errorMessage: {
      type: String,
      default: '',
    },
    processingProgress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helper method to check if upload is complete
uploadSessionSchema.methods.isComplete = function () {
  return this.uploadedChunks.length === this.totalChunks;
};

module.exports = mongoose.model('UploadSession', uploadSessionSchema);

