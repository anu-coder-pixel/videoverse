/**
 * VideoVerse — Server-Side Transcoding & Adaptive HLS Generator
 *
 * Responsibilities:
 * 1. Probing & metadata extraction via bundled ffprobe.
 * 2. Adaptive HLS generation for resolutions: 1080p, 720p, 480p, 360p.
 *    - Strictly prevents upscaling beyond native source resolution and aspect ratio.
 * 3. Master .m3u8 playlist generation with correct bandwidth and resolution tags.
 * 4. Thumbnail sprite sheet (.jpg) and WebVTT (.vtt) metadata generation.
 * 5. Background queue management with concurrency limits and crash recovery.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

const Video = require('../models/Video');
const UploadSession = require('../models/UploadSession');
const TranscodeJob = require('../models/TranscodeJob');

const FFMPEG_BIN = ffmpegInstaller.path;
const FFPROBE_BIN = ffprobeInstaller.path;

const UPLOAD_ROOT = path.resolve(__dirname, '../uploads');
const HLS_ROOT = path.join(UPLOAD_ROOT, 'hls');

// Ensure base HLS directory exists
if (!fs.existsSync(HLS_ROOT)) {
  fs.mkdirSync(HLS_ROOT, { recursive: true, mode: 0o755 });
}

// Target standard video tiers for adaptive streaming
const RESOLUTION_TIERS = [
  { name: '1080p', height: 1080, bandwidth: 4500000, audioBitrate: '192k' },
  { name: '720p',  height: 720,  bandwidth: 2500000, audioBitrate: '128k' },
  { name: '480p',  height: 480,  bandwidth: 1200000, audioBitrate: '96k' },
  { name: '360p',  height: 360,  bandwidth: 800000,  audioBitrate: '64k' },
];

/**
 * Probes video using bundled ffprobe.
 * Returns { duration, width, height, bitrate, format, codec }
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`Input file not found: ${filePath}`));
    }

    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate,format_name:stream=width,height,codec_name',
      '-of', 'json',
      filePath,
    ];

    const proc = spawn(FFPROBE_BIN, args);
    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { errorOutput += chunk; });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`FFprobe exited with code ${code}: ${errorOutput}`));
      }
      try {
        const parsed = JSON.parse(output);
        const format = parsed.format || {};
        const videoStream = (parsed.streams || []).find(s => s.width && s.height) || {};

        const width = parseInt(videoStream.width, 10) || 0;
        const height = parseInt(videoStream.height, 10) || 0;
        const duration = parseFloat(format.duration) || 0;
        const bitrate = parseInt(format.bit_rate, 10) || 0;

        if (!width || !height) {
          return reject(new Error('Invalid video: Could not detect video dimensions.'));
        }

        resolve({
          width,
          height,
          duration,
          bitrate,
          codec: videoStream.codec_name || 'unknown',
          formatName: format.format_name || '',
        });
      } catch (err) {
        reject(new Error(`Failed to parse FFprobe output: ${err.message}`));
      }
    });

    proc.on('error', err => reject(err));
  });
}

/**
 * Generates an HLS variant stream (.m3u8 and .ts segments) for a specific resolution.
 */
function transcodeResolution({ inputPath, outputDir, resolutionTier, isNative = false }) {
  return new Promise((resolve, reject) => {
    const scaleFilter = isNative ? 'scale=-2:-2' : `scale=-2:${resolutionTier.height}`;
    const playlistName = `${resolutionTier.name}.m3u8`;
    const segmentPattern = `${resolutionTier.name}_%03d.ts`;
    const playlistPath = path.join(outputDir, playlistName);

    const args = [
      '-i', inputPath,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'veryfast',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', resolutionTier.audioBitrate,
      '-hls_time', '4',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(outputDir, segmentPattern),
      '-y',
      playlistPath,
    ];

    const proc = spawn(FFMPEG_BIN, args);
    let errorOutput = '';

    proc.stderr.on('data', chunk => {
      errorOutput += chunk;
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg transcoding failed for ${resolutionTier.name} (code ${code}): ${errorOutput}`));
      }
      resolve({
        name: resolutionTier.name,
        playlist: playlistName,
        height: resolutionTier.height,
        bandwidth: resolutionTier.bandwidth,
      });
    });

    proc.on('error', err => reject(err));
  });
}

/**
 * Builds the Master HLS playlist referencing all generated resolution playlists.
 */
function createMasterPlaylist(outputDir, variants, sourceWidth, sourceHeight) {
  let content = '#EXTM3U\n#EXT-X-VERSION:3\n';

  variants.forEach(variant => {
    // Calculate aspect-ratio preserved resolution width
    const calculatedWidth = Math.round((sourceWidth * (variant.height / sourceHeight)) / 2) * 2;
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${calculatedWidth}x${variant.height},NAME="${variant.name}"\n`;
    content += `${variant.playlist}\n`;
  });

  const masterPath = path.join(outputDir, 'master.m3u8');
  fs.writeFileSync(masterPath, content, 'utf8');
  return 'master.m3u8';
}

/**
 * Generates hover thumbnail sprite sheet (.jpg) and WebVTT (.vtt) file.
 */
function generateSpriteAndVtt({ inputPath, outputDir, durationSec }) {
  return new Promise((resolve) => {
    const spriteFilename = 'sprite.jpg';
    const vttFilename = 'thumbnails.vtt';
    const spritePath = path.join(outputDir, spriteFilename);
    const vttPath = path.join(outputDir, vttFilename);

    const thumbWidth = 160;
    const thumbHeight = 90;
    const intervalSec = Math.max(1, Math.min(10, Math.floor(durationSec / 25) || 2));
    const totalThumbs = Math.max(1, Math.floor(durationSec / intervalSec));
    const cols = Math.min(5, totalThumbs);
    const rows = Math.ceil(totalThumbs / cols);

    const fpsFraction = (1 / intervalSec).toFixed(4);
    const tileFilter = `fps=${fpsFraction},scale=${thumbWidth}:${thumbHeight},tile=${cols}x${rows}`;

    const args = [
      '-i', inputPath,
      '-vf', tileFilter,
      '-vframes', '1',
      '-q:v', '3',
      '-y',
      spritePath,
    ];

    const proc = spawn(FFMPEG_BIN, args);

    proc.on('close', code => {
      if (code !== 0 || !fs.existsSync(spritePath)) {
        console.warn('[Sprite] FFmpeg sprite generation completed with code:', code);
        return resolve({ spriteFilename: null, vttFilename: null });
      }

      // Generate WebVTT content mapping timestamp intervals to sprite xy offsets
      let vtt = 'WEBVTT\n\n';
      const pad = (n) => String(Math.floor(n)).padStart(2, '0');
      const formatTimeVtt = (s) => {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = Math.floor(s % 60);
        const ms = '000';
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${ms}`;
      };

      for (let i = 0; i < totalThumbs; i++) {
        const start = i * intervalSec;
        const end = Math.min(durationSec, (i + 1) * intervalSec);
        const x = (i % cols) * thumbWidth;
        const y = Math.floor(i / cols) * thumbHeight;

        vtt += `${formatTimeVtt(start)} --> ${formatTimeVtt(end)}\n`;
        vtt += `${spriteFilename}#xywh=${x},${y},${thumbWidth},${thumbHeight}\n\n`;
      }

      fs.writeFileSync(vttPath, vtt, 'utf8');

      resolve({
        spriteFilename,
        vttFilename,
      });
    });

    proc.on('error', () => {
      resolve({ spriteFilename: null, vttFilename: null });
    });
  });
}

/**
 * Concurrency-controlled Background Transcoding Queue
 */
class TranscodeQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.activeWorkers = 0;
    this.queue = [];
    this.isProcessing = false;
  }

  enqueue(jobId) {
    if (!this.queue.includes(jobId)) {
      this.queue.push(jobId);
    }
    this.processNext();
  }

  async processNext() {
    if (this.activeWorkers >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const jobId = this.queue.shift();
    this.activeWorkers++;

    try {
      await this.executeJob(jobId);
    } catch (err) {
      console.error(`[TranscodeQueue Error for ${jobId}]:`, err.message);
    } finally {
      this.activeWorkers--;
      this.processNext();
    }
  }

  async executeJob(jobId) {
    const job = await TranscodeJob.findOne({ jobId });
    if (!job) return;

    const video = await Video.findOne({ id: job.videoId });
    if (!video) {
      job.status = 'failed';
      job.errorMessage = 'Associated Video document not found.';
      await job.save();
      return;
    }

    try {
      job.status = 'processing';
      job.startedAt = new Date();
      job.attempts += 1;
      job.progress = 10;
      await job.save();

      if (video.processingStatus !== 'ready') {
        video.processingStatus = 'processing';
        video.processingProgress = 10;
        await video.save();
      }

      const videoOutputDir = path.join(HLS_ROOT, video.id);
      if (!fs.existsSync(videoOutputDir)) {
        fs.mkdirSync(videoOutputDir, { recursive: true, mode: 0o755 });
      }

      // Step 1: Probe input video
      const metadata = await probeVideo(job.sourcePath);
      job.progress = 25;
      await job.save();

      // Step 2: Determine target resolutions without upscaling
      // Only include tiers where height <= original height
      let selectedTiers = RESOLUTION_TIERS.filter(tier => tier.height <= metadata.height);

      // If video is smaller than our lowest standard tier (360p), transcode at its native resolution
      if (selectedTiers.length === 0) {
        selectedTiers = [{
          name: `${metadata.height}p`,
          height: metadata.height,
          bandwidth: Math.max(500000, metadata.bitrate || 600000),
          audioBitrate: '64k',
        }];
      }

      job.targetResolutions = selectedTiers.map(t => t.name);
      await job.save();

      // Step 3: Transcode each resolution
      const completedVariants = [];
      const progressPerTier = 50 / selectedTiers.length;

      for (let i = 0; i < selectedTiers.length; i++) {
        const tier = selectedTiers[i];
        const isNative = tier.height === metadata.height;
        const variant = await transcodeResolution({
          inputPath: job.sourcePath,
          outputDir: videoOutputDir,
          resolutionTier: tier,
          isNative,
        });

        completedVariants.push(variant);
        job.progress = Math.round(25 + (i + 1) * progressPerTier);
        await job.save();

        video.processingProgress = job.progress;
        await video.save();
      }

      // Step 4: Generate Master Playlist
      createMasterPlaylist(videoOutputDir, completedVariants, metadata.width, metadata.height);

      // Step 5: Generate Sprite Sheet & WebVTT
      const { spriteFilename, vttFilename } = await generateSpriteAndVtt({
        inputPath: job.sourcePath,
        outputDir: videoOutputDir,
        durationSec: metadata.duration,
      });

      // Step 6: Mark Ready
      const hlsBaseUrl = `/api/videos/${video.id}/hls`;
      video.hlsMasterPlaylist = `${hlsBaseUrl}/master.m3u8`;
      video.hlsQualities = completedVariants.map(v => v.name);
      if (spriteFilename) video.thumbnailSpriteUrl = `${hlsBaseUrl}/${spriteFilename}`;
      if (vttFilename) video.thumbnailVttUrl = `${hlsBaseUrl}/${vttFilename}`;
      video.resolution = `${metadata.height}p`;
      video.processingStatus = 'ready';
      video.processingProgress = 100;
      await video.save();

      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date();
      await job.save();

      console.log(`🎬 [Transcoding Complete] HLS generated for "${video.title}" (${video.id}) with [${job.targetResolutions.join(', ')}]`);
    } catch (err) {
      console.error(`❌ [Transcoding Failed] ${err.message}`);
      job.errorMessage = err.message;

      if (job.attempts < job.maxAttempts) {
        job.status = 'queued';
        await job.save();
        video.transcodingRetries = job.attempts;
        await video.save();
        // Re-enqueue for retry
        setTimeout(() => this.enqueue(job.jobId), 3000);
      } else {
        job.status = 'failed';
        await job.save();

        if (video.storagePath && video.videoUrl) {
          video.processingStatus = 'ready';
          video.processingProgress = 100;
          video.processingError = `HLS: ${err.message}`;
        } else {
          video.processingStatus = 'failed';
          video.processingError = err.message;
        }
        await video.save();
      }
    }
  }

  // Crash recovery: check for interrupted jobs on startup
  async recoverInterruptedJobs() {
    try {
      const interrupted = await TranscodeJob.find({
        status: { $in: ['processing', 'queued'] },
      });

      for (const job of interrupted) {
        console.log(`[TranscodeQueue] Recovering interrupted job ${job.jobId} for video ${job.videoId}`);
        this.enqueue(job.jobId);
      }
    } catch (err) {
      console.warn('[TranscodeQueue Recovery Warning]:', err.message);
    }
  }
}

const transcodeQueue = new TranscodeQueue(2);

module.exports = {
  probeVideo,
  transcodeResolution,
  createMasterPlaylist,
  generateSpriteAndVtt,
  transcodeQueue,
  HLS_ROOT,
  RESOLUTION_TIERS,
};

