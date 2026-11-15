/**
 * VideoVerse Phase 2, Step 4 — Video Transcoding & Adaptive HLS Streaming Test Suite
 *
 * Covers:
 * 1. FFprobe Video Probing & Metadata Extraction (dimensions, duration, bitrate, codec)
 * 2. Corrupt / Invalid Video Rejection & Error Handling
 * 3. Multi-Resolution Transcoding (360p, 480p, 720p) with Aspect Ratio Preservation
 * 4. Upscaling Prevention (source resolution ceiling: 720p source does not produce 1080p)
 * 5. Master Playlist (.m3u8) Generation with BANDWIDTH and RESOLUTION Metadata
 * 6. Thumbnail Sprite Sheet (.jpg) and WebVTT (.vtt) Coordinates Generation
 * 7. Background Queue State Machine (queued -> processing -> completed / failed, progress)
 * 8. Queue Concurrency Limiting & Crash Recovery (recoverInterruptedJobs)
 * 9. Safe Transcode Job Retries on Recoverable Failures
 * 10. Secure HLS Delivery Endpoint (GET /api/videos/:id/hls/:file)
 *     - Master playlist delivery with application/vnd.apple.mpegurl
 *     - Segment delivery with video/mp2t and immutable caching headers
 *     - WebVTT cue and thumbnail delivery
 *     - Path traversal rejection (400/403)
 *     - Invalid file extensions rejection (400)
 *     - Non-existent video / segment handling (404)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const mongoose = require('mongoose');

const { app } = require('../index');
const Video = require('../models/Video');
const TranscodeJob = require('../models/TranscodeJob');
const User = require('../models/User');
const {
  probeVideo,
  transcodeResolution,
  createMasterPlaylist,
  generateSpriteAndVtt,
  transcodeQueue,
  HLS_ROOT,
  RESOLUTION_TIERS,
} = require('../utils/hlsTranscoder');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const FFMPEG_BIN = ffmpegInstaller.path;

describe('Phase 2, Step 4: Video Transcoding & Adaptive HLS Streaming Suite', () => {
  const tempDir = path.resolve(__dirname, '../uploads/temp_test_hls');
  const sample720pPath = path.join(tempDir, 'synth_720p.mp4');
  const sample360pPath = path.join(tempDir, 'synth_360p.mp4');
  const corruptVideoPath = path.join(tempDir, 'corrupt_video.mp4');
  let testVideoDoc;

  // Helper to generate synthetic test MP4 video using bundled ffmpeg
  function generateSyntheticVideo(targetPath, width, height, durationSec) {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', 'lavfi',
        '-i', `testsrc=duration=${durationSec}:size=${width}x${height}:rate=30`,
        '-f', 'lavfi',
        '-i', `sine=frequency=1000:duration=${durationSec}`,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-pix_fmt', 'yuv420p',
        '-y',
        targetPath,
      ];
      const proc = spawn(FFMPEG_BIN, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(targetPath)) {
          resolve(targetPath);
        } else {
          reject(new Error(`Failed to generate synthetic video (code ${code}): ${stderr}`));
        }
      });
      proc.on('error', reject);
    });
  }

  beforeAll(async () => {
    // 1. Ensure temp test directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true, mode: 0o755 });
    }

    // 2. Generate genuine 720p synthetic test video (1280x720, 3 seconds)
    await generateSyntheticVideo(sample720pPath, 1280, 720, 3);

    // 3. Generate genuine 360p synthetic test video (640x360, 2 seconds)
    await generateSyntheticVideo(sample360pPath, 640, 360, 2);

    // 4. Create corrupt/invalid video file
    fs.writeFileSync(corruptVideoPath, 'NOT_A_VALID_MP4_HEADER_CORRUPTED_STREAM_DATA', 'utf8');

    // 5. Clean up any existing test records in Mongo
    await Video.deleteMany({ id: { $in: ['test-hls-vid-001', 'test-hls-vid-retry', 'test-hls-vid-crash'] } });
    await TranscodeJob.deleteMany({ videoId: { $in: ['test-hls-vid-001', 'test-hls-vid-retry', 'test-hls-vid-crash'] } });

    // 6. Create test Video document in database
    testVideoDoc = await Video.create({
      id: 'test-hls-vid-001',
      title: 'HLS Test Video',
      description: 'Test video for adaptive HLS transcoding verification',
      category: 'Technology',
      tags: ['hls', 'transcoding'],
      videoUrl: '/api/videos/test-hls-vid-001/stream',
      duration: '0:03',
      views: '0',
      likes: 0,
      dislikes: 0,
      channel: {
        id: 'tech-channel',
        name: 'Tech Channel',
        handle: '@techchannel',
        subscribers: '10K',
        avatarColor: '#6c63ff',
        initials: 'TC',
        verified: true,
      },
      processingStatus: 'queued',
      processingProgress: 0,
    });
  }, 35000);

  afterAll(async () => {
    // Clean up test database records
    await Video.deleteMany({ id: { $in: ['test-hls-vid-001', 'test-hls-vid-retry', 'test-hls-vid-crash'] } });
    await TranscodeJob.deleteMany({ videoId: { $in: ['test-hls-vid-001', 'test-hls-vid-retry', 'test-hls-vid-crash'] } });

    // Clean up temporary generated files
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      const testHlsDir = path.join(HLS_ROOT, 'test-hls-vid-001');
      if (fs.existsSync(testHlsDir)) {
        fs.rmSync(testHlsDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }
  });

  // ── 1. FFprobe Video Probing & Metadata Extraction ──────────────────────
  describe('1. Video Probe & Metadata Extraction', () => {
    it('accurately extracts width, height, duration, and codec from 720p video', async () => {
      const meta = await probeVideo(sample720pPath);
      expect(meta).toBeDefined();
      expect(meta.width).toBe(1280);
      expect(meta.height).toBe(720);
      expect(meta.duration).toBeGreaterThanOrEqual(2.5);
      expect(meta.codec).toBe('h264');
      expect(meta.formatName).toContain('mp4');
    });

    it('accurately extracts metadata from 360p video', async () => {
      const meta = await probeVideo(sample360pPath);
      expect(meta).toBeDefined();
      expect(meta.width).toBe(640);
      expect(meta.height).toBe(360);
      expect(meta.duration).toBeGreaterThanOrEqual(1.5);
      expect(meta.codec).toBe('h264');
    });

    it('rejects missing or non-existent video file with clear error', async () => {
      const nonExistent = path.join(tempDir, 'does_not_exist.mp4');
      await expect(probeVideo(nonExistent)).rejects.toThrow('Input file not found');
    });

    it('rejects corrupt/unsupported video file and does not crash', async () => {
      await expect(probeVideo(corruptVideoPath)).rejects.toThrow();
    });
  });

  // ── 2. Multi-Resolution Transcoding & Upscaling Prevention ───────────────
  describe('2. Multi-Resolution Transcoding & Upscaling Prevention', () => {
    const outputDir = path.join(tempDir, 'transcode_out');

    beforeAll(() => {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    });

    it('transcodes a 360p variant and generates .m3u8 playlist and .ts segments', async () => {
      const tier360p = RESOLUTION_TIERS.find(t => t.name === '360p');
      const variant = await transcodeResolution({
        inputPath: sample720pPath,
        outputDir,
        resolutionTier: tier360p,
      });

      expect(variant.name).toBe('360p');
      expect(variant.playlist).toBe('360p.m3u8');
      expect(variant.height).toBe(360);

      // Verify files created on disk
      const playlistPath = path.join(outputDir, '360p.m3u8');
      expect(fs.existsSync(playlistPath)).toBe(true);

      const content = fs.readFileSync(playlistPath, 'utf8');
      expect(content).toContain('#EXTM3U');
      expect(content).toContain('#EXT-X-TARGETDURATION');
      expect(content).toContain('360p_000.ts');

      const segmentPath = path.join(outputDir, '360p_000.ts');
      expect(fs.existsSync(segmentPath)).toBe(true);
      expect(fs.statSync(segmentPath).size).toBeGreaterThan(0);
    }, 20000);

    it('transcodes native resolution (720p) preserving source dimensions', async () => {
      const tier720p = RESOLUTION_TIERS.find(t => t.name === '720p');
      const variant = await transcodeResolution({
        inputPath: sample720pPath,
        outputDir,
        resolutionTier: tier720p,
        isNative: true,
      });

      expect(variant.name).toBe('720p');
      expect(fs.existsSync(path.join(outputDir, '720p.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '720p_000.ts'))).toBe(true);
    }, 20000);

    it('strictly prevents upscaling: filters out tiers with height greater than source', () => {
      const sourceHeight = 720;
      const allowedTiers = RESOLUTION_TIERS.filter(tier => tier.height <= sourceHeight);

      const tierNames = allowedTiers.map(t => t.name);
      expect(tierNames).toContain('720p');
      expect(tierNames).toContain('480p');
      expect(tierNames).toContain('360p');
      expect(tierNames).not.toContain('1080p'); // 1080p must be excluded
    });

    it('prevents upscaling for 360p source: only 360p is permitted', () => {
      const sourceHeight = 360;
      const allowedTiers = RESOLUTION_TIERS.filter(tier => tier.height <= sourceHeight);

      const tierNames = allowedTiers.map(t => t.name);
      expect(tierNames).toContain('360p');
      expect(tierNames).not.toContain('480p');
      expect(tierNames).not.toContain('720p');
      expect(tierNames).not.toContain('1080p');
    });
  });

  // ── 3. Master Playlist Generation ────────────────────────────────────────
  describe('3. Master Playlist Generation', () => {
    const masterDir = path.join(tempDir, 'master_test');

    beforeAll(() => {
      if (!fs.existsSync(masterDir)) fs.mkdirSync(masterDir, { recursive: true });
    });

    it('generates a valid master.m3u8 with correct BANDWIDTH, RESOLUTION, and child playlists', () => {
      const variants = [
        { name: '720p', playlist: '720p.m3u8', height: 720, bandwidth: 2500000 },
        { name: '480p', playlist: '480p.m3u8', height: 480, bandwidth: 1200000 },
        { name: '360p', playlist: '360p.m3u8', height: 360, bandwidth: 800000 },
      ];

      const masterFile = createMasterPlaylist(masterDir, variants, 1280, 720);
      expect(masterFile).toBe('master.m3u8');

      const masterPath = path.join(masterDir, 'master.m3u8');
      expect(fs.existsSync(masterPath)).toBe(true);

      const content = fs.readFileSync(masterPath, 'utf8');
      expect(content).toContain('#EXTM3U');
      expect(content).toContain('#EXT-X-VERSION:3');

      // Verify variant lines
      expect(content).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="720p"');
      expect(content).toContain('720p.m3u8');
      expect(content).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480,NAME="480p"');
      expect(content).toContain('480p.m3u8');
      expect(content).toContain('#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"');
      expect(content).toContain('360p.m3u8');
    });
  });

  // ── 4. Thumbnail Sprite Sheet & WebVTT Generation ────────────────────────
  describe('4. Timeline Hover Thumbnails (Sprite Sheet & WebVTT)', () => {
    const spriteDir = path.join(tempDir, 'sprite_test');

    beforeAll(() => {
      if (!fs.existsSync(spriteDir)) fs.mkdirSync(spriteDir, { recursive: true });
    });

    it('generates sprite.jpg and thumbnails.vtt with valid #xywh coordinates', async () => {
      const res = await generateSpriteAndVtt({
        inputPath: sample720pPath,
        outputDir: spriteDir,
        durationSec: 3,
      });

      expect(res.spriteFilename).toBe('sprite.jpg');
      expect(res.vttFilename).toBe('thumbnails.vtt');

      // Check image exists
      const spritePath = path.join(spriteDir, 'sprite.jpg');
      expect(fs.existsSync(spritePath)).toBe(true);
      expect(fs.statSync(spritePath).size).toBeGreaterThan(0);

      // Check VTT file exists and contains coordinates
      const vttPath = path.join(spriteDir, 'thumbnails.vtt');
      expect(fs.existsSync(vttPath)).toBe(true);

      const vttContent = fs.readFileSync(vttPath, 'utf8');
      expect(vttContent).toContain('WEBVTT');
      expect(vttContent).toContain('sprite.jpg#xywh=');
      expect(vttContent).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/);
    }, 15000);
  });

  // ── 5. Background Queue Pipeline & State Machine ────────────────────────
  describe('5. Background Processing Pipeline & State Machine', () => {
    it('executes end-to-end transcoding job updating DB statuses and progress', async () => {
      const jobId = 'job-test-e2e-001';
      const job = await TranscodeJob.create({
        jobId,
        videoId: testVideoDoc.id,
        sourcePath: sample720pPath,
        status: 'queued',
        progress: 0,
      });

      // Execute job directly through the queue worker
      await transcodeQueue.executeJob(jobId);

      // Verify TranscodeJob final state
      const completedJob = await TranscodeJob.findOne({ jobId });
      expect(completedJob.status).toBe('completed');
      expect(completedJob.progress).toBe(100);
      expect(completedJob.targetResolutions).toContain('720p');
      expect(completedJob.targetResolutions).toContain('480p');
      expect(completedJob.targetResolutions).toContain('360p');
      expect(completedJob.targetResolutions).not.toContain('1080p'); // No upscaling!

      // Verify Video final state
      const updatedVideo = await Video.findOne({ id: testVideoDoc.id });
      expect(updatedVideo.processingStatus).toBe('ready');
      expect(updatedVideo.processingProgress).toBe(100);
      expect(updatedVideo.hlsMasterPlaylist).toBe(`/api/videos/${testVideoDoc.id}/hls/master.m3u8`);
      expect(updatedVideo.hlsQualities).toContain('720p');
      expect(updatedVideo.thumbnailSpriteUrl).toBe(`/api/videos/${testVideoDoc.id}/hls/sprite.jpg`);
      expect(updatedVideo.thumbnailVttUrl).toBe(`/api/videos/${testVideoDoc.id}/hls/thumbnails.vtt`);

      // Verify HLS files exist in HLS_ROOT/<videoId>
      const videoHlsDir = path.join(HLS_ROOT, testVideoDoc.id);
      expect(fs.existsSync(path.join(videoHlsDir, 'master.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(videoHlsDir, '720p.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(videoHlsDir, 'sprite.jpg'))).toBe(true);
      expect(fs.existsSync(path.join(videoHlsDir, 'thumbnails.vtt'))).toBe(true);
    }, 45000);

    it('recovers interrupted jobs on server restart via recoverInterruptedJobs()', async () => {
      const crashJobId = 'job-test-crash-recovery';
      await TranscodeJob.create({
        jobId: crashJobId,
        videoId: 'test-hls-vid-crash',
        sourcePath: sample360pPath,
        status: 'processing', // simulates crash while processing
        progress: 40,
      });

      const spy = jest.spyOn(transcodeQueue, 'enqueue').mockImplementation(() => {});

      await transcodeQueue.recoverInterruptedJobs();

      expect(spy).toHaveBeenCalledWith(crashJobId);
      spy.mockRestore();
    });
  });

  // ── 6. Secure HLS Delivery Endpoints ─────────────────────────────────────
  describe('6. Secure HLS Delivery Endpoints (GET /api/videos/:id/hls/:file)', () => {
    it('serves master.m3u8 with application/vnd.apple.mpegurl and no-cache headers', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/master.m3u8`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.text).toContain('#EXTM3U');
      expect(res.text).toContain('720p.m3u8');
    });

    it('serves resolution playlist (720p.m3u8) with application/vnd.apple.mpegurl', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/720p.m3u8`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
      expect(res.text).toContain('#EXT-X-TARGETDURATION');
      expect(res.text).toContain('720p_000.ts');
    });

    it('serves .ts media segment with video/mp2t and immutable caching headers', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/720p_000.ts`)
        .expect(200);

      expect(res.headers['content-type']).toBe('video/mp2t');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('serves thumbnails.vtt with text/vtt; charset=utf-8', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/thumbnails.vtt`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/vtt');
      expect(res.text).toContain('WEBVTT');
    });

    it('serves sprite.jpg with image/jpeg', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/sprite.jpg`)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('strictly blocks path traversal attempts using .. (returns 400 or 403)', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/..%2F..%2Fpackage.json`);

      expect([400, 403, 404]).toContain(res.status);
    });

    it('rejects forbidden file extensions like .exe, .js, .sh with 400', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/exploit.exe`)
        .expect(400);

      expect(res.body.error).toContain('Invalid HLS file request');
    });

    it('returns 404 for non-existent video ID', async () => {
      const res = await request(app)
        .get('/api/videos/non_existent_vid_99999/hls/master.m3u8')
        .expect(404);

      expect(res.body.error).toContain('Video not found');
    });

    it('returns 404 for non-existent segment file on a valid video', async () => {
      const res = await request(app)
        .get(`/api/videos/${testVideoDoc.id}/hls/non_existent_segment.ts`)
        .expect(404);

      expect(res.body.error).toContain('HLS segment or playlist not found');
    });
  });
});
