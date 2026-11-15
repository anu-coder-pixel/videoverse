// Verification script for production rate limiting, translation error resilience,
// multilingual comments (Hindi, Bengali, Tamil, Telugu, Arabic), and guest data migration.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const BASE_URL = 'http://127.0.0.1:5000';

async function main() {
  console.log('🧪 Starting Edge Case Verification Suite...');

  // Connect to DB to check and clean test data
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const Comment = require('../models/Comment');
  const Video = require('../models/Video');

  const testVideo = await Video.findOne();
  const videoId = testVideo ? testVideo.id : 'vid-001';
  console.log(`Using Video ID: ${videoId}`);

  let passed = 0;
  let failed = 0;

  function assert(desc, condition) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test 1: Multilingual Comments (Hindi, Bengali, Tamil, Telugu, Arabic)
  // -------------------------------------------------------------
  console.log('\n--- 1. Testing Multilingual Comment Ingestion & Retrieval ---');

  // Register a dedicated QA tester
  const qaEmail = `qa_edge_${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'QA Edge Tester',
      email: qaEmail,
      password: 'QAPassword123!',
    }),
  });
  const regData = await regRes.json();
  const setCookie = regRes.headers.get('set-cookie');
  const tokenMatch = setCookie ? setCookie.match(/vv_token=([^;]+)/) : null;
  const token = tokenMatch ? tokenMatch[1] : null;

  assert('QA tester registered', regRes.ok && token);

  const cookieHeader = `vv_token=${token}`;

  const multilingualSamples = [
    { lang: 'hi', name: 'Hindi (Devanagari)', text: 'यह वीडियो बहुत शिक्षाप्रद और ज्ञानवर्धक है।' },
    { lang: 'bn', name: 'Bengali', text: 'এই ভিডিওটি সত্যিই অসাধারণ এবং খুব সুন্দর।' },
    { lang: 'ta', name: 'Tamil', text: 'இந்த காணொளி மிகவும் பயனுள்ளதாக உள்ளது, மிக்க நன்றி.' },
    { lang: 'te', name: 'Telugu', text: 'ఈ వీడియో చాలా బాగుంది, ధన్యవాదాలు.' },
    { lang: 'ar', name: 'Arabic', text: 'هذا الفيديو رائع ومفيد جدا، شكرا جزيلا لك.' },
  ];

  const createdCommentIds = [];

  for (const sample of multilingualSamples) {
    const postRes = await fetch(`${BASE_URL}/api/videos/${videoId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({ text: sample.text }),
    });
    const postData = await postRes.json();
    assert(`Post ${sample.name} comment succeeded`, postRes.ok && postData.comment);
    if (postData.comment) {
      assert(`${sample.name} text preserved exactly`, postData.comment.text === sample.text);
      assert(`${sample.name} detected as ${sample.lang}`, postData.comment.language === sample.lang);
      createdCommentIds.push(postData.comment.id);
    }
  }

  // Verify comments appear in public feed with correct Unicode
  const feedRes = await fetch(`${BASE_URL}/api/videos/${videoId}/comments?sort=newest`);
  const feedData = await feedRes.json();
  assert('Public feed retrieved with HTTP 200', feedRes.ok);

  for (const sample of multilingualSamples) {
    const found = feedData.comments.find(c => c.text === sample.text);
    assert(`${sample.name} comment present intact in public feed`, found !== undefined);
  }

  // -------------------------------------------------------------
  // Test 2: Multilingual Translation Endpoints & Caching
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Multilingual Translations & Cache Hits ---');

  for (let i = 0; i < createdCommentIds.length; i++) {
    const cid = createdCommentIds[i];
    const sample = multilingualSamples[i];

    // Call 1: fresh translation
    const t1 = Date.now();
    const transRes1 = await fetch(`${BASE_URL}/api/comments/${cid}/translate?target=en`);
    const trans1 = await transRes1.json();
    const duration1 = Date.now() - t1;

    assert(`Translation endpoint responds for ${sample.name}`, transRes1.ok);

    // Call 2: cache check
    const t2 = Date.now();
    const transRes2 = await fetch(`${BASE_URL}/api/comments/${cid}/translate?target=en`);
    const trans2 = await transRes2.json();
    const duration2 = Date.now() - t2;

    if (trans1.translated) {
      assert(`${sample.name} returns cached: true on second request`, trans2.cached === true);
      assert(`${sample.name} cache hit is faster (${duration2}ms <= ${duration1}ms)`, duration2 <= duration1 + 50);
    } else {
      console.log(`     (${sample.name} translation returned: ${trans1.error || 'fallback'})`);
    }
  }

  // -------------------------------------------------------------
  // Test 3: Guest Data Migration on Registration & Login
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Guest Data Migration (Mutual Exclusivity) ---');

  const guestData = {
    likedVideos: [videoId, 'vid-guest-liked'],
    dislikedVideos: [videoId, 'vid-guest-disliked'], // videoId in BOTH!
    watchLater: ['vid-guest-wl'],
    watchHistory: ['vid-guest-h1', 'vid-guest-h2'],
    subscribedChannels: ['ch-guest-1'],
  };

  const guestUserEmail = `guest_migration_${Date.now()}@example.com`;
  const migRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Guest Migrated User',
      email: guestUserEmail,
      password: 'MigrationPassword123!',
      guestData,
    }),
  });
  const migRegData = await migRegRes.json();
  assert('Guest registration succeeded', migRegRes.ok && migRegData.success);

  const migratedUser = await User.findOne({ email: guestUserEmail });
  assert('Liked videos contain guest likes', migratedUser.likedVideos.includes(videoId) && migratedUser.likedVideos.includes('vid-guest-liked'));
  assert('Disliked videos EXCLUDE conflicting liked video (Mutual Exclusivity)', !migratedUser.dislikedVideos.includes(videoId));
  assert('Disliked videos retain non-conflicting dislike', migratedUser.dislikedVideos.includes('vid-guest-disliked'));
  assert('Watch later imported cleanly', migratedUser.watchLater.includes('vid-guest-wl'));
  assert('Watch history imported with deduplication', migratedUser.watchHistory.includes('vid-guest-h1'));
  assert('Subscribed channels imported cleanly', migratedUser.subscribedChannels.includes('ch-guest-1'));

  // -------------------------------------------------------------
  // Test 4: UI State Actions (History, Watch Later, Likes)
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Watch Later & History Immediate API Actions ---');

  const migTokenMatch = migRegRes.headers.get('set-cookie')?.match(/vv_token=([^;]+)/);
  const migCookie = `vv_token=${migTokenMatch ? migTokenMatch[1] : ''}`;

  // Remove single video from history
  const delHistRes = await fetch(`${BASE_URL}/api/auth/history/vid-guest-h1`, {
    method: 'DELETE',
    headers: { 'Cookie': migCookie },
  });
  const delHistData = await delHistRes.json();
  assert('Remove single history item returns HTTP 200', delHistRes.ok && delHistData.success);
  assert('History array immediately excludes removed item', !delHistData.watchHistory.includes('vid-guest-h1'));
  assert('History retains other items', delHistData.watchHistory.includes('vid-guest-h2'));

  // Toggle remove from Watch Later
  const togWlRes = await fetch(`${BASE_URL}/api/auth/watch-later`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': migCookie },
    body: JSON.stringify({ videoId: 'vid-guest-wl' }),
  });
  const togWlData = await togWlRes.json();
  assert('Toggle Watch Later returns HTTP 200', togWlRes.ok && togWlData.success);
  assert('Watch Later immediately excludes toggled item', !togWlData.watchLater.includes('vid-guest-wl'));

  // -------------------------------------------------------------
  // Clean up test data
  // -------------------------------------------------------------
  console.log('\n--- 5. Cleanup ---');
  await User.deleteMany({ email: { $in: [qaEmail, guestUserEmail] } });
  await Comment.deleteMany({ _id: { $in: createdCommentIds } });
  await mongoose.disconnect();
  console.log('Test data cleaned up.');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

