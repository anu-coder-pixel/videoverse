// Phase 4 Final Integration QA Script
// Comprehensive end-to-end verification across frontend assets, APIs, and multi-user interactions.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const CLIENT_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:5000';

async function runFinalIntegrationQA() {
  console.log('===============================================================');
  console.log('🧪 VIDEOVERSE PHASE 4: FINAL INTEGRATION QA TEST SUITE');
  console.log('===============================================================\n');

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

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const Comment = require('../models/Comment');
  const Video = require('../models/Video');

  const testVideo = await Video.findOne({ id: 'vid-001' }) || await Video.findOne();
  const videoId = testVideo.id;
  console.log(`Target Video: "${testVideo.title}" (ID: ${videoId})\n`);

  // -----------------------------------------------------------------
  // 1. Frontend Asset Serving & Mobile/Desktop Layout Verification
  // -----------------------------------------------------------------
  console.log('--- 1. Testing Frontend Assets & Layout Readiness (Port 5173) ---');

  const htmlRes = await fetch(CLIENT_URL);
  assert('Client dev server responds with HTTP 200', htmlRes.status === 200);
  const htmlText = await htmlRes.text();
  assert('HTML contains root div <div id="root">', htmlText.includes('id="root"'));
  assert('HTML includes Vite client script entry', htmlText.includes('/src/main.jsx'));

  // -----------------------------------------------------------------
  // 2. Guest Data Migration & Multi-User Accounts
  // -----------------------------------------------------------------
  console.log('\n--- 2. Testing Two Separate User Accounts & Guest Migration ---');

  const userAEmail = `user_alice_${Date.now()}@videoverse.local`;
  const userBEmail = `user_bob_${Date.now()}@videoverse.local`;

  // Guest data created by Alice prior to registration
  const aliceGuestData = {
    likedVideos: [videoId, 'vid-002'],
    dislikedVideos: [videoId, 'vid-003'], // videoId in both -> like should win
    watchLater: ['vid-004', 'vid-005'],
    watchHistory: ['vid-006', 'vid-007'],
    subscribedChannels: ['ch-001'],
  };

  // Register User A (Alice)
  const regAliceRes = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alice QA',
      email: userAEmail,
      password: 'AlicePassword123!',
      guestData: aliceGuestData,
    }),
  });
  assert('User A (Alice) registered with HTTP 201', regAliceRes.status === 201);
  const aliceToken = regAliceRes.headers.get('set-cookie')?.match(/vv_token=([^;]+)/)?.[1];
  assert('User A received auth cookie vv_token', !!aliceToken);
  const aliceCookie = `vv_token=${aliceToken}`;

  // Verify Alice's migrated data in DB
  const aliceDb = await User.findOne({ email: userAEmail });
  assert('Alice likedVideos contains vid-001 and vid-002', aliceDb.likedVideos.includes(videoId) && aliceDb.likedVideos.includes('vid-002'));
  assert('Alice dislikedVideos strictly excludes conflicting vid-001 (Mutual Exclusivity)', !aliceDb.dislikedVideos.includes(videoId));
  assert('Alice dislikedVideos contains non-conflicting vid-003', aliceDb.dislikedVideos.includes('vid-003'));
  assert('Alice watchLater contains vid-004', aliceDb.watchLater.includes('vid-004'));
  assert('Alice watchHistory contains vid-006', aliceDb.watchHistory.includes('vid-006'));
  assert('Alice subscribedChannels contains ch-001', aliceDb.subscribedChannels.includes('ch-001'));

  // Register User B (Bob) independently
  const regBobRes = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Bob QA',
      email: userBEmail,
      password: 'BobPassword123!',
    }),
  });
  assert('User B (Bob) registered with HTTP 201', regBobRes.status === 201);
  const bobToken = regBobRes.headers.get('set-cookie')?.match(/vv_token=([^;]+)/)?.[1];
  assert('User B received auth cookie vv_token', !!bobToken);
  const bobCookie = `vv_token=${bobToken}`;

  // -----------------------------------------------------------------
  // 3. Multilingual Comments & Translation Testing (Hindi, Bengali, Tamil, Telugu, Arabic)
  // -----------------------------------------------------------------
  console.log('\n--- 3. Testing Multilingual Comments & Translation (5 Languages) ---');

  const multilingualComments = [
    { lang: 'hi', name: 'Hindi', text: 'यह वीडियो बहुत शिक्षाप्रद और ज्ञानवर्धक है।' },
    { lang: 'bn', name: 'Bengali', text: 'দারুণ ভিডিও অনেক ধন্যবাদ এই কোর্সের জন্য।' },
    { lang: 'ta', name: 'Tamil', text: 'இந்த காணொளி மிகவும் பயனுள்ளதாக உள்ளது, மிக்க நன்றி.' },
    { lang: 'te', name: 'Telugu', text: 'ఈ వీడియో చాలా బాగుంది, ధన్యవాదాలు.' },
    { lang: 'ar', name: 'Arabic', text: 'هذا الفيديو رائع ومفيد جدا، شكرا جزيلا لك.' },
  ];

  const postedCommentIds = [];

  for (const item of multilingualComments) {
    const postRes = await fetch(`${API_URL}/api/videos/${videoId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': aliceCookie },
      body: JSON.stringify({ text: item.text }),
    });
    const postData = await postRes.json();
    assert(`Alice posts ${item.name} comment successfully`, postRes.status === 201 && postData.comment);
    assert(`${item.name} author is Alice QA (derived from session)`, postData.comment?.author === 'Alice QA');
    assert(`${item.name} language detected as ${item.lang}`, postData.comment?.language === item.lang);
    postedCommentIds.push(postData.comment.id);

    // Test translation
    const transRes = await fetch(`${API_URL}/api/comments/${postData.comment.id}/translate?target=en`);
    const transData = await transRes.json();
    assert(`Translation endpoint responds HTTP 200 for ${item.name}`, transRes.status === 200);

    // Test cache hit on immediate re-fetch
    const cacheRes = await fetch(`${API_URL}/api/comments/${postData.comment.id}/translate?target=en`);
    const cacheData = await cacheRes.json();
    if (transData.translated) {
      assert(`Translation for ${item.name} returns cached: true`, cacheData.cached === true);
    }
  }

  // -----------------------------------------------------------------
  // 4. Cross-User Interactions (Bob interacts with Alice's content)
  // -----------------------------------------------------------------
  console.log('\n--- 4. Testing Cross-User Social Interactions (Bob interacting with Alice) ---');

  // Bob views comments on the video
  const feedRes = await fetch(`${API_URL}/api/videos/${videoId}/comments?sort=newest`, {
    headers: { 'Cookie': bobCookie },
  });
  const feedData = await feedRes.json();
  assert('Bob fetches comments list', feedRes.status === 200 && Array.isArray(feedData.comments));

  // Bob likes Alice's Hindi comment
  const hindiCommentId = postedCommentIds[0];
  const likeCommentRes = await fetch(`${API_URL}/api/comments/${hindiCommentId}/like`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': bobCookie },
    body: JSON.stringify({ action: 'like' }),
  });
  const likeCommentData = await likeCommentRes.json();
  assert("Bob likes Alice's comment -> liked is true", likeCommentData.liked === true);
  assert("Comment likesCount atomically incremented to 1", likeCommentData.likesCount === 1);

  // Bob dislikes the video
  const dislikeRes = await fetch(`${API_URL}/api/auth/dislikes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': bobCookie },
    body: JSON.stringify({ videoId }),
  });
  const dislikeData = await dislikeRes.json();
  assert('Bob dislikes video -> in dislikedVideos', dislikeData.dislikedVideos.includes(videoId));
  assert('Bob dislikes video -> NOT in likedVideos', !dislikeData.likedVideos.includes(videoId));

  // Bob changes mind and likes the video -> mutual exclusivity removes dislike
  const likeVidRes = await fetch(`${API_URL}/api/auth/likes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': bobCookie },
    body: JSON.stringify({ videoId }),
  });
  const likeVidData = await likeVidRes.json();
  assert('Bob likes video -> added to likedVideos', likeVidData.likedVideos.includes(videoId));
  assert('Bob likes video -> purged from dislikedVideos (Mutual Exclusivity)', !likeVidData.dislikedVideos.includes(videoId));

  // -----------------------------------------------------------------
  // 5. Watch History & Watch Later Immediate Removal Actions
  // -----------------------------------------------------------------
  console.log('\n--- 5. Testing Watch History & Watch Later Immediate UI Actions ---');

  // Alice removes vid-006 from history
  const delHistRes = await fetch(`${API_URL}/api/auth/history/vid-006`, {
    method: 'DELETE',
    headers: { 'Cookie': aliceCookie },
  });
  const delHistData = await delHistRes.json();
  assert('Alice removes vid-006 from history returns HTTP 200', delHistRes.status === 200 && delHistData.success);
  assert('Watch history immediately excludes vid-006', !delHistData.watchHistory.includes('vid-006'));
  assert('Watch history preserves other items (vid-007)', delHistData.watchHistory.includes('vid-007'));

  // Alice removes vid-004 from Watch Later
  const delWlRes = await fetch(`${API_URL}/api/auth/watch-later`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': aliceCookie },
    body: JSON.stringify({ videoId: 'vid-004' }),
  });
  const delWlData = await delWlRes.json();
  assert('Alice toggles vid-004 in Watch Later returns HTTP 200', delWlRes.status === 200 && delWlData.success);
  assert('Watch Later immediately excludes vid-004', !delWlData.watchLater.includes('vid-004'));
  assert('Watch Later retains vid-005', delWlData.watchLater.includes('vid-005'));

  // -----------------------------------------------------------------
  // 6. Video Playback Streaming & WebRTC Calling Verification
  // -----------------------------------------------------------------
  console.log('\n--- 6. Testing Video Streaming (Range 206) & WebRTC Infrastructure ---');

  // Video range request
  const streamRes = await fetch(`${API_URL}/api/videos/${videoId}/stream`, {
    headers: { 'Range': 'bytes=0-1023' },
  });
  assert('Video streaming supports HTTP 206 Partial Content', streamRes.status === 206);
  assert('Video streaming returns Content-Range header', !!streamRes.headers.get('content-range'));

  // Video calling ICE servers endpoint
  const iceRes = await fetch(`${API_URL}/api/calls/ice-servers`, {
    headers: { 'Cookie': aliceCookie },
  });
  const iceData = await iceRes.json();
  assert('Video calling ICE servers endpoint returns HTTP 200', iceRes.status === 200);
  assert('ICE servers payload contains servers array', Array.isArray(iceData.iceServers) && iceData.iceServers.length > 0);

  // -----------------------------------------------------------------
  // 7. Cleanup
  // -----------------------------------------------------------------
  console.log('\n--- 7. Cleanup ---');
  await User.deleteMany({ email: { $in: [userAEmail, userBEmail] } });
  await Comment.deleteMany({ _id: { $in: postedCommentIds } });
  await mongoose.disconnect();
  console.log('QA test accounts and comments cleaned up.');

  console.log('\n===============================================================');
  console.log(`FINAL INTEGRATION QA RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
}

runFinalIntegrationQA().catch(err => {
  console.error('Fatal QA error:', err);
  process.exit(1);
});

