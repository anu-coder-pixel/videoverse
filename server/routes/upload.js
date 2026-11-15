const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const UploadSession = require('../models/UploadSession');
const Video = require('../models/Video');
const { requireAuth } = require('../middleware/auth');
const { validateVideoSignature } = require('../utils/fileSignature');
const { processUploadedVideo, CHUNKS_DIR } = require('../utils/videoProcessor');

// Max upload size: 500 MB
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 524,288,000 bytes

/**
 * POST /api/upload/init
 * Initialize a resumable chunked upload session
 */
router.post('/init', requireAuth, async (req, res) => {
  try {
    const {
      title,
      description = '',
      category,
      tags = [],
      fileName,
      fileSize,
      mimeType,
      totalChunks,
      chunkSize,
    } = req.body;

    // 1. Validate title
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Video title is required.' });
    }
    if (title.trim().length > 200) {
      return res.status(400).json({ error: 'Title cannot exceed 200 characters.' });
    }

    // 2. Validate category
    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'Video category is required.' });
    }

    // 3. Validate file size (max 500 MB)
    const numSize = Number(fileSize);
    if (!numSize || isNaN(numSize) || numSize <= 0) {
      return res.status(400).json({ error: 'Valid file size in bytes is required.' });
    }
    if (numSize > MAX_UPLOAD_SIZE) {
      return res.status(400).json({
        error: `File size exceeds the 500 MB maximum upload limit (${Math.round(numSize / 1024 / 1024)} MB submitted).`,
        code: 'FILE_TOO_LARGE',
      });
    }

    // 4. Validate MIME type
    const normMime = (mimeType || '').toLowerCase().trim();
    if (!['video/mp4', 'video/webm'].includes(normMime)) {
      return res.status(400).json({
        error: `Unsupported format "${mimeType}". Only MP4 and WebM videos are supported.`,
        code: 'UNSUPPORTED_FORMAT',
      });
    }

    // 5. Validate chunk parameters
    const numTotalChunks = parseInt(totalChunks, 10);
    const numChunkSize = parseInt(chunkSize, 10);
    if (!numTotalChunks || numTotalChunks < 1 || !numChunkSize || numChunkSize <= 0) {
      return res.status(400).json({ error: 'Valid totalChunks and chunkSize are required.' });
    }

    // 6. Generate IDs and secure isolated temp path
    const uploadId = crypto.randomUUID();
    const videoId = `vid-up-${crypto.randomBytes(6).toString('hex')}`;

    // Path traversal prevention: enforce strictly inside CHUNKS_DIR
    const tempDir = path.join(CHUNKS_DIR, uploadId);
    if (!tempDir.startsWith(CHUNKS_DIR)) {
      return res.status(400).json({ error: 'Invalid upload directory path.' });
    }

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true, mode: 0o755 });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour TTL

    // 7. Pre-create Video document
    const user = req.user;
    const cleanTags = Array.isArray(tags)
      ? tags.map(t => String(t).trim()).filter(Boolean)
      : typeof tags === 'string'
        ? tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];

    const newVideo = new Video({
      id: videoId,
      title: title.trim(),
      description: (description || '').trim(),
      category: category.trim(),
      tags: cleanTags,
      uploaderId: user._id,
      channel: {
        id: `ch-${user._id.toString().slice(-6)}`,
        name: user.name,
        handle: `@${user.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        subscribers: '1',
        avatarColor: user.avatarColor || '#6c63ff',
        initials: user.initials || 'CR',
        verified: false,
      },
      duration: '0:00',
      views: '0',
      likes: '0',
      thumbnailUrl: '',
      videoUrl: '',
      processingStatus: 'uploading',
      processingProgress: 0,
      fileSize: numSize,
      mimeType: normMime,
      uploadedAt: 'Uploading...',
    });

    await newVideo.save();

    // 8. Create UploadSession document
    const session = new UploadSession({
      uploadId,
      userId: user._id,
      title: title.trim(),
      description: (description || '').trim(),
      category: category.trim(),
      tags: cleanTags,
      fileName: fileName ? String(fileName).trim() : 'video.mp4',
      fileSize: numSize,
      mimeType: normMime,
      totalChunks: numTotalChunks,
      chunkSize: numChunkSize,
      uploadedChunks: [],
      bytesReceived: 0,
      status: 'uploading',
      tempDir,
      videoId,
      expiresAt,
    });

    await session.save();

    return res.status(201).json({
      success: true,
      uploadId,
      videoId,
      chunkSize: numChunkSize,
      totalChunks: numTotalChunks,
      status: 'uploading',
      expiresAt,
    });
  } catch (err) {
    console.error('[Upload Init Error]', err);
    return res.status(500).json({ error: 'Failed to initialize upload session.' });
  }
});

/**
 * PUT /api/upload/:uploadId/chunk/:chunkIndex
 * Upload an individual raw chunk (supports raw body or binary stream)
 */
router.put(
  '/:uploadId/chunk/:chunkIndex',
  requireAuth,
  express.raw({ limit: '25mb', type: () => true }),
  async (req, res) => {
    try {
      const { uploadId, chunkIndex } = req.params;
      const index = parseInt(chunkIndex, 10);

      if (isNaN(index) || index < 0) {
        return res.status(400).json({ error: 'Invalid chunk index.' });
      }

      const session = await UploadSession.findOne({ uploadId });
      if (!session) {
        return res.status(404).json({ error: 'Upload session not found or expired.' });
      }

      // Authorization: must belong to authenticated user
      if (session.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Unauthorized to upload to this session.' });
      }

      if (session.status !== 'uploading') {
        return res.status(400).json({
          error: `Cannot upload chunks to session in "${session.status}" state.`,
        });
      }

      if (index >= session.totalChunks) {
        return res.status(400).json({
          error: `Chunk index ${index} exceeds totalChunks (${session.totalChunks}).`,
        });
      }

      const chunkBuffer = req.body;
      if (!Buffer.isBuffer(chunkBuffer) || chunkBuffer.length === 0) {
        return res.status(400).json({ error: 'Empty chunk data received.' });
      }

      // Enforce chunk size boundaries
      const maxAllowedChunk = Math.ceil(session.chunkSize * 1.5);
      if (chunkBuffer.length > maxAllowedChunk) {
        return res.status(400).json({
          error: `Chunk size (${chunkBuffer.length} bytes) exceeds maximum expected chunk size (${maxAllowedChunk} bytes).`,
        });
      }

      // --- Magic Bytes Signature Validation on Chunk 0 ---
      if (index === 0) {
        const signatureCheck = validateVideoSignature(chunkBuffer, session.mimeType);
        if (!signatureCheck.valid) {
          session.status = 'failed';
          session.errorMessage = signatureCheck.error;
          await session.save();

          // Mark video as failed
          await Video.updateOne(
            { id: session.videoId },
            { $set: { processingStatus: 'failed', processingError: signatureCheck.error } }
          );

          // Clean up temp dir
          if (session.tempDir && fs.existsSync(session.tempDir)) {
            try { fs.rmSync(session.tempDir, { recursive: true, force: true }); } catch {}
          }

          return res.status(400).json({
            error: signatureCheck.error,
            code: 'INVALID_FILE_SIGNATURE',
          });
        }
      }

      // Write chunk to isolated temp file with robust checks
      const chunkFileName = `chunk_${index}.part`;
      const chunkPath = path.join(session.tempDir, chunkFileName);

      // Use path.relative for true containment check
      const relPath = path.relative(session.tempDir, chunkPath);
      if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
        return res.status(400).json({ error: 'Invalid chunk path.' });
      }

      try {
        // Atomic exclusive write – fails if file already exists
        fs.writeFileSync(chunkPath, chunkBuffer, { flag: 'wx' });
      } catch (e) {
        if (e.code === 'EEXIST') {
          // Existing chunk – verify content matches
          const existing = fs.readFileSync(chunkPath);
          if (!existing.equals(chunkBuffer)) {
            return res.status(409).json({ error: 'Chunk data mismatch for existing chunk.' });
          }
          // Duplicate identical chunk – treat as success without DB update
          return res.json({
            success: true,
            chunkIndex: index,
            uploadedChunks: session.uploadedChunks,
            totalChunks: session.totalChunks,
            status: session.status,
          });
        }
        console.error('[Chunk Write Error]', e);
        return res.status(500).json({ error: 'Failed to write chunk file.' });
      }

      // Atomically update uploadedChunks in session (deduplicated by $addToSet)
      const isAlreadyUploaded = session.uploadedChunks.includes(index);
      const updateOps = { $addToSet: { uploadedChunks: index } };
      if (!isAlreadyUploaded) {
        updateOps.$inc = { bytesReceived: chunkBuffer.length };
      }

      const updatedSession = await UploadSession.findOneAndUpdate(
        { uploadId },
        updateOps,
        { returnDocument: 'after' }
      );

      const isAllUploaded = updatedSession.uploadedChunks.length === updatedSession.totalChunks;

      if (isAllUploaded) {
        // Atomic compare-and-swap: transition from uploading -> processing
        // Guarantees ONLY ONE concurrent request can ever trigger processUploadedVideo
        const processingSession = await UploadSession.findOneAndUpdate(
          { uploadId, status: 'uploading' },
          { $set: { status: 'processing' } },
          { returnDocument: 'after' }
        );

        if (processingSession) {
          processUploadedVideo(uploadId).catch(procErr => {
            console.error('[Async Video Processing Background Error]', procErr);
          });
        }

        return res.json({
          success: true,
          chunkIndex: index,
          uploadedChunks: updatedSession.uploadedChunks,
          status: 'processing',
          message: 'All chunks uploaded successfully. Processing started.',
        });
      }

      return res.json({
        success: true,
        chunkIndex: index,
        uploadedChunks: updatedSession.uploadedChunks,
        totalChunks: updatedSession.totalChunks,
        status: 'uploading',
      });
    } catch (err) {
      console.error('[Upload Chunk Error]', err);
      return res.status(500).json({ error: 'Failed to process chunk upload.' });
    }
  }
);

/**
 * GET /api/upload/:uploadId/status
 * Check current upload progress and processing status
 */
router.get('/:uploadId/status', requireAuth, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const session = await UploadSession.findOne({ uploadId }).lean();

    if (!session) {
      return res.status(404).json({ error: 'Upload session not found.' });
    }

    if (session.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to view this upload session.' });
    }

    // Fetch video processing status
    const video = await Video.findOne({ id: session.videoId }).lean();

    return res.json({
      uploadId: session.uploadId,
      videoId: session.videoId,
      status: session.status,
      uploadedChunks: session.uploadedChunks,
      totalChunks: session.totalChunks,
      bytesReceived: session.bytesReceived,
      fileSize: session.fileSize,
      processingProgress: video ? video.processingProgress : session.processingProgress,
      processingStatus: video ? video.processingStatus : session.status,
      processingError: video ? video.processingError : session.errorMessage,
      video: video && (video.processingStatus === 'ready' || session.status === 'completed') ? video : null,
    });
  } catch (err) {
    console.error('[Upload Status Error]', err);
    return res.status(500).json({ error: 'Failed to fetch upload status.' });
  }
});

/**
 * DELETE /api/upload/:uploadId
 * Cancel an active upload session and clean up temporary chunks
 */
router.delete('/:uploadId', requireAuth, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const session = await UploadSession.findOne({ uploadId });

    if (!session) {
      return res.status(404).json({ error: 'Upload session not found.' });
    }

    if (session.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to cancel this upload session.' });
    }

    if (session.tempDir && fs.existsSync(session.tempDir)) {
      try {
        fs.rmSync(session.tempDir, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn('[Session Delete Warning]', rmErr.message);
      }
    }

    session.status = 'abandoned';
    session.errorMessage = 'Upload cancelled by user.';
    await session.save();

    if (session.videoId) {
      await Video.deleteOne({ id: session.videoId, processingStatus: { $ne: 'ready' } });
    }

    return res.json({
      success: true,
      message: 'Upload session cancelled and temporary files removed.',
    });
  } catch (err) {
    console.error('[Cancel Upload Error]', err);
    return res.status(500).json({ error: 'Failed to cancel upload.' });
  }
});

/**
 * GET /api/upload/my/videos
 * Return all videos uploaded by the authenticated creator
 */
router.get('/my/videos', requireAuth, async (req, res) => {
  try {
    const videos = await Video.find({ uploaderId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      total: videos.length,
      videos,
    });
  } catch (err) {
    console.error('[Creator Videos Error]', err);
    return res.status(500).json({ error: 'Failed to fetch creator videos.' });
  }
});

/**
 * DELETE /api/upload/my/videos/:videoId
 * Delete an uploaded video belonging to the authenticated creator
 */
router.delete('/my/videos/:videoId', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const video = await Video.findOne({ id: videoId, uploaderId: req.user._id });

    if (!video) {
      return res.status(404).json({ error: 'Video not found or unauthorized.' });
    }

    // Clean up physical video file if present
    if (video.storagePath && fs.existsSync(video.storagePath)) {
      try {
        fs.unlinkSync(video.storagePath);
      } catch (fErr) {
        console.warn('[Video File Unlink Warning]', fErr.message);
      }
    }

    // Clean up thumbnail if local
    if (video.thumbnailUrl && video.thumbnailUrl.startsWith('/uploads/thumbnails/')) {
      const thumbFile = path.basename(video.thumbnailUrl);
      const thumbPath = path.resolve(__dirname, '../uploads/thumbnails', thumbFile);
      if (fs.existsSync(thumbPath)) {
        try {
          fs.unlinkSync(thumbPath);
        } catch (tErr) {
          console.warn('[Thumbnail File Unlink Warning]', tErr.message);
        }
      }
    }

    await Video.deleteOne({ id: videoId, uploaderId: req.user._id });

    return res.json({
      success: true,
      message: 'Video deleted successfully.',
    });
  } catch (err) {
    console.error('[Delete Video Error]', err);
    return res.status(500).json({ error: 'Failed to delete video.' });
  }
});

module.exports = router;

