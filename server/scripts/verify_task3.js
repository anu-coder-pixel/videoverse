/**
 * Verification Script for Task 3: Subscriptions with Razorpay Payments
 * Tests end-to-end security, quotas, signatures, idempotency, ownership, and persistence.
 */

const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Payment = require('../models/Payment');
const User = require('../models/User');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          if (data) json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function parseCookie(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return '';
  if (Array.isArray(setCookie)) {
    return setCookie.map(c => c.split(';')[0]).join('; ');
  }
  return setCookie.split(';')[0];
}

async function runTests() {
  const results = {
    passed: [],
    failed: [],
    skipped: [],
  };

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB for verification assertions.');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Check Razorpay test keys configuration (Safe, no secret exposure)
  // ───────────────────────────────────────────────────────────────────────────
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const isPlaceholder = keyId.includes('REPLACE_WITH_YOUR_KEY_ID') || keySecret.includes('REPLACE_WITH_YOUR_KEY_SECRET');
  const isKeyConfigured = Boolean(keyId && keySecret && !isPlaceholder && keyId.startsWith('rzp_test_'));

  if (!isKeyConfigured) {
    results.skipped.push({
      test: '1. Razorpay Live/Dashboard Test Credentials',
      reason: 'Keys are configured with default placeholder prefix (rzp_test_REPLACE_WITH_YOUR_KEY_ID). Live calls to Razorpay orders API require genuine test keys from Razorpay dashboard.',
    });
  } else {
    results.passed.push('1. Razorpay test keys configured with valid test prefix.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Setup: Register two test users (User A and User B)
  // ───────────────────────────────────────────────────────────────────────────
  const rand = Math.floor(Math.random() * 100000);
  const userAPass = 'P@ssword1234!';
  const userAEmail = `test_user_a_${rand}@example.com`;
  const userBEmail = `test_user_b_${rand}@example.com`;

  const regARes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { name: 'User A', email: userAEmail, password: userAPass });

  const cookieA = parseCookie(regARes);
  const userAId = regARes.body.user.id || regARes.body.user._id;

  const regBRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { name: 'User B', email: userBEmail, password: userAPass });

  const cookieB = parseCookie(regBRes);
  const userBId = regBRes.body.user.id || regBRes.body.user._id;

  if (regARes.statusCode === 201 && regBRes.statusCode === 201) {
    results.passed.push('Auth Setup: Created User A and User B with default Free tier.');
  } else {
    results.failed.push('Auth Setup: Failed to create test users.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Free User Quota Verification (5 videos/day)
  // ───────────────────────────────────────────────────────────────────────────
  const quotaFreeRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/downloads/status',
    method: 'GET',
    headers: { Cookie: cookieA },
  });

  if (quotaFreeRes.statusCode === 200 && quotaFreeRes.body.quota.limit === 5) {
    results.passed.push('2. Free user quota correctly enforced at 5 distinct videos per 24 hours.');
  } else {
    results.failed.push(`2. Free user quota check failed: expected limit 5, got ${quotaFreeRes.body?.quota?.limit}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Validation on Create Order (Invalid Tier & Auth Required)
  // ───────────────────────────────────────────────────────────────────────────
  const unauthOrderRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/create-order',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { tier: 'premium' });

  const invalidTierRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/create-order',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  }, { tier: 'invalid_super_tier' });

  if (unauthOrderRes.statusCode === 401 && invalidTierRes.statusCode === 400 && invalidTierRes.body.code === 'INVALID_TIER') {
    results.passed.push('3. Server rejects unauthenticated requests (401) and invalid tiers (400 INVALID_TIER).');
  } else {
    results.failed.push('3. Order creation validation failed.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: Attempt to Upgrade Without Valid Payment / Tampered Signature
  // ───────────────────────────────────────────────────────────────────────────
  const fakeOrderId = `order_${rand}_fake`;
  await Payment.create({
    userId: userAId,
    razorpayOrderId: fakeOrderId,
    tier: 'premium',
    amount: 19900,
    currency: 'INR',
    status: 'created',
  });

  const tamperedSigRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  }, {
    razorpayOrderId: fakeOrderId,
    razorpayPaymentId: 'pay_tampered_123',
    razorpaySignature: 'tampered_invalid_signature_hex_code_123',
  });

  const userAAfterTamper = await User.findById(userAId);
  if (tamperedSigRes.statusCode === 400 && userAAfterTamper.subscriptionTier === 'free') {
    results.passed.push('4. Tampered / invalid payment signature rejected (400), tier remained Free in MongoDB.');
  } else {
    results.failed.push(`4. Tampered signature test failed: status ${tamperedSigRes.statusCode}, tier ${userAAfterTamper.subscriptionTier}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: Order Ownership Check (User B cannot verify User A's order)
  // ───────────────────────────────────────────────────────────────────────────
  const ownershipRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieB },
  }, {
    razorpayOrderId: fakeOrderId,
    razorpayPaymentId: 'pay_test_ownership',
    razorpaySignature: 'some_sig',
  });

  const userBAfterOwnership = await User.findById(userBId);
  if (ownershipRes.statusCode === 403 && userBAfterOwnership.subscriptionTier === 'free') {
    results.passed.push('5. Order ownership check enforced: User B cannot verify User A\'s order (403 Forbidden).');
  } else {
    results.failed.push(`5. Order ownership check failed: status ${ownershipRes.statusCode}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 6: Successful Verification & MongoDB Persistence for Premium
  // ───────────────────────────────────────────────────────────────────────────
  const validOrderId = `order_${rand}_valid_prem`;
  const paymentRecord = await Payment.create({
    userId: userAId,
    razorpayOrderId: validOrderId,
    tier: 'premium',
    amount: 19900,
    currency: 'INR',
    status: 'created',
  });

  const validPaymentId = `pay_${rand}_prem_success`;
  // Compute authentic HMAC-SHA256 signature according to Razorpay specification:
  // HMAC_SHA256(orderId + "|" + paymentId, KEY_SECRET)
  const validSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${validOrderId}|${validPaymentId}`)
    .digest('hex');

  const verifySuccessRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  }, {
    razorpayOrderId: validOrderId,
    razorpayPaymentId: validPaymentId,
    razorpaySignature: validSignature,
  });

  const userAInDB = await User.findById(userAId);
  const paymentInDB = await Payment.findOne({ razorpayOrderId: validOrderId });

  if (
    verifySuccessRes.statusCode === 200 &&
    verifySuccessRes.body.success === true &&
    verifySuccessRes.body.user.subscriptionTier === 'premium' &&
    userAInDB.subscriptionTier === 'premium' &&
    paymentInDB.status === 'paid'
  ) {
    results.passed.push('6. Valid HMAC signature verification succeeded: MongoDB updated to Premium, Payment marked paid.');
  } else {
    results.failed.push('6. Verification or MongoDB persistence failed for Premium.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 7: Premium User Quota Verification (25 videos/day)
  // ───────────────────────────────────────────────────────────────────────────
  const quotaPremRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/downloads/status',
    method: 'GET',
    headers: { Cookie: cookieA },
  });

  if (quotaPremRes.statusCode === 200 && quotaPremRes.body.quota.limit === 25) {
    results.passed.push('7. Premium user quota correctly upgraded to 25 distinct videos per 24 hours.');
  } else {
    results.failed.push(`7. Premium user quota check failed: expected limit 25, got ${quotaPremRes.body?.quota?.limit}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 8: Plan Persistence After Fresh Login (New Session)
  // ───────────────────────────────────────────────────────────────────────────
  const freshLoginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  }, { email: userAEmail, password: userAPass });

  if (freshLoginRes.statusCode === 200 && freshLoginRes.body.user.subscriptionTier === 'premium') {
    results.passed.push('8. Plan persistence verified: fresh login retrieves Premium tier from MongoDB in safe object.');
  } else {
    results.failed.push('8. Plan persistence after fresh login failed.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 9: Duplicate Verification (Idempotency)
  // ───────────────────────────────────────────────────────────────────────────
  const duplicateVerifyRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  }, {
    razorpayOrderId: validOrderId,
    razorpayPaymentId: validPaymentId,
    razorpaySignature: validSignature,
  });

  if (
    duplicateVerifyRes.statusCode === 200 &&
    duplicateVerifyRes.body.success === true &&
    duplicateVerifyRes.body.message.includes('Payment already verified')
  ) {
    results.passed.push('9. Duplicate verification is idempotent: returned success with friendly notice and no data corruption.');
  } else {
    results.failed.push('9. Duplicate verification idempotency test failed.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 10: Upgrade from Premium to VIP & VIP Quota Verification (Unlimited)
  // ───────────────────────────────────────────────────────────────────────────
  const vipOrderId = `order_${rand}_valid_vip`;
  await Payment.create({
    userId: userAId,
    razorpayOrderId: vipOrderId,
    tier: 'vip',
    amount: 49900,
    currency: 'INR',
    status: 'created',
  });

  const vipPaymentId = `pay_${rand}_vip_success`;
  const vipSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${vipOrderId}|${vipPaymentId}`)
    .digest('hex');

  const verifyVipRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  }, {
    razorpayOrderId: vipOrderId,
    razorpayPaymentId: vipPaymentId,
    razorpaySignature: vipSignature,
  });

  const quotaVipRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/downloads/status',
    method: 'GET',
    headers: { Cookie: cookieA },
  });

  const isVipUnlimited =
    quotaVipRes.body?.quota?.limit === null ||
    quotaVipRes.body?.quota?.limit === Infinity ||
    quotaVipRes.body?.quota?.remaining === null ||
    quotaVipRes.body?.quota?.isUnlimited === true;

  if (
    verifyVipRes.statusCode === 200 &&
    verifyVipRes.body.user.subscriptionTier === 'vip' &&
    isVipUnlimited
  ) {
    results.passed.push('10. VIP upgrade succeeded: user upgraded to VIP and received unlimited download quota.');
  } else {
    results.failed.push(`10. VIP upgrade or quota failed: status ${verifyVipRes.statusCode}, quota: ${JSON.stringify(quotaVipRes.body?.quota)}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 11: Payment History Endpoint
  // ───────────────────────────────────────────────────────────────────────────
  const historyRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/payments/history',
    method: 'GET',
    headers: { Cookie: cookieA },
  });

  if (
    historyRes.statusCode === 200 &&
    Array.isArray(historyRes.body.payments) &&
    historyRes.body.payments.length >= 2
  ) {
    // Check that sensitive signature is NOT exposed in history
    const hasExposedSignature = historyRes.body.payments.some(p => p.razorpaySignature);
    if (!hasExposedSignature) {
      results.passed.push('11. Payment history endpoint returns user payment records with sensitive signatures omitted.');
    } else {
      results.failed.push('11. Payment history endpoint exposes raw razorpaySignature.');
    }
  } else {
    results.failed.push('11. Payment history retrieval failed.');
  }

  // Clean up temporary test accounts
  await User.deleteMany({ _id: { $in: [userAId, userBId] } });
  await Payment.deleteMany({ userId: { $in: [userAId, userBId] } });
  console.log('Cleaned up verification test records.');

  await mongoose.disconnect();
  console.log('\n================ VERIFICATION SUMMARY ================');
  console.log(JSON.stringify(results, null, 2));
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
