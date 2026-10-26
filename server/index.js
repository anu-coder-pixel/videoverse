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

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const connectDB    = require('./config/db');   // MongoDB connection helper
const Video        = require('./models/Video'); // Mongoose model
const authRoutes   = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const downloadRoutes = require('./routes/downloads');
const paymentRoutes = require('./routes/payments');

// ── Static data (not yet migrated to DB) ──────────────────────────────────────
// Categories and channels are still served from the local file.
// Only video reads have been moved to MongoDB in this milestone.
const { MOCK_CHANNELS, CATEGORIES } = require('./data/videos');

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

// Configure safe reverse proxy trust (do not blindly trust arbitrary forwarded headers)
// If TRUST_PROXY is 'true', trust 1 upstream hop (e.g., Nginx, Cloudflare)
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// ── Middleware ────────────────────────────────────────────────────────────────

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

// Parse incoming JSON request bodies
app.use(express.json());

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
 * Quick health-check endpoint.
 * The frontend calls this to decide whether to use live data or fallback mock data.
 *
 * Example response:
 *   { "status": "ok", "message": "VideoVerse API is running", "timestamp": "..." }
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'VideoVerse API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
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
    const filter = {};

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

    // ── Recommendations: same category, excluding current video, max 10 ────
    let recommendations = await Video.find({
      id:       { $ne: video.id },
      category: video.category,
    }).limit(10).lean();

    // Pad with popular videos from other categories if fewer than 5 results
    if (recommendations.length < 5) {
      const extraNeeded = 10 - recommendations.length;
      const extraIds    = recommendations.map(v => v.id).concat(video.id);

      const extra = await Video.find({
        id:       { $nin: extraIds },
        category: { $ne: video.category },
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

// ── Connect to MongoDB, then start listening ──────────────────────────────────
// The server only opens its port AFTER the DB connection is established.
// If the connection fails, the process exits so the problem is visible immediately.
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 VideoVerse API running at http://localhost:${PORT}`);
      console.log(`   Health check : http://localhost:${PORT}/api/health`);
      console.log(`   Videos list  : http://localhost:${PORT}/api/videos`);
      console.log(`   Single video : http://localhost:${PORT}/api/videos/vid-001`);
      console.log(`\n   Press Ctrl+C to stop.\n`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to MongoDB. Server will not start.', err.message);
    process.exit(1);
  });
