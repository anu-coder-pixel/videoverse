const mongoose = require('mongoose');

/**
 * TranscodeJob — Persists background video transcoding jobs to guarantee:
 * 1. Queue lifecycle: 'queued' -> 'processing' -> 'completed' | 'failed'
 * 2. Safe progress tracking (0 - 100%)
 * 3. Interrupted job recovery upon server restart
 * 4. Automatic retry on transient failures (max 3 retries)
 * 5. Job deduplication per videoId
 */
const transcodeJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    videoId: {
      type: String,
      required: true,
      index: true,
    },
    uploadId: {
      type: String,
      default: '',
    },
    sourcePath: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    targetResolutions: {
      type: [String],
      default: [],
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    errorMessage: {
      type: String,
      default: '',
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('TranscodeJob', transcodeJobSchema);

