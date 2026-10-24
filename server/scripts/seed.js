/**
 * VideoVerse — Database Seed Script
 *
 * Purpose:
 *   Upserts the 72 videos from server/data/videos.js into MongoDB Atlas.
 *
 * Safety guarantees:
 *   - Uses updateOne + upsert:true keyed on the video "id" field.
 *   - If a video already exists it is UPDATED (not duplicated).
 *   - If a video is new it is INSERTED.
 *   - No records are ever deleted from the database.
 *   - The MongoDB URI is never printed.
 *
 * Usage (from the server/ directory):
 *   node scripts/seed.js
 * Or via npm script:
 *   npm run seed
 */

require("dotenv").config();          // Load server/.env  (MONGODB_URI, etc.)

const mongoose  = require("mongoose");
const connectDB = require("../config/db");         // reusable connection helper
const Video     = require("../models/Video");       // Mongoose model
const { MOCK_VIDEOS } = require("../data/videos"); // the 72 source records

// ── Main seed function ────────────────────────────────────────────────────────
async function seed() {
  // ── 1. Connect ──────────────────────────────────────────────────────────────
  await connectDB(); // logs "✅ MongoDB connected successfully: <host>"

  const sourceCount = MOCK_VIDEOS.length;
  console.log(`\n📋 Source records loaded : ${sourceCount}`);

  let inserted = 0;
  let updated  = 0;
  let failed   = 0;

  // ── 2. Upsert each video ───────────────────────────────────────────────────
  // We process videos one-by-one so each error is isolated and reported
  // without stopping the entire seed run.
  for (const video of MOCK_VIDEOS) {
    try {
      const result = await Video.updateOne(
        { id: video.id },          // ← find by the human-readable "id" field
        { $set: video },           // ← replace all fields with the source data
        { upsert: true }           // ← insert if not found, update if found
      );

      if (result.upsertedCount === 1) {
        inserted++;
      } else if (result.modifiedCount === 1) {
        updated++;
      }
      // matchedCount === 1 && modifiedCount === 0 means the document already
      // existed and its fields were identical — no action needed, not counted.
    } catch (err) {
      failed++;
      // Log the video ID and the error message, but never the URI or credentials.
      console.error(`  ❌ Failed to upsert ${video.id}: ${err.message}`);
    }
  }

  // ── 3. Summary ─────────────────────────────────────────────────────────────
  const unchanged = sourceCount - inserted - updated - failed;

  console.log("\n─────────────────────────────────────");
  console.log("  Seed complete");
  console.log("─────────────────────────────────────");
  console.log(`  Source records  : ${sourceCount}`);
  console.log(`  Inserted (new)  : ${inserted}`);
  console.log(`  Updated         : ${updated}`);
  console.log(`  Already in sync : ${unchanged}`);
  console.log(`  Errors          : ${failed}`);
  console.log("─────────────────────────────────────\n");

  // If any individual upsert failed, throw so the .catch() branch runs.
  // This guarantees process.exit(1) and prevents a false-success message.
  if (failed > 0) {
    throw new Error(`${failed} record(s) could not be upserted. Check errors above.`);
  }
}

// ── Run and clean up ─────────────────────────────────────────────────────────
seed()
  .then(async () => {
    await mongoose.disconnect();
    console.log("🔌 Database connection closed.");
    console.log("✅ All records processed successfully.\n");
    process.exit(0);
  })
  .catch(async (err) => {
    // Catches both connection failures and the failed-upserts throw above.
    console.error(`\n⚠️  ${err.message}`);
    await mongoose.disconnect();
    console.log("🔌 Database connection closed.");
    process.exit(1);
  });
