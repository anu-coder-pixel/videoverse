// Verify production rate limiting for comments
// Tests commentPostLimiter middleware directly with express test app

const express = require('express');
const request = require('supertest');
const { commentPostLimiter } = require('../middleware/rateLimiter');

async function testRateLimiting() {
  console.log('🧪 Testing Production Comment Rate Limiter...');

  const app = express();
  app.use(express.json());

  // Dummy endpoint with rate limiter
  app.post('/test-comment-limit', commentPostLimiter, (req, res) => {
    res.json({ success: true, count: req.body.index });
  });

  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  let passed = true;

  try {
    console.log('  Sending 15 comments within window (should succeed)...');
    for (let i = 1; i <= 15; i++) {
      const res = await request(app)
        .post('/test-comment-limit')
        .send({ index: i });
      if (res.status !== 200) {
        console.error(`  ❌ Failed at attempt ${i}: received status ${res.status}`);
        passed = false;
        break;
      }
    }

    if (passed) {
      console.log('  ✅ PASS: 15 consecutive comments succeeded with HTTP 200');

      console.log('  Sending 16th comment (should be blocked with HTTP 429)...');
      const res16 = await request(app)
        .post('/test-comment-limit')
        .send({ index: 16 });

      if (res16.status === 429) {
        console.log('  ✅ PASS: 16th comment blocked with HTTP 429 Too Many Requests');
        console.log(`     Response message: "${res16.body.error}"`);
      } else {
        console.error(`  ❌ FAIL: Expected 429 but received ${res16.status}`);
        passed = false;
      }
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
  }

  if (!passed) process.exit(1);
  console.log('🎉 Production Rate Limiting successfully verified!\n');
}

testRateLimiting().catch(err => {
  console.error(err);
  process.exit(1);
});

