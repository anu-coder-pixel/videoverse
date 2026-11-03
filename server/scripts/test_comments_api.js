/**
 * Automated Verification Script for Task 1: Comments, Moderation, Multilingual & Atomic Likes
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const BASE_URL = 'http://localhost:5000';

async function runTests() {
  console.log('🧪 Starting Task 1 Comments API Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Guest public read
    console.log('1. Testing Public Guest Read...');
    const guestRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`);
    assert(guestRes.status === 200, 'Guest can read comments (HTTP 200)');
    const guestData = await guestRes.json();
    assert(Array.isArray(guestData.comments), 'Returns comments array');
    console.log(`     Initial comments count on vid-001: ${guestData.comments.length}`);

    // 2. Guest unauthenticated comment post rejection
    console.log('\n2. Testing Guest Comment Post Rejection (Require Auth)...');
    const unauthPostRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'This should fail because I am a guest' }),
    });
    assert(unauthPostRes.status === 401, 'Guest comment post rejected with HTTP 401');
    const unauthPostData = await unauthPostRes.json();
    assert(unauthPostData.code === 'AUTH_REQUIRED', 'Error code is AUTH_REQUIRED');

    // 3. User Registration / Login for auth tests
    console.log('\n3. Creating Test Users for Authenticated Tests...');
    const testEmail1 = `commenter_${Date.now()}@example.com`;
    const regRes1 = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Genuine Commenter',
        email: testEmail1,
        password: 'Password123!',
      }),
    });
function cleanCookies(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return list.map(c => c.split(';')[0]).join('; ');
}

    assert(regRes1.status === 201, 'Test User 1 registered successfully');
    const cookie1 = cleanCookies(regRes1);
    assert(!!cookie1 && cookie1.includes('vv_token'), 'Auth cookie vv_token received');

    const testEmail2 = `liker_${Date.now()}@example.com`;
    const regRes2 = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Second Liker',
        email: testEmail2,
        password: 'Password123!',
      }),
    });
    const cookie2 = cleanCookies(regRes2);

    // 4. Author Spoofing Prevention
    console.log('\n4. Testing Author Spoofing Prevention...');
    const spoofRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({
        text: 'Legitimate comment text here.',
        author: 'FAKE_ADMIN_NAME',
        authorInitials: 'FA',
        userId: '650000000000000000000000',
        authorColor: '#000000',
      }),
    });
    assert(spoofRes.status === 201, 'Comment posted successfully');
    const spoofData = await spoofRes.json();
    assert(spoofData.comment.author === 'Genuine Commenter', 'Author derived from session (not spoofed FAKE_ADMIN_NAME)');
    assert(spoofData.comment.authorInitials === 'GC', 'Author initials derived from session (not spoofed FA)');
    const firstCommentId = spoofData.comment.id;

    // 5. Moderation Option A Testing
    console.log('\n5. Testing Moderation Option A (Severe Rejection & Borderline Flagging)...');
    // 5a. Severe Prohibited
    const severeRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({
        text: 'You are an absolute clown kill yourself now',
      }),
    });
    assert(severeRes.status === 400, 'Severe prohibited content rejected with HTTP 400');
    const severeData = await severeRes.json();
    assert(severeData.code === 'MODERATION_REJECTED', 'Response code is MODERATION_REJECTED');

    // 5b. Borderline / Spam Flagging
    const borderlineRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({
        text: 'Sub4sub subscribe to my channel for amazing videos check out my channel!',
      }),
    });
    assert(borderlineRes.status === 201, 'Borderline comment accepted for review with HTTP 201');
    const borderlineData = await borderlineRes.json();
    assert(borderlineData.flagged === true, 'Response marks flagged: true');
    const flaggedCommentId = borderlineData.comment.id;

    // 5c. Verify flagged comment does NOT appear in public feed
    const publicAfterFlagged = await fetch(`${BASE_URL}/api/videos/vid-001/comments`);
    const publicData = await publicAfterFlagged.json();
    const hasFlaggedInFeed = publicData.comments.some(c => c.id === flaggedCommentId);
    assert(!hasFlaggedInFeed, 'Flagged comment does NOT appear in public comments feed');

    // 6. Multilingual Unicode Support
    console.log('\n6. Testing Multilingual Unicode Storage & Display...');
    const hindiText = 'नमस्ते! यह वीडियो वाकई बहुत ही ज्ञानवर्धक और उपयोगी है। 🌟✨';
    const hindiRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({ text: hindiText }),
    });
    assert(hindiRes.status === 201, 'Hindi comment posted with HTTP 201');
    const hindiData = await hindiRes.json();
    assert(hindiData.comment.text === hindiText, 'Unicode Devanagari text exact match');
    assert(hindiData.comment.language === 'hi', 'Language detected as Hindi (hi)');
    const hindiCommentId = hindiData.comment.id;

    // Verify reading back multilingual comment
    const readFeed = await fetch(`${BASE_URL}/api/videos/vid-001/comments?sort=newest`);
    const readData = await readFeed.json();
    const retrievedHindi = readData.comments.find(c => c.id === hindiCommentId);
    assert(!!retrievedHindi && retrievedHindi.text === hindiText, 'Multilingual comment retrieved intact in public feed');

    // 7. Optional Translation Endpoint
    console.log('\n7. Testing Optional Translation Endpoint...');
    // 7a. Unicode Devanagari translation
    const transRes = await fetch(`${BASE_URL}/api/comments/${hindiCommentId}/translate?target=en`);
    assert(transRes.status === 200, 'Translation endpoint responded with HTTP 200 for Devanagari Hindi');
    const transData = await transRes.json();
    console.log(`     Translation result: translated=${transData.translated}, provider=${transData.provider || 'none'}, text="${transData.translatedText || transData.error || ''}"`);
    assert(typeof transData.translated === 'boolean', 'Translation status is a valid boolean');
    if (transData.translated) {
      assert(transData.translatedText !== hindiText, 'Translated text is not identical to original Hindi');
    }

    // 7b. Hinglish / Romanized Hindi translation (e.g. "bhut badhiya")
    const hinglishPostRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({ text: 'bhut badhiya' }),
    });
    assert(hinglishPostRes.status === 201, 'Hinglish comment posted with HTTP 201');
    const hinglishPostData = await hinglishPostRes.json();
    const hinglishCommentId = hinglishPostData.comment.id;

    const hinglishTransRes = await fetch(`${BASE_URL}/api/comments/${hinglishCommentId}/translate?target=en`);
    assert(hinglishTransRes.status === 200, 'Translation endpoint responded with HTTP 200 for Hinglish');
    const hinglishTransData = await hinglishTransRes.json();
    console.log(`     Hinglish translation: translated=${hinglishTransData.translated}, text="${hinglishTransData.translatedText || hinglishTransData.error || ''}"`);
    assert(hinglishTransData.translated === true, 'Hinglish comment is successfully translated');
    assert(hinglishTransData.translatedText === 'Very good', 'Hinglish "bhut badhiya" translates to "Very good"');

    // 7c. Roman Bengali comment translation (e.g. "ami tomako")
    const bengaliPostRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({ text: 'ami tomako' }),
    });
    assert(bengaliPostRes.status === 201, 'Roman Bengali comment posted with HTTP 201');
    const bengaliPostData = await bengaliPostRes.json();
    const bengaliCommentId = bengaliPostData.comment.id;
    assert(bengaliPostData.comment.language === 'bn', 'Roman Bengali "ami tomako" detected as Bengali (bn)');

    const bengaliTransRes = await fetch(`${BASE_URL}/api/comments/${bengaliCommentId}/translate?target=en`);
    assert(bengaliTransRes.status === 200, 'Translation endpoint responded with HTTP 200 for Roman Bengali');
    const bengaliTransData = await bengaliTransRes.json();
    console.log(`     Roman Bengali translation: translated=${bengaliTransData.translated}, text="${bengaliTransData.translatedText || bengaliTransData.error || ''}"`);
    assert(bengaliTransData.translated === true, 'Roman Bengali comment is successfully translated');
    assert(bengaliTransData.translatedText === 'Incomplete phrase — more context needed', 'Roman Bengali "ami tomako" translates to "Incomplete phrase — more context needed"');
    assert(bengaliTransData.sourceLanguage === 'bn', 'Translation returned source language as "bn"');

    // 7d. Bengali Script comment translation (e.g. "অনেক ধন্যবাদ")
    const bengaliScriptPostRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie1,
      },
      body: JSON.stringify({ text: 'অনেক ধন্যবাদ' }),
    });
    assert(bengaliScriptPostRes.status === 201, 'Bengali script comment posted with HTTP 201');
    const bengaliScriptPostData = await bengaliScriptPostRes.json();
    const bengaliScriptCommentId = bengaliScriptPostData.comment.id;
    assert(bengaliScriptPostData.comment.language === 'bn', 'Bengali script detected as Bengali (bn)');

    const bengaliScriptTransRes = await fetch(`${BASE_URL}/api/comments/${bengaliScriptCommentId}/translate?target=en`);
    assert(bengaliScriptTransRes.status === 200, 'Translation endpoint responded with HTTP 200 for Bengali script');
    const bengaliScriptTransData = await bengaliScriptTransRes.json();
    console.log(`     Bengali script translation: translated=${bengaliScriptTransData.translated}, text="${bengaliScriptTransData.translatedText || bengaliScriptTransData.error || ''}"`);
    assert(bengaliScriptTransData.translated === true, 'Bengali script comment is successfully translated');
    assert(bengaliScriptTransData.translatedText === 'Thank you very much', 'Bengali script "অনেক ধন্যবাদ" translates to "Thank you very much"');

    // 7e. Genuine English comment translation (should show already in English)
    const engTransRes = await fetch(`${BASE_URL}/api/comments/${firstCommentId}/translate?target=en`);
    assert(engTransRes.status === 200, 'Translation endpoint responded with HTTP 200 for English');
    const engTransData = await engTransRes.json();
    console.log(`     English check: alreadyTargetLanguage=${engTransData.alreadyTargetLanguage}, message="${engTransData.message || ''}"`);
    assert(engTransData.alreadyTargetLanguage === true, 'English comment correctly recognized as already in English');
    assert(engTransData.message === 'Comment is already in English.', 'English comment returns correct message');

    // 7f. Unit Tests: Language Detection & English False-Positive Prevention
    console.log('\n7f. Testing Language Detection Script Ranges & False Positive Guardrails...');
    const { detectLanguage } = require('../utils/moderation');

    // English false-positive checks for common English words that overlap with Indian languages
    assert(detectLanguage('The main singer will hum along to the music') === 'en', 'English sentence with "main" and "hum" detected as English (en)');
    assert(detectLanguage('I have a tooth ache and a headache') === 'en', 'English sentence with "ache" detected as English (en)');
    assert(detectLanguage('This is so cool and one of the best videos') === 'en', 'English sentence with "so" and "one" detected as English (en)');
    assert(detectLanguage('Come on, tell me what you think') === 'en', 'English sentence with "me" and "come" detected as English (en)');
    assert(detectLanguage('Hi, how are you doing today my friend?') === 'en', 'English greeting detected as English (en)');

    // Romanized Indic language detection
    assert(detectLanguage('romba nalla irukku') === 'ta', 'Romanized Tamil "romba nalla irukku" detected as ta');
    assert(detectLanguage('mikka nandri nanba') === 'ta', 'Romanized Tamil "mikka nandri nanba" detected as ta');
    assert(detectLanguage('chala bagundi') === 'te', 'Romanized Telugu "chala bagundi" detected as te');
    assert(detectLanguage('chala dhanyavadalu') === 'te', 'Romanized Telugu "chala dhanyavadalu" detected as te');
    assert(detectLanguage('bahut vadiya video') === 'pa', 'Romanized Punjabi "bahut vadiya video" detected as pa');
    assert(detectLanguage('sat sri akal') === 'pa', 'Romanized Punjabi "sat sri akal" detected as pa');
    assert(detectLanguage('khup chan video') === 'mr', 'Romanized Marathi "khup chan video" detected as mr');
    assert(detectLanguage('lay bhari') === 'mr', 'Romanized Marathi "lay bhari" detected as mr');
    assert(detectLanguage('ami tomake bhalobashi') === 'bn', 'Romanized Bengali "ami tomake bhalobashi" detected as bn');
    assert(detectLanguage('onek dhonnobad') === 'bn', 'Romanized Bengali "onek dhonnobad" detected as bn');

    // Unicode Script verification (ensuring Telugu ధ/ధ is not confused with Bengali ধ)
    assert(detectLanguage('ధన్యవాదాలు') === 'te', 'Telugu script "ధన్యవాదాలు" correctly detected as Telugu (te)');
    assert(detectLanguage('ధన్యవాదాలు చాలా బాగుంది') === 'te', 'Telugu sentence correctly detected as Telugu (te)');
    assert(detectLanguage('ধন্যবাদ') === 'bn', 'Bengali script "ধন্যবাদ" correctly detected as Bengali (bn)');
    assert(detectLanguage('অনেক ধন্যবাদ খুব ভালো') === 'bn', 'Bengali sentence correctly detected as Bengali (bn)');
    assert(detectLanguage('மிக்க நன்றி') === 'ta', 'Tamil script "மிக்க நன்றி" correctly detected as Tamil (ta)');
    assert(detectLanguage('ਖੂਬ ਆਭਾਰ') === 'gu' || detectLanguage('ખૂબ આભાર') === 'gu', 'Gujarati script correctly detected as Gujarati (gu)');
    assert(detectLanguage('ਬਹੁਤ ਧੰਨਵਾਦ') === 'pa', 'Gurmukhi script "ਬਹੁਤ ਧੰਨਵਾਦ" correctly detected as Punjabi (pa)');

    // Arabic vs Urdu distinction checks
    assert(detectLanguage('بہت شکریہ آپ کا') === 'ur', 'Urdu sentence correctly detected as Urdu (ur)');
    assert(detectLanguage('شكرا جزيلا مرحبا') === 'ar', 'Arabic sentence correctly detected as Arabic (ar)');
    assert(detectLanguage('खूप छान व्हिडिओ आहे') === 'mr', 'Marathi Devanagari sentence correctly detected as Marathi (mr)');
    assert(detectLanguage('यह बहुत अच्छा वीडियो है') === 'hi', 'Hindi Devanagari sentence correctly detected as Hindi (hi)');

    // Mixed-language comments
    assert(detectLanguage('good video bhai bahut accha') === 'hi', 'Mixed English-Hindi comment detected as hi');
    assert(detectLanguage('thank you ami tomake bhalobashi') === 'bn', 'Mixed English-Bengali comment detected as bn');
    assert(detectLanguage('super video romba nalla irukku') === 'ta', 'Mixed English-Tamil comment detected as ta');
    assert(detectLanguage('amazing content chala bagundi') === 'te', 'Mixed English-Telugu comment detected as te');

    // Ambiguous short comments (must stay English, never falsely classified)
    assert(detectLanguage('ok') === 'en', 'Short comment "ok" detected as en');
    assert(detectLanguage('cool') === 'en', 'Short comment "cool" detected as en');
    assert(detectLanguage('nice video') === 'en', 'Short comment "nice video" detected as en');
    assert(detectLanguage('wow') === 'en', 'Short comment "wow" detected as en');
    assert(detectLanguage('lol') === 'en', 'Short comment "lol" detected as en');
    assert(detectLanguage('yes') === 'en', 'Short comment "yes" detected as en');
    assert(detectLanguage('great') === 'en', 'Short comment "great" detected as en');
    assert(detectLanguage('awesome') === 'en', 'Short comment "awesome" detected as en');

    // 8. Concurrency-Safe Atomic Likes
    console.log('\n8. Testing Concurrency-Safe Atomic Comment Likes...');
    // 8a. User 1 likes comment
    const likeRes1 = await fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, {
      method: 'PUT',
      headers: { 'Cookie': cookie1 },
    });
    assert(likeRes1.status === 200, 'User 1 like succeeded with HTTP 200');
    const likeData1 = await likeRes1.json();
    assert(likeData1.liked === true, 'Liked is true');
    assert(likeData1.likesCount === 1, 'Likes count incremented to 1');

    // 8b. Concurrent likes from same user (simultaneous duplicate requests)
    console.log('     Sending 4 concurrent like requests from User 1 to test race condition resilience...');
    const concurrentResponses = await Promise.all([
      fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, { method: 'PUT', headers: { 'Cookie': cookie1 } }),
      fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, { method: 'PUT', headers: { 'Cookie': cookie1 } }),
      fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, { method: 'PUT', headers: { 'Cookie': cookie1 } }),
      fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, { method: 'PUT', headers: { 'Cookie': cookie1 } }),
    ]);
    const results = await Promise.all(concurrentResponses.map(r => r.json()));
    const finalLikeRes = await fetch(`${BASE_URL}/api/videos/vid-001/comments`);
    const finalComments = await finalLikeRes.json();
    const matchedComment = finalComments.comments.find(c => c.id === firstCommentId);
    assert(matchedComment.likesCount === 0 || matchedComment.likesCount === 1,
      `Likes count is atomic and non-duplicated (current count: ${matchedComment.likesCount})`);

    // 8c. User 1 likes and User 2 likes
    // Ensure User 1 has liked:
    if (matchedComment.likesCount === 0) {
      await fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, { method: 'PUT', headers: { 'Cookie': cookie1 } });
    }
    // User 2 likes:
    const user2LikeRes = await fetch(`${BASE_URL}/api/comments/${firstCommentId}/like`, { method: 'PUT', headers: { 'Cookie': cookie2 } });
    const user2LikeData = await user2LikeRes.json();
    assert(user2LikeData.liked === true, 'User 2 like succeeded');
    assert(user2LikeData.likesCount === 2, 'Likes count reflects both distinct users (count = 2)');

    // 9. Clean up test comments and users from database (strictly by exact created IDs only)
    console.log('\n9. Cleaning up test data...');
    const mongoose = require('mongoose');
    const Comment = require('../models/Comment');
    const User = require('../models/User');
    await mongoose.connect(process.env.MONGODB_URI);
    await Comment.deleteMany({ _id: { $in: [firstCommentId, flaggedCommentId, hindiCommentId, hinglishCommentId, bengaliCommentId, bengaliScriptCommentId] } });
    await User.deleteMany({ email: { $in: [testEmail1, testEmail2] } });
    await mongoose.disconnect();
    console.log('     Test records safely cleaned up.');

    console.log(`\n========================================`);
    console.log(`Results: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
