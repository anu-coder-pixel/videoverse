/**
 * VideoVerse — Backend API Server
 * 
 * Stack: Node.js + Express
 * 
 * Routes:
 *   GET /api/health          → server status check
 *   GET /api/videos          → list all videos (supports ?category= and ?q= query params)
 *   GET /api/videos/:id      → single video by ID
 * 
 * This server currently serves the same sample dataset as the frontend.
 * Later tasks will replace this with a real MongoDB database.
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// ── Import the video dataset ──────────────────────────────────────────────────
// We copy the data here as plain JS objects (no ES module import needed).
// When a database is added in a later task, this file will be replaced.
const { MOCK_VIDEOS, MOCK_CHANNELS, CATEGORIES } = require('./data/videos');

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────

// CORS: allow the Vite dev server (port 5173) and any localhost port to call this API.
// In production you would lock this down to your real domain.
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parse incoming JSON request bodies (needed for POST/PUT later)
app.use(express.json());

// ── Helper: parse view strings like "1.2M" → 1200000 ─────────────────────────
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
 * Returns the full list of videos.
 * Supports optional query parameters:
 *   ?category=Gaming          → filter by category (case-insensitive)
 *   ?q=python                 → search by title, channel name, category, or tags
 *   ?sort=trending            → sort by views descending
 * 
 * Example response:
 *   { "total": 72, "videos": [...] }
 */
app.get('/api/videos', (req, res) => {
  try {
    let videos = [...MOCK_VIDEOS];

    // Filter by category
    const category = req.query.category;
    if (category && category.toLowerCase() !== 'all') {
      videos = videos.filter(v =>
        v.category.toLowerCase() === category.toLowerCase()
      );
    }

    // Search across title, channel name, category, tags
    const q = req.query.q;
    if (q && q.trim()) {
      const query = q.toLowerCase().trim();
      videos = videos.filter(v =>
        v.title.toLowerCase().includes(query) ||
        v.channel.name.toLowerCase().includes(query) ||
        v.category.toLowerCase().includes(query) ||
        (v.tags && v.tags.some(t => t.toLowerCase().includes(query)))
      );
    }

    // Sort by trending (views)
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
 * Returns a single video by its unique ID.
 * Also returns a list of recommended videos (same category, excluding the current video).
 * 
 * Example response:
 *   { "video": {...}, "recommendations": [...] }
 */
app.get('/api/videos/:id', (req, res) => {
  try {
    const video = MOCK_VIDEOS.find(v => v.id === req.params.id);

    if (!video) {
      return res.status(404).json({
        error: 'Video not found',
        id: req.params.id,
      });
    }

    // Build recommendations: same category, exclude the current video, max 10
    const recommendations = MOCK_VIDEOS
      .filter(v => v.id !== video.id && v.category === video.category)
      .slice(0, 10);

    // If fewer than 5 from same category, pad with other popular videos
    if (recommendations.length < 5) {
      const extra = MOCK_VIDEOS
        .filter(v => v.id !== video.id && v.category !== video.category)
        .sort((a, b) => parseViews(b.views) - parseViews(a.views))
        .slice(0, 10 - recommendations.length);
      recommendations.push(...extra);
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
 * Returns the list of available categories.
 */
app.get('/api/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

/**
 * GET /api/channels
 * 
 * Returns all channel profiles.
 */
app.get('/api/channels', (req, res) => {
  res.json({ channels: MOCK_CHANNELS });
});

// ── 404 handler (for unknown routes) ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    hint: 'Available routes: GET /api/health, GET /api/videos, GET /api/videos/:id, GET /api/categories, GET /api/channels',
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

// ── Start listening ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 VideoVerse API running at http://localhost:${PORT}`);
  console.log(`   Health check : http://localhost:${PORT}/api/health`);
  console.log(`   Videos list  : http://localhost:${PORT}/api/videos`);
  console.log(`   Single video : http://localhost:${PORT}/api/videos/vid-001`);
  console.log(`\n   Press Ctrl+C to stop.\n`);
});
