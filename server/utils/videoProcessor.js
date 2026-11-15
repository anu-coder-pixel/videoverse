/**
 * VideoVerse — Asynchronous Video Processing Pipeline
 *
 * Handles chunk assembly, metadata extraction, thumbnail generation,
 * state machine transitions (uploading -> processing -> ready/failed),
 * and safe failure recovery.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const Video = require('../models/Video');
const UploadSession = require('../models/UploadSession');
const TranscodeJob = require('../models/TranscodeJob');
const { validateVideoSignature } = require('./fileSignature');
const { transcodeQueue } = require('./hlsTranscoder');

const UPLOAD_ROOT = path.resolve(__dirname, '../uploads');
const VIDEOS_DIR = path.join(UPLOAD_ROOT, 'videos');
const THUMBNAILS_DIR = path.join(UPLOAD_ROOT, 'thumbnails');
const CHUNKS_DIR = path.join(UPLOAD_ROOT, 'chunks');

// Ensure directories exist
[UPLOAD_ROOT, VIDEOS_DIR, THUMBNAILS_DIR, CHUNKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
});

/**
 * Format duration in seconds to "MM:SS" or "HH:MM:SS"
 */
function formatDuration(seconds) {
  const sec = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;

  const pad = num => String(num).padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(remainingSecs)}`;
  }
  return `${mins}:${pad(remainingSecs)}`;
}

/**
 * Generates an elegant branded SVG thumbnail when FFmpeg is not available
 */
function generateFallbackThumbnail(title, category, channelName) {
  const sanitizedTitle = (title || 'Video')
    .replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
    .slice(0, 45);
  const sanitizedChannel = (channelName || 'VideoVerse Creator')
    .replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
    .slice(0, 30);
  const sanitizedCategory = (category || 'General').toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="50%" stop-color="#1e1b4b" />
        <stop offset="100%" stop-color="#090d16" />
      </linearGradient>
      <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="100%" stop-color="#ec4899" />
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)" />
    <!-- Ambient circle -->
    <circle cx="1100" cy="150" r="300" fill="#6366f1" opacity="0.15" />
    <circle cx="150" cy="600" r="250" fill="#ec4899" opacity="0.1" />
    <!-- Category Badge -->
    <rect x="100" y="80" width="160" height="40" rx="8" fill="url(#accent)" />
    <text x="180" y="106" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${sanitizedCategory}</text>
    <!-- Video Title -->
    <text x="100" y="320" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="800" fill="#ffffff" width="1080">
      ${sanitizedTitle}
    </text>
    <!-- Channel Name -->
    <text x="100" y="420" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="500" fill="#94a3b8">
      ${sanitizedChannel}
    </text>
    <!-- Play Icon Outline -->
    <circle cx="640" cy="560" r="50" fill="none" stroke="#6366f1" stroke-width="4" opacity="0.8" />
    <polygon points="630,540 660,560 630,580" fill="#ffffff" />
    <!-- Branding -->
    <text x="1180" y="660" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="bold" fill="#64748b" text-anchor="end">VideoVerse</text>
  </svg>`;
}

/**
 * Assembles all uploaded chunks into a single unified file in numerical order
 */
async function assembleChunks(session) {
  const ext = session.mimeType === 'video/webm' ? '.webm' : '.mp4';
  const targetFileName = `${session.uploadId}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const targetPath = path.join(VIDEOS_DIR, targetFileName);

  // Path traversal guard
  if (!targetPath.startsWith(VIDEOS_DIR)) {
    throw new Error('Security Error: Invalid storage target path.');
  }

  const writeStream = fs.createWriteStream(targetPath);

  for (let i = 0; i < session.totalChunks; i++) {
    const chunkPath = path.join(session.tempDir, `chunk_${i}.part`);
    if (!fs.existsSync(chunkPath)) {
      writeStream.destroy();
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      throw new Error(`Missing chunk ${i} during assembly.`);
    }

    const chunkData = fs.readFileSync(chunkPath);
    writeStream.write(chunkData);
  }

  await new Promise((resolve, reject) => {
    writeStream.end();
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  // Verify total assembled file size matches expected size
  const stat = fs.statSync(targetPath);
  if (stat.size !== session.fileSize || stat.size === 0) {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    throw new Error(`File integrity error: Assembled file size (${stat.size} bytes) does not match expected size (${session.fileSize} bytes).`);
  }

  // Verify final assembled file signature directly on disk
  const sampleHeader = Buffer.alloc(Math.min(64, stat.size));
  const fd = fs.openSync(targetPath, 'r');
  fs.readSync(fd, sampleHeader, 0, sampleHeader.length, 0);
  fs.closeSync(fd);

  const signatureVerification = validateVideoSignature(sampleHeader, session.mimeType);
  if (!signatureVerification.valid) {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    throw new Error(`File integrity error: Assembled file failed signature validation (${signatureVerification.error}).`);
  }

  // Remove chunk parts and temp directory
  try {
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(session.tempDir, `chunk_${i}.part`);
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
    }
    if (fs.existsSync(session.tempDir)) {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    }
  } catch (cleanErr) {
    console.warn('[Chunk Clean Warning]', cleanErr.message);
  }

  return { targetFileName, targetPath, fileSize: stat.size };
}

/**
 * Attempts FFmpeg / FFprobe extraction; falls back gracefully if not found
 */
async function extractMetadataAndThumbnail(videoFilePath, title, category, channelName) {
  let durationSeconds = 180; // default 3 mins
  let resolution = '1080p';
  let thumbnailRelativeUrl = '';

  const thumbBaseName = `thumb_${crypto.randomBytes(8).toString('hex')}`;

  // 1. Try probing via ffprobe
  const probePromise = new Promise(resolve => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=width,height',
      '-of', 'json',
      videoFilePath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', chunk => { output += chunk; });
    ffprobe.on('close', code => {
      if (code === 0 && output) {
        try {
          const parsed = JSON.parse(output);
          const dur = parseFloat(parsed.format?.duration);
          if (!isNaN(dur) && dur > 0) durationSeconds = dur;

          const stream = parsed.streams?.[0];
          if (stream?.height) {
            resolution = `${stream.height}p`;
          }
          return resolve(true);
        } catch {
          resolve(false);
        }
      }
      resolve(false);
    });
    ffprobe.on('error', () => resolve(false));
  });

  // 2. Try thumbnail via ffmpeg
  const thumbPathJpg = path.join(THUMBNAILS_DIR, `${thumbBaseName}.jpg`);
  const ffmpegPromise = new Promise(resolve => {
    const ffmpeg = spawn('ffmpeg', [
      '-ss', '00:00:01',
      '-i', videoFilePath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      thumbPathJpg,
    ]);

    ffmpeg.on('close', code => {
      if (code === 0 && fs.existsSync(thumbPathJpg)) {
        thumbnailRelativeUrl = `/uploads/thumbnails/${thumbBaseName}.jpg`;
        return resolve(true);
      }
      resolve(false);
    });
    ffmpeg.on('error', () => resolve(false));
  });

  const [hasProbe, hasFfmpeg] = await Promise.all([probePromise, ffmpegPromise]);

  let thumbnailType = 'extracted';
  // If FFmpeg thumbnail failed or was unavailable, generate fallback branded SVG
  if (!hasFfmpeg || !thumbnailRelativeUrl) {
    const thumbPathSvg = path.join(THUMBNAILS_DIR, `${thumbBaseName}.svg`);
    const svgContent = generateFallbackThumbnail(title, category, channelName);
    fs.writeFileSync(thumbPathSvg, svgContent, 'utf8');
    thumbnailRelativeUrl = `/uploads/thumbnails/${thumbBaseName}.svg`;
    thumbnailType = 'placeholder_svg';
  }

  const durationEstimated = !hasProbe;
  const resolutionEstimated = !hasProbe;

  // Fallback estimate for duration if ffprobe wasn't available: estimate based on file size
  if (!hasProbe) {
    try {
      const stats = fs.statSync(videoFilePath);
      // Rough approximation assuming ~2 Mbps average bitrate:
      const estimatedSec = Math.max(15, Math.min(3600, Math.round((stats.size * 8) / (2 * 1024 * 1024))));
      durationSeconds = estimatedSec;
    } catch {
      durationSeconds = 120;
    }
  }

  return {
    duration: formatDuration(durationSeconds),
    durationEstimated,
    resolution,
    resolutionEstimated,
    thumbnailUrl: thumbnailRelativeUrl,
    thumbnailType,
  };
}

/**
 * Orchestrates complete asynchronous video processing
 */
async function processUploadedVideo(uploadId) {
  const session = await UploadSession.findOne({ uploadId });
  if (!session) return;

  const video = await Video.findOne({ id: session.videoId });
  if (!video) return;

  try {
    // Stage 1: Assembling chunks (progress: 25%)
    session.status = 'processing';
    session.processingProgress = 25;
    await session.save();

    video.processingStatus = 'processing';
    video.processingProgress = 25;
    await video.save();

    const { targetFileName, targetPath, fileSize } = await assembleChunks(session);

    // Stage 2: Processing & Metadata Extraction (progress: 70%)
    session.processingProgress = 70;
    await session.save();

    video.processingProgress = 70;
    video.storagePath = targetPath;
    video.fileSize = fileSize;
    await video.save();

    const metadata = await extractMetadataAndThumbnail(
      targetPath,
      video.title,
      video.category,
      video.channel?.name
    );

    // Stage 3: Ready & Completed (progress: 100%)
    video.processingStatus = 'ready';
    video.processingProgress = 100;
    video.duration = metadata.duration;
    video.durationEstimated = metadata.durationEstimated;
    video.resolution = metadata.resolution;
    video.resolutionEstimated = metadata.resolutionEstimated;
    video.thumbnailUrl = metadata.thumbnailUrl;
    video.thumbnailType = metadata.thumbnailType;
    video.videoUrl = `/api/videos/${video.id}/stream`;
    video.uploadedAt = 'Just now';
    await video.save();

    session.status = 'completed';
    session.processingProgress = 100;
    await session.save();

    // Stage 4: Trigger Background HLS Transcoding & Sprite Generation
    const existingJob = await TranscodeJob.findOne({ videoId: video.id });
    if (!existingJob) {
      const jobId = `job_${video.id}_${Date.now()}`;
      const job = await TranscodeJob.create({
        jobId,
        videoId: video.id,
        uploadId: session.uploadId,
        sourcePath: targetPath,
        status: 'queued',
      });
      transcodeQueue.enqueue(jobId);
    } else if (existingJob.status === 'failed') {
      existingJob.status = 'queued';
      existingJob.attempts = 0;
      await existingJob.save();
      transcodeQueue.enqueue(existingJob.jobId);
    }

    console.log(`✅ [Video Processing Complete] Video "${video.title}" (ID: ${video.id}) ready and queued for adaptive HLS transcoding.`);
  } catch (err) {
    console.error(`❌ [Video Processing Failed] ${err.message}`);

    // Clean up partial assembled video file if left behind
    if (video.storagePath && fs.existsSync(video.storagePath)) {
      try {
        fs.unlinkSync(video.storagePath);
        video.storagePath = '';
      } catch (cleanErr) {
        console.warn('[Storage Cleanup Warning]', cleanErr.message);
      }
    }

    session.status = 'failed';
    session.errorMessage = err.message;
    await session.save();

    video.processingStatus = 'failed';
    video.processingError = err.message;
    await video.save();
  }
}

module.exports = {
  assembleChunks,
  extractMetadataAndThumbnail,
  processUploadedVideo,
  formatDuration,
  generateFallbackThumbnail,
  UPLOAD_ROOT,
  VIDEOS_DIR,
  THUMBNAILS_DIR,
  CHUNKS_DIR,
};

