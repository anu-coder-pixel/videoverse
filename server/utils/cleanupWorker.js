/**
 * VideoVerse — Unified Background Cleanup Worker
 *
 * Responsibilities:
 * 1. Safely removes expired/orphaned upload chunks (>12 hours old).
 * 2. Purges expired temporary watermarked video files (>2 hours old).
 * 3. Cleans abandoned transcoding temporary files (>1 hour old).
 * 4. Resolves stale download reservations (>15 mins old) to 'interrupted'.
 * 5. Strictly protects original videos (server/uploads/videos/) and ready HLS segments.
 * 6. Supports periodic scheduled execution and on-demand invocation.
 */

const fs = require('fs');
const path = require('path');
const Download = require('../models/Download');
const UploadSession = require('../models/UploadSession');
const Video = require('../models/Video');

const UPLOAD_ROOT = path.resolve(__dirname, '../uploads');
const CHUNKS_DIR = path.join(UPLOAD_ROOT, 'chunks');
const WATERMARKED_DIR = path.join(UPLOAD_ROOT, 'watermarked');
const TEMP_DIR = path.join(UPLOAD_ROOT, 'temp');
const VIDEOS_DIR = path.join(UPLOAD_ROOT, 'videos'); // NEVER delete ready original videos!
const HLS_DIR = path.join(UPLOAD_ROOT, 'hls');

// Safety verification: Ensure safe directories reside under UPLOAD_ROOT
function isPathUnderRoot(targetPath, baseDir) {
  const rel = path.relative(baseDir, targetPath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Sweeps a directory and removes files older than maxAgeMs, skipping files modified recently.
 * NEVER deletes inside VIDEOS_DIR.
 */
function sweepOldFiles(dirPath, maxAgeMs, safetyBase) {
  if (!fs.existsSync(dirPath)) return 0;
  let deletedCount = 0;
  const now = Date.now();
  const minAgeThreshold = 10 * 60 * 1000; // Never delete files younger than 10 minutes

  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);

      // Extra sanity check: Never delete inside original video storage
      if (fullPath.startsWith(VIDEOS_DIR + path.sep)) {
        console.warn(`[Cleanup Guard] Attempted access to protected videos directory skipped: ${fullPath}`);
        continue;
      }

      if (!isPathUnderRoot(fullPath, safetyBase)) {
        console.warn(`[Cleanup Guard] Traversal guard skipped path outside safety root: ${fullPath}`);
        continue;
      }

      try {
        const stats = fs.statSync(fullPath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs && age > minAgeThreshold) {
          if (stats.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
          deletedCount++;
        }
      } catch (entryErr) {
        // Ignore file in use or concurrently deleted
      }
    }
  } catch (dirErr) {
    console.warn(`[Cleanup Worker] Error reading directory ${dirPath}:`, dirErr.message);
  }

  return deletedCount;
}

/**
 * Runs a complete cleanup sweep across database reservations and temporary storage directories.
 */
async function runCleanup() {
  const summary = {
    staleReservationsResolved: 0,
    expiredUploadSessionsCleaned: 0,
    orphanedChunksDeleted: 0,
    watermarkedTempDeleted: 0,
    transcodingTempDeleted: 0,
    errors: [],
  };

  try {
    // 1. Resolve stale download reservations (>15 minutes)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const reservationResult = await Download.updateMany(
      {
        status: 'reserved',
        reservedAt: { $lt: fifteenMinsAgo },
      },
      {
        $set: {
          status: 'interrupted',
          errorMessage: 'Download reservation expired before stream completion.',
        },
      }
    );
    summary.staleReservationsResolved = reservationResult.modifiedCount || 0;

    // 2. Clean expired/abandoned upload sessions
    const staleUploadThreshold = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const staleSessions = await UploadSession.find({
      $or: [
        { expiresAt: { $lt: new Date() }, status: { $in: ['uploading', 'processing'] } },
        { createdAt: { $lt: staleUploadThreshold }, status: { $in: ['abandoned', 'failed'] } },
      ],
    });

    for (const session of staleSessions) {
      if (session.tempDir && fs.existsSync(session.tempDir) && isPathUnderRoot(session.tempDir, UPLOAD_ROOT)) {
        try {
          fs.rmSync(session.tempDir, { recursive: true, force: true });
          summary.expiredUploadSessionsCleaned++;
        } catch {}
      }
      if (session.status === 'uploading' || session.status === 'processing') {
        session.status = 'abandoned';
        await session.save();
      }
    }

    // 3. Purge orphaned upload chunk folders older than 12 hours
    if (fs.existsSync(CHUNKS_DIR)) {
      summary.orphanedChunksDeleted = sweepOldFiles(CHUNKS_DIR, 12 * 60 * 60 * 1000, UPLOAD_ROOT);
    }

    // 4. Purge temporary watermarked files older than 2 hours
    if (fs.existsSync(WATERMARKED_DIR)) {
      summary.watermarkedTempDeleted = sweepOldFiles(WATERMARKED_DIR, 2 * 60 * 60 * 1000, UPLOAD_ROOT);
    }

    // 5. Purge temporary transcoding artifacts older than 1 hour
    if (fs.existsSync(TEMP_DIR)) {
      summary.transcodingTempDeleted = sweepOldFiles(TEMP_DIR, 60 * 60 * 1000, UPLOAD_ROOT);
    }

    const totalFiles = summary.orphanedChunksDeleted + summary.watermarkedTempDeleted + summary.transcodingTempDeleted;
    if (totalFiles > 0 || summary.staleReservationsResolved > 0) {
      console.log(`🧹 [Cleanup Worker] Sweep completed: ${totalFiles} temp files removed, ${summary.staleReservationsResolved} stale reservations updated.`);
    }
  } catch (err) {
    console.error('[Cleanup Worker Error]', err.message);
    summary.errors.push(err.message);
  }

  return summary;
}

let cleanupIntervalTimer = null;

/**
 * Initializes the periodic background cleanup job (runs every 30 minutes).
 */
function startCleanupWorker(intervalMs = 30 * 60 * 1000) {
  if (cleanupIntervalTimer) return;
  // Run an initial sweep on boot
  runCleanup().catch(() => {});

  cleanupIntervalTimer = setInterval(() => {
    runCleanup().catch(err => console.error('[Cleanup Schedule Error]:', err.message));
  }, intervalMs);

  if (cleanupIntervalTimer.unref) {
    cleanupIntervalTimer.unref(); // Don't prevent process exit
  }
}

function stopCleanupWorker() {
  if (cleanupIntervalTimer) {
    clearInterval(cleanupIntervalTimer);
    cleanupIntervalTimer = null;
  }
}

module.exports = {
  runCleanup,
  startCleanupWorker,
  stopCleanupWorker,
  sweepOldFiles,
  UPLOAD_ROOT,
  CHUNKS_DIR,
  WATERMARKED_DIR,
  TEMP_DIR,
  VIDEOS_DIR,
};

