/**
 * VideoVerse — Backend API Server
 *
 * Stack: Node.js + Express + MongoDB (Mongoose)
 *
 * Routes:
 *   GET /api/health          → server status check
 *   GET /api/videos          → list all videos (supports ?category=, ?q=, ?sort=trending)
 *   GET /api/videos/:id      → single video by ID + recommendations
 *   GET /api/categories      → list of available categories (static)
 *   GET /api/channels        → all channel profiles (static)
 */

require('dotenv').config();

const http         = require('http');
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const mongoose     = require('mongoose');
const { Server: SocketIOServer } = require('socket.io');
const connectDB    = require('./config/db');   // MongoDB connection helper
const { assertEnv, validateEnv } = require('./config/validateEnv');
const Video        = require('./models/Video'); // Mongoose model
const User         = require('./models/User');  // User model
const { requireAuth, requireRole } = require('./middleware/auth');
const authRoutes   = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const downloadRoutes = require('./routes/downloads');
const paymentRoutes = require('./routes/payments');
const callRoutes    = require('./routes/calls');
const uploadRoutes  = require('./routes/upload');
const adminRoutes   = require('./routes/admin');
const { cleanupAbandonedUploads } = require('./utils/uploadCleanup');
const { initSignaling } = require('./socket/signaling');

// ── Static data (not yet migrated to DB) ──────────────────────────────────────
// Categories and channels are still served from the local file.
// Only video reads have been moved to MongoDB in this milestone.
const { MOCK_CHANNELS, CATEGORIES } = require('./data/videos');

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;

// Configure safe reverse proxy trust (do not blindly trust arbitrary forwarded headers)
// If TRUST_PROXY is 'true', trust 1 upstream hop (e.g., Nginx, Cloudflare)
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// ── Middleware ────────────────────────────────────────────────────────────────

// ── Helmet: HTTP security headers ────────────────────────────────────────────
// Applied before CORS and all routes so every response is covered.
//
// contentSecurityPolicy is DISABLED intentionally:
//   The React frontend loads video streams and thumbnails from multiple
//   external CDNs (Unsplash, vjs.zencdn.net, MDN, W3Schools, Sintel, etc.).
//   Helmet's default CSP blocks any source not explicitly allow-listed,
//   which would immediately break all media playback and thumbnail display.
//   CSP for this application must be defined at the Vercel (frontend) layer,
//   not here on the API server.
//
// All other Helmet protections are left at their secure defaults:
//   - X-Frame-Options: SAMEORIGIN
//   - X-Content-Type-Options: nosniff
//   - Strict-Transport-Security (HSTS): max-age=15552000; includeSubDomains
//   - X-DNS-Prefetch-Control: off
//   - X-Download-Options: noopen
//   - X-Permitted-Cross-Domain-Policies: none
//   - Referrer-Policy: no-referrer
//   - Cross-Origin-Opener-Policy: same-origin
//   - Cross-Origin-Resource-Policy: same-origin
//   - Origin-Agent-Cluster: ?1
//   - X-XSS-Protection: 0 (intentionally removed per modern best practices)
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Build list of allowed origins (always include local dev servers)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
];

if (process.env.CLIENT_URL) {
  process.env.CLIENT_URL.split(',').forEach((url) => {
    const trimmed = url.trim().replace(/\/$/, '');
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

// CORS: allow Vite dev servers and production frontend URL (CLIENT_URL)
// credentials: true allows HTTP-only auth cookies to be received and set
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server, curl, health checks, or mobile clients with no origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development mode, allow local Wi-Fi / LAN IPs (e.g. testing on mobile device)
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));

// ── Initialize Socket.IO Signaling Server ────────────────────────────────────
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

initSignaling(io);

// Parse incoming JSON request bodies (preserve rawBody for signature verification e.g. webhooks)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Parse incoming cookies (needed for HTTP-only JWT auth)
app.use(cookieParser());

// ── Mount Authentication Routes ──────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Mount Comment Routes ─────────────────────────────────────────────────────
app.use('/api', commentRoutes);

// ── Mount Controlled Download Routes ─────────────────────────────────────────
app.use('/api', downloadRoutes);

// ── Mount Payment Routes (Task 3: Razorpay Subscriptions) ────────────────────
app.use('/api', paymentRoutes);

// ── Mount Video Call Routes (Phase 6.3.1: Dynamic TURN Credentials) ──────────
app.use('/api/calls', callRoutes);

// ── Mount Video Upload Routes (Phase 5 Module 4) ─────────────────────────────
app.use('/api/upload', uploadRoutes);

// ── Mount Admin Moderation, Analytics & Management Routes (Phase 2 Step 6) ───
app.use('/api/admin', adminRoutes);

// Static serving for generated video thumbnails
app.use('/uploads/thumbnails', express.static(path.join(__dirname, 'uploads/thumbnails')));

// ── Helper: parse view strings like "1.2M" → 1200000 ─────────────────────────
// Used for in-process trending sort because views are stored as display strings.
function parseViews(v) {
  if (!v) return 0;
  if (v.endsWith('M')) return parseFloat(v) * 1_000_000;
  if (v.endsWith('K')) return parseFloat(v) * 1_000;
  return parseInt(v, 10) || 0;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 *
 * Database-aware health-check endpoint.
 * Returns HTTP 200 when application & database are healthy.
 * Returns HTTP 503 when the database connection is down or disconnected.
 *
 * Example response (healthy):
 *   {
 *     "status": "ok",
 *     "database": "connected",
 *     "uptime": 124.5,
 *     "environment": "development",
 *     "timestamp": "2026-11-15T13:40:00.000Z",
 *     "version": "1.0.0"
 *   }
 */
// Database readyState resolver: allows testing/monitoring without modifying native connection getters
function getDbReadyState() {
  if (app.locals.dbReadyStateOverride !== undefined) {
    return app.locals.dbReadyStateOverride;
  }
  return mongoose.connection ? mongoose.connection.readyState : 0;
}

app.get('/api/health', (req, res) => {
  const readyState = getDbReadyState();
  // readyState values: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  const dbStatus = dbStatusMap[readyState] || 'unknown';
  const isHealthy = readyState === 1;

  const payload = {
    status: isHealthy ? 'ok' : 'degraded',
    database: dbStatus,
    uptime: Math.round(process.uptime() * 10) / 10,
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };

  if (!isHealthy) {
    return res.status(503).json(payload);
  }

  return res.status(200).json(payload);
});

/**
 * GET /api/videos
 *
 * Returns videos from MongoDB.
 * Supports optional query parameters:
 *   ?category=Gaming          → filter by category (case-insensitive)
 *   ?q=python                 → search by title, channel name, category, or tags
 *   ?sort=trending            → sort by views descending
 *
 * Example response:
 *   { "total": 72, "videos": [...] }
 */
app.get('/api/videos', async (req, res) => {
  try {
    // ── Build MongoDB filter object ─────────────────────────────────────────
    // Only return ready videos (or catalog videos without processingStatus) and published content
    const filter = {
      processingStatus: { $in: ['ready', null, undefined] },
      isPublished: { $ne: false },
      isRemovedByAdmin: { $ne: true },
    };

    // Category filter (case-insensitive allowlist, skip when "all" or absent)
    const category = req.query.category;
    if (category !== undefined) {
      if (typeof category !== 'string') {
        return res.status(400).json({ error: 'Invalid category' });
      }
      const trimmedCategory = category.trim();
      if (trimmedCategory && trimmedCategory.toLowerCase() !== 'all') {
        const matchedCategory = CATEGORIES.find(
          c => c.toLowerCase() === trimmedCategory.toLowerCase()
        );
        if (!matchedCategory) {
          return res.status(400).json({ error: 'Invalid category' });
        }
        if (matchedCategory.toLowerCase() === 'trending') {
          // 'Trending' is a frontend sort/filter option, not a database category
          req.query.sort = 'trending';
        } else {
          filter.category = { $regex: new RegExp(`^${matchedCategory}$`, 'i') };
        }
      }
    }

    // Full-text search across title, channel name, category, and tags
    const q = req.query.q;
    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex chars
      const re = { $regex: new RegExp(escaped, 'i') };
      filter.$or = [
        { title:        re },
        { 'channel.name': re },
        { category:     re },
        { tags:         re },
      ];
    }

    // ── Query MongoDB ───────────────────────────────────────────────────────
    let videos = await Video.find(filter).lean();
    // .lean() returns plain JS objects instead of Mongoose Documents,
    // which is faster and matches the shape the frontend already expects.

    // ── Trending sort (done in JS because views are stored as strings) ──────
    if (req.query.sort === 'trending') {
      videos = videos.sort((a, b) => parseViews(b.views) - parseViews(a.views));
    }

    res.json({
      total: videos.length,
      videos,
    });
  } catch (err) {
    console.error('[/api/videos] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * GET /api/videos/:id
 *
 * Returns a single video by its human-readable ID (e.g. "vid-001").
 * Also returns recommended videos: same category first, padded with popular
 * videos from other categories if fewer than 5 same-category results exist.
 *
 * Example response:
 *   { "video": {...}, "recommendations": [...] }
 */
app.get('/api/videos/:id', async (req, res) => {
  try {
    // Find the video by the string "id" field (not MongoDB's _id)
    const video = await Video.findOne({ id: req.params.id }).lean();

    if (!video) {
      return res.status(404).json({
        error: 'Video not found',
        id: req.params.id,
      });
    }

    // Isolate in-flight, failed, unpublished, or admin-removed videos from unauthorized public view
    const isReady = (video.processingStatus === 'ready' || !video.processingStatus) &&
      video.isPublished !== false &&
      video.isRemovedByAdmin !== true;

    if (!isReady) {
      const authHeader = req.headers.authorization;
      const token = req.cookies?.vv_token || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
      let canAccess = false;
      if (token) {
        try {
          const jwtSecret = process.env.JWT_SECRET || 'test_jwt_secret_must_be_32_chars_long!';
          const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
          const requestingUser = await User.findById(decoded.id);
          if (requestingUser) {
            if (requestingUser.role === 'admin') canAccess = true;
            if (video.uploaderId && decoded.id === video.uploaderId.toString()) canAccess = true;
          }
        } catch {}
      }

      if (!canAccess) {
        return res.status(404).json({
          error: 'Video not found or unavailable',
          id: req.params.id,
        });
      }
    }

    // ── Recommendations: same category, excluding current video, max 10 ────
    let recommendations = await Video.find({
      id:       { $ne: video.id },
      category: video.category,
      processingStatus: { $in: ['ready', null, undefined] },
      isPublished: { $ne: false },
      isRemovedByAdmin: { $ne: true },
    }).limit(10).lean();

    // Pad with popular videos from other categories if fewer than 5 results
    if (recommendations.length < 5) {
      const extraNeeded = 10 - recommendations.length;
      const extraIds    = recommendations.map(v => v.id).concat(video.id);

      const extra = await Video.find({
        id:       { $nin: extraIds },
        category: { $ne: video.category },
        processingStatus: { $in: ['ready', null, undefined] },
        isPublished: { $ne: false },
        isRemovedByAdmin: { $ne: true },
      }).lean();

      // Sort the extras by views descending (same logic as the trending sort)
      extra.sort((a, b) => parseViews(b.views) - parseViews(a.views));
      recommendations.push(...extra.slice(0, extraNeeded));
    }

    res.json({ video, recommendations });
  } catch (err) {
    console.error(`[/api/videos/${req.params.id}] Error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

/**
 * GET /api/videos/:id/stream
 *
 * Dedicated video streaming endpoint strictly keyed to the database video ID.
 * Features:
 * - Direct lookup by database ID (returns 404 if not found or missing videoUrl)
 * - Full HTTP Range requests (206 Partial Content) support for timeline scrubbing and seeking
 * - Accept-Ranges: bytes, Content-Range, Content-Length, Content-Type: video/mp4
 * - Client disconnect cleanup via AbortController
 */
app.get('/api/videos/:id/stream', async (req, res) => {
  try {
    const video = await Video.findOne({ id: req.params.id }).lean();
    if (!video) {
      return res.status(404).json({ error: 'Video not found', id: req.params.id });
    }

    if (!video.videoUrl && !video.storagePath) {
      return res.status(404).json({ error: 'Video media source not found', id: req.params.id });
    }

    // ── Local Uploaded Video Streaming (Range 206 / Full 200) ────────────────
    if (video.storagePath && fs.existsSync(video.storagePath)) {
      // Path traversal security: enforce storage path strictly inside uploads/videos
      const allowedVideosDir = path.resolve(__dirname, 'uploads/videos');
      const resolvedStoragePath = path.resolve(video.storagePath);
      // Use path.relative for robust containment check
      const relPath = path.relative(allowedVideosDir, resolvedStoragePath);
      if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
        return res.status(403).json({ error: 'Access denied: Invalid video storage path.' });
      }


      const stat = fs.statSync(resolvedStoragePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const contentType = video.mimeType || (video.storagePath.endsWith('.webm') ? 'video/webm' : 'video/mp4');

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          return res.status(416).json({ error: 'Requested range not satisfiable' });
        }

        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(video.storagePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        return fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        return fs.createReadStream(video.storagePath).pipe(res);
      }
    }

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const upstreamHeaders = {};
    if (req.headers.range) {
      upstreamHeaders.range = req.headers.range;
    }

    let upstreamRes;
    try {
      upstreamRes = await fetch(video.videoUrl, {
        headers: upstreamHeaders,
        signal: abortController.signal,
      });
    } catch (err) {
      console.warn(`[Video Stream] Origin fetch failed for ${video.id}:`, err.message);
      return res.status(502).json({
        error: 'Video source origin unreachable',
        id: video.id,
        details: err.message,
      });
    }

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return res.status(upstreamRes.status).json({
        error: 'Video origin returned error',
        status: upstreamRes.status,
      });
    }

    res.status(upstreamRes.status);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }

    const { Readable } = require('stream');
    const nodeStream = Readable.fromWeb(upstreamRes.body);
    nodeStream.pipe(res);

    nodeStream.on('error', (err) => {
      console.warn(`[Video Stream Error for ${video.id}]:`, err.message);
    });
  } catch (err) {
    console.error(`[/api/videos/${req.params.id}/stream] Error:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream video' });
    }
  }
});

/**
 * ── Adaptive HLS Delivery & Security (Phase 2 Step 4) ────────────────────────
 *
 * GET /api/videos/:id/hls/:file
 *
 * Serves master.m3u8, variant resolution playlists (1080p.m3u8, 720p.m3u8, etc.),
 * .ts media segment files, thumbnails.vtt, and sprite.jpg.
 *
 * Security:
 * - Prevents path traversal (strictly verifies path stays within HLS_ROOT/<videoId>)
 * - Rejects non-existent or unready video streams
 * - Appropriate MIME types (application/vnd.apple.mpegurl, video/mp2t, text/vtt, image/jpeg)
 * - Cache-Control: max-age=86400 for immutable segments, no-cache for master/variant playlists
 */
app.get('/api/videos/:id/hls/:file', async (req, res) => {
  try {
    const { id, file } = req.params;

    // Strict filename format validation: prevent directory traversal or invalid characters
    if (!file || !/^[a-zA-Z0-9_\-.]+\.(m3u8|ts|vtt|jpg)$/i.test(file)) {
      return res.status(400).json({ error: 'Invalid HLS file request.' });
    }

    const video = await Video.findOne({ id }).lean();
    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    const { HLS_ROOT } = require('./utils/hlsTranscoder');
    const videoHlsDir = path.resolve(HLS_ROOT, id);
    const targetFile = path.resolve(videoHlsDir, file);

    // Path containment guard: Must reside strictly inside the video's HLS directory
    if (!targetFile.startsWith(videoHlsDir + path.sep)) {
      return res.status(403).json({ error: 'Access denied: Path traversal detected.' });
    }

    if (!fs.existsSync(targetFile)) {
      return res.status(404).json({ error: 'HLS segment or playlist not found.' });
    }

    const ext = path.extname(file).toLowerCase();
    if (ext === '.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (ext === '.ts') {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    } else if (ext === '.vtt') {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (ext === '.jpg') {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }

    return fs.createReadStream(targetFile).pipe(res);
  } catch (err) {
    console.error(`[HLS Delivery Error for ${req.params.id}]:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve HLS resource.' });
    }
  }
});

/**
 * GET /api/categories
 *
 * Returns the list of available categories (static — not yet in DB).
 */
app.get('/api/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

/**
 * GET /api/channels
 *
 * Returns all channel profiles (static — not yet in DB).
 */
app.get('/api/channels', (req, res) => {
  res.json({ channels: MOCK_CHANNELS });
});

// ── 404 handler (for unknown routes) ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    hint: 'Available routes: GET /api/health, GET /api/videos, GET /api/videos/:id, GET /api/videos/:videoId/comments, POST /api/videos/:videoId/comments, PUT /api/comments/:commentId/like, GET /api/categories, GET /api/channels, /api/auth/*, /api/downloads/*, POST /api/payments/create-order, POST /api/payments/verify, GET /api/payments/history',
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// If any route throws an unexpected error, this catches it.
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// ── Graceful Server Shutdown ──────────────────────────────────────────────────
let isShuttingDown = false;

function gracefulShutdown(signal, callback) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal || 'SHUTDOWN'}. Shutting down gracefully...`);

  const done = (err) => {
    if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
      console.error('[Server] Error during shutdown:', err.message);
      if (typeof callback === 'function') return callback(err);
      process.exit(1);
    }
    console.log('[Server] HTTP and signaling servers closed cleanly.');
    if (typeof callback === 'function') return callback(null);
    process.exit(0);
  };

  // In Socket.IO v4, io.close() closes its attached HTTP server.
  // We use one safe path to avoid redundant server.close() errors.
  if (io) {
    try {
      io.close((err) => {
        done(err);
      });
    } catch (err) {
      done(err);
    }
  } else if (server && server.listening) {
    server.close(done);
  } else {
    done(null);
  }

  // Force close after 5 seconds if connections fail to drain
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out. Forcing process exit.');
    if (typeof callback === 'function') return callback(new Error('Shutdown timed out'));
    process.exit(1);
  }, 5000).unref();
}

// ── Connect to MongoDB, then start listening ──────────────────────────────────
// The server validates its environment and connects to DB before opening its port.
// If either fails, the process exits cleanly with code 1.
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  try {
    assertEnv();
  } catch (configErr) {
    console.error(configErr.message);
    process.exit(1);
  }

  connectDB()
    .then(() => {
      // Run unified background cleanup worker (orphaned chunks, stale watermarked files, expired reservations)
      const { startCleanupWorker } = require('./utils/cleanupWorker');
      startCleanupWorker(30 * 60 * 1000);

      // Recover any interrupted background transcoding jobs
      const { transcodeQueue } = require('./utils/hlsTranscoder');
      transcodeQueue.recoverInterruptedJobs().catch(err => console.warn('[TranscodeRecovery] Startup recovery check failed:', err.message));

      server.listen(PORT, () => {
        console.log(`\n🚀 VideoVerse API & Signaling running at http://localhost:${PORT}`);
        console.log(`   Health check : http://localhost:${PORT}/api/health`);
        console.log(`   Videos list  : http://localhost:${PORT}/api/videos`);
        console.log(`   Single video : http://localhost:${PORT}/api/videos/vid-001`);
        console.log(`   Socket.IO    : Enabled (WebRTC Signaling Gateway)`);
        console.log(`\n   Press Ctrl+C to stop.\n`);
      });
    })
    .catch((err) => {
      console.error('❌ Failed to connect to MongoDB. Server will not start.', err.message);
      process.exit(1);
    });
}

module.exports = { app, server, io, gracefulShutdown };
