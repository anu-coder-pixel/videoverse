const mongoose = require("mongoose");

/**
 * VideoVerse — Mongoose Video Model
 *
 * Schema fields are derived directly from the 72 video records in
 * server/data/videos.js and client/src/data/mockData.js.
 * Field names are preserved exactly to ensure compatibility with
 * existing API responses and frontend code.
 *
 * Channel data is embedded (not a separate collection) because:
 *  - Every video already carries the full channel object
 *  - It avoids a second DB lookup per video request
 *  - A Channel model can be extracted later if needed
 */

// ── Embedded Channel Sub-Schema ───────────────────────────────────────────────
// Matches: { id, name, handle, subscribers, avatarColor, initials, verified }
// _id is disabled — this is not a top-level document; it has no Mongo ObjectId.
const ChannelSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      // Example: "ch-001"
    },
    name: {
      type: String,
      required: true,
      // Example: "CodeCraft Studio"
    },
    handle: {
      type: String,
      required: true,
      // Example: "@codecraft"
    },
    subscribers: {
      type: String,
      required: true,
      // Stored as a human-readable string (e.g. "1.2M", "845K")
      // Not a Number — the existing data uses formatted strings
    },
    avatarColor: {
      type: String,
      required: true,
      // Hex colour string, e.g. "#6c63ff"
    },
    initials: {
      type: String,
      required: true,
      // Two-letter channel initials, e.g. "CC"
    },
    verified: {
      type: Boolean,
      required: true,
    },
  },
  { _id: false } // No separate ObjectId for embedded sub-documents
);

// ── Video Schema ──────────────────────────────────────────────────────────────
const VideoSchema = new mongoose.Schema(
  {
    // Human-readable string ID from the existing dataset (e.g. "vid-001").
    // Stored as a plain field alongside MongoDB"s automatic _id.
    // Indexed for fast lookups by the existing API routes (/api/videos/:id).
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    // Full channel object embedded directly in the video document.
    channel: {
      type: ChannelSchema,
      required: true,
    },

    category: {
      type: String,
      required: true,
      // Examples: "Technology", "Gaming", "Music", "Education", etc.
    },

    // View count stored as a human-readable string (e.g. "1.4M", "12.4M").
    // Not a Number — the existing data and API use formatted strings.
    views: {
      type: String,
      default: "0",
    },

    // Relative upload time string (e.g. "3 days ago", "1 month ago").
    // Not a Date — the existing data uses pre-formatted display strings.
    uploadedAt: {
      type: String,
      default: "",
    },

    // Video length as a display string (e.g. "42:15", "1:14:20", "4:00:00").
    // Not stored as seconds — the existing data uses HH:MM:SS or MM:SS strings.
    duration: {
      type: String,
      default: "",
    },

    // Like count as a human-readable string (e.g. "48K", "380K").
    likes: {
      type: String,
      default: "0",
    },

    description: {
      type: String,
      default: "",
    },

    // Array of tag strings (e.g. ["React", "Node.js", "Tutorial"])
    tags: {
      type: [String],
      default: [],
    },

    thumbnailUrl: {
      type: String,
      default: "",
    },

    // thumbnailIndex is present in client/src/data/mockData.js (integer 0-71)
    // but NOT in server/data/videos.js.
    // Included as optional so documents seeded from either source are accepted.
    thumbnailIndex: {
      type: Number,
      // Not required — absent in the server dataset
    },

    videoUrl: {
      type: String,
      default: "",
    },

    // Fallback video URL used when videoUrl fails to load.
    fallbackUrl: {
      type: String,
      default: "",
    },
  },
  {
    // Automatically adds `createdAt` and `updatedAt` timestamps.
    timestamps: true,

    // When converting a document to JSON (e.g. res.json()), keep the
    // virtual fields and remove the internal __v version key.
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(doc, ret) {
        // Remove Mongoose"s internal _id from JSON output so the API
        // continues to return the same shape as the current mock data.
        delete ret._id;
      },
    },
  }
);

// ── Export ────────────────────────────────────────────────────────────────────
// Mongoose will create (or reuse) a collection named "videos" in MongoDB.
module.exports = mongoose.model("Video", VideoSchema);
