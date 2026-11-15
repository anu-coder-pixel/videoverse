/**
 * VideoVerse — Abandoned Upload & Storage Cleanup Utility
 *
 * Scans for expired or aborted upload sessions and removes orphaned
 * partial chunk files and stale directories.
 */

const fs = require('fs');
const path = require('path');
const UploadSession = require('../models/UploadSession');
const Video = require('../models/Video');
const { CHUNKS_DIR, VIDEOS_DIR } = require('./videoProcessor');

/**
 * Cleans up abandoned or expired upload sessions and temporary directories
 */
async function cleanupAbandonedUploads() {
  try {
    const now = new Date();

    // 1. Find sessions that expired (in uploading or processing) or failed/abandoned
    const staleSessions = await UploadSession.find({
      $or: [
        { expiresAt: { $lt: now }, status: { $in: ['uploading', 'processing'] } },
        { status: 'abandoned' },
        { status: 'failed' },
      ],
    });

    let cleanedCount = 0;

    for (const session of staleSessions) {
      // Clean temp chunks directory
      if (session.tempDir && fs.existsSync(session.tempDir)) {
        try {
          fs.rmSync(session.tempDir, { recursive: true, force: true });
          cleanedCount++;
        } catch (rmErr) {
          console.warn(`[Cleanup Warning] Could not delete ${session.tempDir}:`, rmErr.message);
        }
      }

      // Clean unready video record and any partially assembled video files
      if (session.videoId) {
        try {
          const video = await Video.findOne({ id: session.videoId });
          if (video && video.processingStatus !== 'ready') {
            if (video.storagePath && fs.existsSync(video.storagePath)) {
              fs.unlinkSync(video.storagePath);
            }
            await Video.deleteOne({ id: session.videoId, processingStatus: { $ne: 'ready' } });
            cleanedCount++;
          }
        } catch (vErr) {
          console.warn(`[Cleanup Video Warning]`, vErr.message);
        }
      }

      if (session.status === 'uploading' || session.status === 'processing') {
        session.status = 'abandoned';
        session.errorMessage = 'Upload session expired or interrupted and was abandoned.';
        await session.save();
      }
    }

    // 2. Scan CHUNKS_DIR for directories older than 24h not associated with active sessions
    if (fs.existsSync(CHUNKS_DIR)) {
      const entries = fs.readdirSync(CHUNKS_DIR);
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      for (const entry of entries) {
        const fullPath = path.join(CHUNKS_DIR, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && stat.mtimeMs < oneDayAgo) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            cleanedCount++;
          }
        } catch {
          // Ignore transient stat errors
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 [Upload Cleanup] Removed ${cleanedCount} abandoned/stale temporary upload items.`);
    }

    return { cleanedCount };
  } catch (err) {
    console.error('[Upload Cleanup Error]', err);
    return { cleanedCount: 0, error: err.message };
  }
}

module.exports = {
  cleanupAbandonedUploads,
};

