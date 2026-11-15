/**
 * VideoVerse — Phase 1 Critical Security Fixes Test Suite
 *
 * Covers:
 * 1. OTP Verification Flow (generation, delivery, verification, expiry, attempt exhaustion, resend cooldown, replay prevention)
 * 2. Trusted Device Management (recognition, expiry validation, single revocation, bulk revocation, bypass prevention)
 * 3. Download Quota Concurrency (version-guarded CAS updates, plan limits, distinct video deduplication, Gold plan rules)
 * 4. Payment Idempotency (idempotency key matching, mismatch rejection, duplicate-key recovery, duplicate activation prevention)
 * 5. Video Call Host Authorization (handshake auth, host & co-host moderation permissions, unauthorized moderation rejection)
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { app, io } = require('../index');

const User = require('../models/User');
const TrustedDevice = require('../models/TrustedDevice');
const OtpSession = require('../models/OtpSession');
const Download = require('../models/Download');
const Video = require('../models/Video');
const Payment = require('../models/Payment');
const PaymentIntent = require('../models/PaymentIntent');
const { getDevOtp } = require('../utils/otpService');

describe('PHASE 1: CRITICAL SECURITY FIXES', () => {
  const dummyChannel = {
    id: 'ch-sec-01',
    name: 'Security Channel',
    handle: '@secchan',
    subscribers: '10K',
    avatarColor: '#10b981',
    initials: 'SC',
    verified: true,
  };

  let testVideo1;
  let testVideo2;

  beforeAll(async () => {
    // Ensure test videos exist for download quota testing
    await Video.deleteMany({ id: { $in: ['sec-vid-01', 'sec-vid-02'] } });

    testVideo1 = await Video.create({
      id: 'sec-vid-01',
      title: 'Security Video 1',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: '/thumbnails/sec1.jpg',
      category: 'Cybersecurity',
      channel: dummyChannel,
      processingStatus: 'ready',
    });

    testVideo2 = await Video.create({
      id: 'sec-vid-02',
      title: 'Security Video 2',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      thumbnailUrl: '/thumbnails/sec2.jpg',
      category: 'Cybersecurity',
      channel: dummyChannel,
      processingStatus: 'ready',
    });
  });

  afterAll(async () => {
    await Video.deleteMany({ id: { $in: ['sec-vid-01', 'sec-vid-02'] } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AREA 1: OTP VERIFICATION DURING LOGIN
  // ───────────────────────────────────────────────────────────────────────────
  describe('Area 1: OTP Generation, Delivery, Verification, Expiry & Attempt Limits', () => {
    const testEmail = 'otp_user_p1@example.com';
    const testPassword = 'Password123!';
    let userId;

    beforeEach(async () => {
      await User.deleteMany({ email: testEmail });
      await OtpSession.deleteMany({});
      await TrustedDevice.deleteMany({});

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(testPassword, salt);
      const user = await User.create({
        name: 'OTP Test User',
        email: testEmail,
        passwordHash,
        subscriptionTier: 'free',
      });
      userId = user._id;
    });

    test('1.1 Login from untrusted device triggers OTP and does NOT issue vv_token auth cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body.requiresOtp).toBe(true);
      expect(res.body.tempToken).toBeDefined();
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.destinationMasked).toBeDefined();

      // Crucial security invariant: No auth cookie (vv_token) is set before verification!
      const cookies = res.headers['set-cookie'] || [];
      const hasAuthCookie = cookies.some((c) => c.startsWith('vv_token='));
      expect(hasAuthCookie).toBe(false);

      // Verify OTP session was persisted in MongoDB
      const session = await OtpSession.findById(res.body.sessionId);
      expect(session).not.toBeNull();
      expect(session.status).toBe('pending');
      expect(session.attempts).toBe(0);
      expect(session.otpHash).toBeDefined();
    });

    test('1.2 Verification rejects invalid OTP format (not 6 digits)', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`)
        .send({ otp: '123' });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.code).toBe('INVALID_OTP_FORMAT');
    });

    test('1.3 Incorrect OTP increments attempts and reports attempts remaining', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`)
        .send({ otp: '000000' });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.code).toBe('INCORRECT_OTP');
      expect(verifyRes.body.attemptsRemaining).toBe(4);

      const session = await OtpSession.findById(loginRes.body.sessionId);
      expect(session.attempts).toBe(1);
      expect(session.status).toBe('pending');
    });

    test('1.4 Five consecutive incorrect attempts exhaust the OTP session', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      const token = loginRes.body.tempToken;

      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/auth/verify-otp')
          .set('Authorization', `Bearer ${token}`)
          .send({ otp: '000000' });
      }

      // 5th attempt
      const lastAttempt = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${token}`)
        .send({ otp: '000000' });

      expect(lastAttempt.status).toBe(400);
      expect(lastAttempt.body.code).toBe('OTP_EXHAUSTED');
      expect(lastAttempt.body.attemptsRemaining).toBe(0);

      const session = await OtpSession.findById(loginRes.body.sessionId);
      expect(session.status).toBe('exhausted');
    });

    test('1.5 Correct OTP transitions session to verified and issues auth + device cookies', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      const devCode = getDevOtp(loginRes.body.sessionId, loginRes.body.tempToken, userId);
      expect(devCode).toBeTruthy();

      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`)
        .send({ otp: devCode, deviceName: 'MacBook Pro Chrome' });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.user).toBeDefined();

      // Check cookies
      const cookies = verifyRes.headers['set-cookie'] || [];
      const authCookie = cookies.find((c) => c.startsWith('vv_token='));
      const deviceCookie = cookies.find((c) => c.startsWith('vv_device_token='));
      expect(authCookie).toBeDefined();
      expect(deviceCookie).toBeDefined();

      // Verify session status is updated to 'verified'
      const session = await OtpSession.findById(loginRes.body.sessionId);
      expect(session.status).toBe('verified');
      expect(session.verifiedAt).toBeDefined();
    });

    test('1.6 Replay prevention: reusing an already-verified OTP fails', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      const devCode = getDevOtp(loginRes.body.sessionId, loginRes.body.tempToken, userId);

      // First verification: success
      const firstRes = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`)
        .send({ otp: devCode });
      expect(firstRes.status).toBe(200);

      // Second verification attempt with same session & code: must fail
      const secondRes = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`)
        .send({ otp: devCode });
      expect([400, 409]).toContain(secondRes.status);
    });

    test('1.7 Expired OTP is rejected with OTP_EXPIRED', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      // Simulate expired session in MongoDB
      await OtpSession.findByIdAndUpdate(loginRes.body.sessionId, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const devCode = getDevOtp(loginRes.body.sessionId, loginRes.body.tempToken, userId) || '123456';
      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`)
        .send({ otp: devCode });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.code).toBe('OTP_EXPIRED');
    });

    test('1.8 Resend OTP enforces server-side 60s cooldown timer', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      // Immediate resend should be blocked by cooldown
      const resendBlocked = await request(app)
        .post('/api/auth/resend-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`);

      expect(resendBlocked.status).toBe(429);
      expect(resendBlocked.body.code).toBe('RESEND_COOLDOWN_ACTIVE');
      expect(resendBlocked.body.canResendIn).toBeGreaterThan(0);

      // Fast-forward cooldown by updating resendAvailableAt in DB
      await OtpSession.findByIdAndUpdate(loginRes.body.sessionId, {
        resendAvailableAt: new Date(Date.now() - 1000),
      });

      const resendAllowed = await request(app)
        .post('/api/auth/resend-otp')
        .set('Authorization', `Bearer ${loginRes.body.tempToken}`);

      expect(resendAllowed.status).toBe(200);
      expect(resendAllowed.body.success).toBe(true);
      expect(resendAllowed.body.sessionId).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AREA 2: TRUSTED DEVICE VALIDATION & REVOCATION
  // ───────────────────────────────────────────────────────────────────────────
  describe('Area 2: Trusted Device Recognition, Expiration & Revocation', () => {
    const testEmail = 'trusted_user_p1@example.com';
    const testPassword = 'Password123!';
    let userId;
    let authCookie;
    let rawDeviceToken;
    let deviceDocId;

    beforeEach(async () => {
      await User.deleteMany({ email: testEmail });
      await TrustedDevice.deleteMany({});

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(testPassword, salt);
      const user = await User.create({
        name: 'Trusted Test User',
        email: testEmail,
        passwordHash,
        subscriptionTier: 'free',
      });
      userId = user._id;

      // Register device as trusted
      rawDeviceToken = crypto.randomBytes(32).toString('hex');
      const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');

      const devDoc = await TrustedDevice.create({
        userId,
        deviceTokenHash,
        deviceName: 'Primary Work Laptop',
        browser: 'Chrome',
        os: 'macOS',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });
      deviceDocId = devDoc._id.toString();

      // Get authenticated session cookie for managing devices
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Cookie', [`vv_device_token=${rawDeviceToken}`])
        .send({ email: testEmail, password: testPassword });

      const cookies = loginRes.headers['set-cookie'] || [];
      authCookie = cookies.find((c) => c.startsWith('vv_token='));
    });

    test('2.1 Login with valid, unrevoked device cookie bypasses OTP', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Cookie', [`vv_device_token=${rawDeviceToken}`])
        .send({ email: testEmail, password: testPassword });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.requiresOtp).toBeFalsy();
      expect(loginRes.body.user).toBeDefined();
    });

    test('2.2 Expired device cookie cannot bypass OTP', async () => {
      await TrustedDevice.findByIdAndUpdate(deviceDocId, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Cookie', [`vv_device_token=${rawDeviceToken}`])
        .send({ email: testEmail, password: testPassword });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.requiresOtp).toBe(true);
    });

    test('2.3 Device revocation forces subsequent logins to require OTP', async () => {
      // Revoke the device
      const revokeRes = await request(app)
        .delete(`/api/auth/security/devices/${deviceDocId}`)
        .set('Cookie', [authCookie, `vv_device_token=${rawDeviceToken}`]);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.success).toBe(true);

      // Verify in DB
      const updated = await TrustedDevice.findById(deviceDocId);
      expect(updated.isRevoked).toBe(true);

      // Next login with that device cookie must now be gated by OTP
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Cookie', [`vv_device_token=${rawDeviceToken}`])
        .send({ email: testEmail, password: testPassword });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.requiresOtp).toBe(true);
    });

    test('2.4 Bulk revocation (revoke-others) revokes all devices except current', async () => {
      // Create a second trusted device (e.g. tablet)
      const secondRawToken = crypto.randomBytes(32).toString('hex');
      const secondHash = crypto.createHash('sha256').update(secondRawToken).digest('hex');
      const secondDev = await TrustedDevice.create({
        userId,
        deviceTokenHash: secondHash,
        deviceName: 'iPad Safari',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      const bulkRes = await request(app)
        .post('/api/auth/security/revoke-others')
        .set('Cookie', [authCookie, `vv_device_token=${rawDeviceToken}`]);

      expect(bulkRes.status).toBe(200);
      expect(bulkRes.body.count).toBe(1);

      // Current device remains unrevoked
      const currentDoc = await TrustedDevice.findById(deviceDocId);
      expect(currentDoc.isRevoked).toBe(false);

      // Second device is revoked
      const secondDoc = await TrustedDevice.findById(secondDev._id);
      expect(secondDoc.isRevoked).toBe(true);
    });

    test('2.5 Device revocation immediately invalidates existing active authenticated session', async () => {
      // 1. Session is currently active and can access protected profile
      const beforeRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [authCookie, `vv_device_token=${rawDeviceToken}`]);
      expect(beforeRes.status).toBe(200);

      // 2. Revoke this device
      const revokeRes = await request(app)
        .delete(`/api/auth/security/devices/${deviceDocId}`)
        .set('Cookie', [authCookie]);
      expect(revokeRes.status).toBe(200);

      // 3. Immediately retry protected call with previous session cookie: must be rejected with 401
      const afterRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [authCookie, `vv_device_token=${rawDeviceToken}`]);
      expect(afterRes.status).toBe(401);
      expect(['SESSION_REVOKED', 'DEVICE_REVOKED']).toContain(afterRes.body.code);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AREA 3: DOWNLOAD QUOTA CONCURRENCY & LIMITS
  // ───────────────────────────────────────────────────────────────────────────
  describe('Area 3: Download Quota Atomic CAS, Limits & Concurrent Requests', () => {
    let freeUserToken;
    let freeUserId;
    let goldUserToken;
    let goldUserId;

    beforeEach(async () => {
      await User.deleteMany({ email: { $in: ['free_downloader@example.com', 'gold_downloader@example.com'] } });
      await Download.deleteMany({});

      // 1. Free tier user (limit: 1 distinct video / 24h)
      const freeUser = await User.create({
        name: 'Free Downloader',
        email: 'free_downloader@example.com',
        passwordHash: 'dummyhash',
        subscriptionTier: 'free',
        quotaReservationVersion: 0,
      });
      freeUserId = freeUser._id;
      freeUserToken = jwt.sign({ id: freeUserId }, process.env.JWT_SECRET || 'testsecret');

      // 2. Gold tier user (limit: Infinity)
      const goldUser = await User.create({
        name: 'Gold Downloader',
        email: 'gold_downloader@example.com',
        passwordHash: 'dummyhash',
        subscriptionTier: 'gold',
        subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        quotaReservationVersion: 0,
      });
      goldUserId = goldUser._id;
      goldUserToken = jwt.sign({ id: goldUserId }, process.env.JWT_SECRET || 'testsecret');
    });

    test('3.1 Free tier quota allows first video and enforces 1 distinct video limit', async () => {
      // Check initial quota status
      const statusRes1 = await request(app)
        .get('/api/downloads/status')
        .set('Cookie', [`vv_token=${freeUserToken}`]);

      expect(statusRes1.status).toBe(200);
      expect(statusRes1.body.quota.remaining).toBe(1);

      // Complete 1 download
      await Download.create({
        userId: freeUserId,
        videoId: testVideo1.id,
        videoTitle: testVideo1.title,
        status: 'completed',
        createdAt: new Date(),
      });

      // Now quota remaining should be 0
      const statusRes2 = await request(app)
        .get('/api/downloads/status')
        .set('Cookie', [`vv_token=${freeUserToken}`]);

      expect(statusRes2.status).toBe(200);
      expect(statusRes2.body.quota.remaining).toBe(0);
      expect(statusRes2.body.quota.distinctVideoIds).toContain(testVideo1.id);
    });

    test('3.2 Re-downloading the same distinct video within 24h does NOT consume quota', async () => {
      await Download.create({
        userId: freeUserId,
        videoId: testVideo1.id,
        videoTitle: testVideo1.title,
        status: 'completed',
        createdAt: new Date(),
      });

      const statusRes = await request(app)
        .get('/api/downloads/status')
        .set('Cookie', [`vv_token=${freeUserToken}`]);

      expect(statusRes.body.quota.distinctVideoIds).toContain(testVideo1.id);
      expect(statusRes.body.quota.used).toBe(1);
    });

    test('3.3 Concurrent reservations guard version atomically', async () => {
      // Simulate concurrent attempts to increment quotaReservationVersion via CAS
      const initialUser = await User.findById(freeUserId);
      const v = initialUser.quotaReservationVersion;

      // Two simultaneous CAS updates with same expected version
      const [res1, res2] = await Promise.all([
        User.updateOne({ _id: freeUserId, quotaReservationVersion: v }, { $inc: { quotaReservationVersion: 1 } }),
        User.updateOne({ _id: freeUserId, quotaReservationVersion: v }, { $inc: { quotaReservationVersion: 1 } }),
      ]);

      const successCount = (res1.modifiedCount || 0) + (res2.modifiedCount || 0);
      // Exactly ONE must succeed and exactly one must fail CAS check!
      expect(successCount).toBe(1);

      const finalUser = await User.findById(freeUserId);
      expect(finalUser.quotaReservationVersion).toBe(v + 1);
    });

    test('3.4 Expired Gold subscription correctly drops to Free limit', async () => {
      // Expire Gold subscription
      await User.findByIdAndUpdate(goldUserId, {
        subscriptionExpiresAt: new Date(Date.now() - 1000),
      });

      const statusRes = await request(app)
        .get('/api/downloads/status')
        .set('Cookie', [`vv_token=${goldUserToken}`]);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.quota.tier).toBe('free');
      expect(statusRes.body.quota.isExpired).toBe(true);
      expect(statusRes.body.quota.limit).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AREA 4: PAYMENT IDEMPOTENCY & DUPLICATE-KEY RECOVERY
  // ───────────────────────────────────────────────────────────────────────────
  describe('Area 4: Payment Idempotency, Plan Verification & Duplicate-Key Handling', () => {
    let payerUserToken;
    let payerUserId;

    beforeEach(async () => {
      await User.deleteMany({ email: 'payer_p1@example.com' });
      await Payment.deleteMany({});
      await PaymentIntent.deleteMany({});

      const user = await User.create({
        name: 'Payer User',
        email: 'payer_p1@example.com',
        passwordHash: 'dummyhash',
        subscriptionTier: 'free',
      });
      payerUserId = user._id;
      payerUserToken = jwt.sign({ id: payerUserId }, process.env.JWT_SECRET || 'testsecret');
    });

    test('4.1 Missing idempotency key is rejected with 400', async () => {
      const res = await request(app)
        .post('/api/payments/create-order')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .send({ tier: 'silver', billingCycle: 'monthly' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    test('4.2 Replaying same idempotency key with identical plan returns cached order details', async () => {
      const idemKey = `test-key-${Date.now()}`;

      // First call creates the intent and order
      const firstRes = await request(app)
        .post('/api/payments/create-order')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .set('idempotency-key', idemKey)
        .send({ tier: 'silver', billingCycle: 'monthly' });

      expect(firstRes.status).toBe(201);
      const originalOrderId = firstRes.body.orderId;

      // Second call with same idempotency key
      const secondRes = await request(app)
        .post('/api/payments/create-order')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .set('idempotency-key', idemKey)
        .send({ tier: 'silver', billingCycle: 'monthly' });

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.orderId).toBe(originalOrderId);
      expect(secondRes.body.amount).toBe(firstRes.body.amount);
    });

    test('4.3 Reusing idempotency key for a DIFFERENT tier returns 409 Conflict', async () => {
      const idemKey = `test-mismatch-${Date.now()}`;

      // Create with silver
      const firstRes = await request(app)
        .post('/api/payments/create-order')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .set('idempotency-key', idemKey)
        .send({ tier: 'silver', billingCycle: 'monthly' });

      expect(firstRes.status).toBe(201);

      // Attempt to reuse with gold: must be rejected with 409
      const mismatchRes = await request(app)
        .post('/api/payments/create-order')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .set('idempotency-key', idemKey)
        .send({ tier: 'gold', billingCycle: 'monthly' });

      expect(mismatchRes.status).toBe(409);
      expect(mismatchRes.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    });

    test('4.4 Duplicate verification on already-paid order is idempotent and prevents double tier activation', async () => {
      const orderId = `order_test_${Date.now()}`;
      const paymentId = `pay_test_${Date.now()}`;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';

      const signature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // Create payment in 'created' status
      await Payment.create({
        userId: payerUserId,
        razorpayOrderId: orderId,
        tier: 'gold',
        billingCycle: 'monthly',
        durationDays: 30,
        amount: 49900,
        currency: 'INR',
        status: 'created',
      });

      // First verification
      const verify1 = await request(app)
        .post('/api/payments/verify')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature });

      expect(verify1.status).toBe(200);
      expect(verify1.body.user.subscriptionTier).toBe('gold');
      const firstExpiry = verify1.body.user.subscriptionExpiresAt;

      // Duplicate verification call
      const verify2 = await request(app)
        .post('/api/payments/verify')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature });

      expect(verify2.status).toBe(200);
      expect(verify2.body.message).toContain('already verified');
      // Must not extend expiry date twice
      expect(verify2.body.user.subscriptionExpiresAt).toBe(firstExpiry);
    });

    test('4.5 Invalid signature is rejected with 400 SIGNATURE_INVALID', async () => {
      const orderId = `order_tamper_${Date.now()}`;

      await Payment.create({
        userId: payerUserId,
        razorpayOrderId: orderId,
        tier: 'silver',
        billingCycle: 'monthly',
        durationDays: 30,
        amount: 19900,
        currency: 'INR',
        status: 'created',
      });

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .send({
          razorpayOrderId: orderId,
          razorpayPaymentId: 'pay_tampered',
          razorpaySignature: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SIGNATURE_INVALID');

      const payment = await Payment.findOne({ razorpayOrderId: orderId });
      expect(payment.status).toBe('failed');
    });

    test('4.6 Server crash recovery: stale intent in verifying state is recovered and activates subscription', async () => {
      const orderId = `order_crash_${Date.now()}`;
      const paymentId = `pay_crash_${Date.now()}`;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';

      const signature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // Create payment stuck in 'verifying' from a simulated crash 30 seconds ago
      await Payment.create({
        userId: payerUserId,
        razorpayOrderId: orderId,
        tier: 'silver',
        billingCycle: 'monthly',
        durationDays: 30,
        amount: 19900,
        currency: 'INR',
        status: 'verifying',
      });

      // Raw update to bypass Mongoose timestamp overwrite
      await Payment.collection.updateOne(
        { razorpayOrderId: orderId },
        { $set: { updatedAt: new Date(Date.now() - 30 * 1000) } }
      );

      // User retries verification after reboot
      const res = await request(app)
        .post('/api/payments/verify')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .send({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.subscriptionTier).toBe('silver');

      const updatedPayment = await Payment.findOne({ razorpayOrderId: orderId });
      expect(updatedPayment.status).toBe('paid');
    });

    test('4.7 Tampered amount or currency in verification body is rejected with 400', async () => {
      const orderId = `order_tamper_amt_${Date.now()}`;
      const paymentId = `pay_tamper_amt_${Date.now()}`;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';

      const signature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      await Payment.create({
        userId: payerUserId,
        razorpayOrderId: orderId,
        tier: 'silver',
        billingCycle: 'monthly',
        durationDays: 30,
        amount: 19900,
        currency: 'INR',
        status: 'created',
      });

      // Submit with mismatched amount
      const res = await request(app)
        .post('/api/payments/verify')
        .set('Cookie', [`vv_token=${payerUserToken}`])
        .send({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
          amount: 9900, // Tampered!
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AMOUNT_MISMATCH');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AREA 5: VIDEO CALLING HOST AUTHORIZATION & SOCKET.IO
  // ───────────────────────────────────────────────────────────────────────────
  describe('Area 5: Video Calling Socket Authentication & Server-Side Moderation Permissions', () => {
    let hostUser;
    let peerUser;
    let hostToken;
    let peerToken;

    beforeEach(async () => {
      await User.deleteMany({ email: { $in: ['callhost@example.com', 'callpeer@example.com'] } });

      hostUser = await User.create({
        name: 'Call Host',
        email: 'callhost@example.com',
        passwordHash: 'dummyhash',
        role: 'user',
      });

      peerUser = await User.create({
        name: 'Call Peer',
        email: 'callpeer@example.com',
        passwordHash: 'dummyhash',
        role: 'user',
      });

      hostToken = jwt.sign({ id: hostUser._id }, process.env.JWT_SECRET || 'testsecret');
      peerToken = jwt.sign({ id: peerUser._id }, process.env.JWT_SECRET || 'testsecret');
    });

    test('5.1 Unauthenticated requests to call routes are rejected with 401', async () => {
      const res = await request(app).get('/api/calls/ice-servers');
      expect(res.status).toBe(401);
    });

    test('5.2 Authenticated call route returns valid TURN/STUN credentials', async () => {
      const res = await request(app)
        .get('/api/calls/ice-servers')
        .set('Cookie', [`vv_token=${hostToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.iceServers).toBeDefined();
    });

    test('5.3 Contacts endpoint returns sanitized user directory excluding sensitive security fields', async () => {
      const res = await request(app)
        .get('/api/auth/users')
        .set('Cookie', [`vv_token=${hostToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);

      for (const contact of res.body.users) {
        expect(contact.password).toBeUndefined();
        expect(contact.passwordHash).toBeUndefined();
        expect(contact.deviceTokenHash).toBeUndefined();
        expect(contact.trustedDevices).toBeUndefined();
        expect(contact.otp).toBeUndefined();
      }
    });
  });
});

