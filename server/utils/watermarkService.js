/**
 * VideoVerse — User-Specific Video Watermarking Service
 *
 * Responsibilities:
 * 1. Generates masked user identifiers (e.g. j***e@example.com or user_***1234).
 * 2. Burns a persistent, semi-transparent watermark into downloaded video frames via FFmpeg drawtext.
 * 3. Never mutates the original uploaded video source.
 * 4. Stores watermarked artifacts separately in server/uploads/watermarked/.
 * 5. Cleans up partial/failed files safely.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const FFMPEG_BIN = ffmpegInstaller.path;

const UPLOAD_ROOT = path.resolve(__dirname, '../uploads');
const WATERMARKED_DIR = path.join(UPLOAD_ROOT, 'watermarked');

// Ensure watermarked storage directory exists
if (!fs.existsSync(WATERMARKED_DIR)) {
  fs.mkdirSync(WATERMARKED_DIR, { recursive: true, mode: 0o755 });
}

/**
 * Creates a privacy-preserving masked user identifier for video watermarking.
 * e.g. "j***e@example.com" or "User_***ab12"
 */
function createMaskedIdentifier(user) {
  if (!user) return 'User_***Anon';

  const email = (user.email || '').trim().toLowerCase();
  if (email && email.includes('@')) {
    const [localPart, domain] = email.split('@');
    if (localPart.length <= 2) {
      return `${localPart[0] || 'u'}***@${domain}`;
    }
    const firstChar = localPart[0];
    const lastChar = localPart[localPart.length - 1];
    return `${firstChar}***${lastChar}@${domain}`;
  }

  const userIdStr = String(user._id || user.id || '');
  if (userIdStr.length >= 4) {
    return `User_***${userIdStr.slice(-4)}`;
  }

  const name = (user.name || 'User').trim();
  return `${name[0]}***`;
}

/**
 * Builds the display watermark text.
 */
function buildWatermarkText(user) {
  const maskedId = createMaskedIdentifier(user);
  const dateStr = new Date().toISOString().slice(0, 10);
  return `VideoVerse • ${maskedId} • ${dateStr}`;
}

/**
 * Safely escapes text for FFmpeg drawtext filter syntax.
 */
function escapeDrawText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

/**
 * Asynchronously renders a visible, user-specific watermark onto a video file using FFmpeg.
 *
 * @param {object} params
 * @param {string} params.inputPath Path to source video file
 * @param {string} params.outputPath Path to output watermarked file
 * @param {string} params.watermarkText Text to display in the watermark
 * @param {AbortSignal} [params.signal] Optional abort signal for client disconnect
 * @returns {Promise<string>} Resolves with outputPath
 */
function applyWatermark({ inputPath, outputPath, watermarkText, signal }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Source video not found for watermarking: ${inputPath}`));
    }

    // Reuse existing generated watermarked file if valid and not empty
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
      return resolve(outputPath);
    }

    const escapedText = escapeDrawText(watermarkText);
    const drawtextFilter = `drawtext=text='${escapedText}':x=w-tw-20:y=h-th-20:fontsize=15:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=5`;

    const args = [
      '-i', inputPath,
      '-vf', drawtextFilter,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];

    const proc = spawn(FFMPEG_BIN, args);
    let stderr = '';

    proc.stderr.on('data', chunk => {
      stderr += chunk;
    });

    const cleanupPartial = () => {
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (err) {
        // ignore unlink error
      }
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        cleanupPartial();
        reject(new Error('Watermark processing was aborted by client disconnect.'));
      });
    }

    proc.on('close', code => {
      if (code !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        cleanupPartial();
        return reject(new Error(`FFmpeg watermarking failed (code ${code}): ${stderr.slice(-300)}`));
      }
      resolve(outputPath);
    });

    proc.on('error', err => {
      cleanupPartial();
      reject(err);
    });
  });
}

/**
 * Returns the standard output path for a watermarked download.
 */
function getWatermarkedPath(downloadId, videoId) {
  return path.join(WATERMARKED_DIR, `${downloadId}_${videoId}_wm.mp4`);
}

module.exports = {
  WATERMARKED_DIR,
  createMaskedIdentifier,
  buildWatermarkText,
  escapeDrawText,
  applyWatermark,
  getWatermarkedPath,
};

