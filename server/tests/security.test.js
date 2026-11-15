// Security test suite for VideoVerse authentication and authorization
// Uses supertest to hit the Express application routes directly.

const path = require('path');
const dns = require('dns');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { app } = require('../index');

const User = require('../models/User');
const TrustedDevice = require('../models/TrustedDevice');

// Helper to create a regular test user with trusted device
async function createTestUser() {
  const password = 'TestPass123';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const user = new User({
    name: 'Test User',
    email: 'testuser@example.com',
    passwordHash,
    subscriptionTier: 'free',
    role: 'user',
  });
  await user.save();

  const rawDeviceToken = crypto.randomBytes(32).toString('hex');
  const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
  await TrustedDevice.create({
    userId: user._id,
    deviceTokenHash,
    deviceName: 'Test Trusted Device',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return { user, password, rawDeviceToken };
}

// Helper to create an admin test user
async function createTestAdminUser() {
  const password = 'AdminPass123';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const user = new User({
    name: 'Admin User',
    email: 'adminuser@example.com',
    passwordHash,
    subscriptionTier: 'free',
    role: 'admin',
  });
  await user.save();

  const rawDeviceToken = crypto.randomBytes(32).toString('hex');
  const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
  await TrustedDevice.create({
    userId: user._id,
    deviceTokenHash,
    deviceName: 'Admin Trusted Device',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return { user, password, rawDeviceToken };
}

describe('Authentication & Authorization Security Tests', () => {
  let testUser;
  let adminUser;
  let authCookie;
  let adminAuthCookie;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    // Clean up any test users from prior runs
    await User.deleteMany({
      email: { $in: ['testuser@example.com', 'adminuser@example.com', 'hacker@example.com', 'escalate@example.com'] },
    });
    await TrustedDevice.deleteMany({
      deviceName: { $in: ['Test Trusted Device', 'Admin Trusted Device'] },
    });

    const regularData = await createTestUser();
    testUser = { ...regularData.user.toObject(), password: regularData.password, rawDeviceToken: regularData.rawDeviceToken };

    const adminData = await createTestAdminUser();
    adminUser = { ...adminData.user.toObject(), password: adminData.password, rawDeviceToken: adminData.rawDeviceToken };
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await User.deleteMany({
        email: { $in: ['testuser@example.com', 'adminuser@example.com', 'hacker@example.com', 'escalate@example.com'] },
      });
      await TrustedDevice.deleteMany({
        deviceName: { $in: ['Test Trusted Device', 'Admin Trusted Device'] },
      });
      await mongoose.disconnect();
    }
  });

  // 1. Registration tests
  test('Register with existing email should return 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Another', email: testUser.email, password: 'newpass123' })
      .expect(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  test('Register ignores client-supplied role and enforces default role user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Hacker', email: 'hacker@example.com', password: 'password123', role: 'admin' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('user');

    const created = await User.findOne({ email: 'hacker@example.com' });
    expect(created.role).toBe('user');
  });

  // 2. Login credential tests
  test('Login with wrong password returns generic 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: 'wrongPassword' })
      .expect(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  test('Login with non-existent email returns generic 401 without user enumeration', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'somepassword' })
      .expect(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  test('Login from untrusted device triggers step-up OTP gating', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.tempToken).toBeDefined();
    // Auth cookie must NOT be set on untrusted device before OTP verification
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith('vv_token='))).toBe(false);
  });

  test('Login with trusted device cookie sets auth and refreshed device cookies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [`vv_device_token=${testUser.rawDeviceToken}`])
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    expect(res.body.success).toBe(true);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.includes('vv_token='))).toBe(true);
    expect(cookies.some((c) => c.includes('vv_device_token='))).toBe(true);
    authCookie = cookies.find((c) => c.startsWith('vv_token=')).split(';')[0];
  });

  test('Admin login with trusted device sets admin auth cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [`vv_device_token=${adminUser.rawDeviceToken}`])
      .send({ email: adminUser.email, password: adminUser.password })
      .expect(200);
    expect(res.body.success).toBe(true);
    const cookies = res.headers['set-cookie'] || [];
    adminAuthCookie = cookies.find((c) => c.startsWith('vv_token=')).split(';')[0];
  });

  // 3. Protected Route & JWT Security
  test('Access protected route without token should be 401', async () => {
    const res = await request(app).get('/api/auth/me').expect(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  test('Access protected route with valid token should succeed', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [authCookie])
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(testUser.email);
  });

  test('Access protected route with modified/forged token signature should be 401', async () => {
    // Generate token signed with wrong secret
    const forgedToken = jwt.sign({ id: testUser._id }, 'wrong_secret_key_12345', {
      expiresIn: '7d',
      algorithm: 'HS256',
    });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`vv_token=${forgedToken}`])
      .expect(401);
    expect(res.body.error).toMatch(/invalid authentication session/i);
  });

  test('Access protected route with expired token should be 401', async () => {
    // Generate already-expired token
    const expiredToken = jwt.sign({ id: testUser._id }, process.env.JWT_SECRET, {
      expiresIn: '-1s',
      algorithm: 'HS256',
    });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`vv_token=${expiredToken}`])
      .expect(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  // 4. Role-Based Access Control (RBAC)
  test('Admin-only route blocked for regular user with 403', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', [authCookie])
      .expect(403);
    expect(res.body.error).toMatch(/insufficient privileges/i);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('Admin-only route allowed for admin user with 200', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', [adminAuthCookie])
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.uptime).toBeGreaterThanOrEqual(0);
  });

  test('Profile update endpoint prevents client from self-assigning admin role', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', [authCookie])
      .send({ name: 'Attempted Admin', role: 'admin' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('user');

    const freshUser = await User.findById(testUser._id);
    expect(freshUser.role).toBe('user');
  });

  // 5. Video Calling Auth
  test('Video calling ICE servers endpoint blocks unauthenticated users with 401', async () => {
    const res = await request(app)
      .get('/api/calls/ice-servers')
      .expect(401);
    expect(res.body.error).toBeDefined();
  });

  test('Video calling ICE servers endpoint returns valid config for authenticated users', async () => {
    const res = await request(app)
      .get('/api/calls/ice-servers')
      .set('Cookie', [authCookie])
      .expect(200);
    expect(res.body.iceServers).toBeDefined();
    expect(Array.isArray(res.body.iceServers)).toBe(true);
  });

  // 6. Logout
  test('Logout clears both auth and device cookies', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [authCookie])
      .expect(200);
    const cleared = res.headers['set-cookie'] || [];
    expect(cleared.some((c) => c.includes('vv_token=') && c.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
    expect(cleared.some((c) => c.includes('vv_device_token=') && c.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
  });
});
