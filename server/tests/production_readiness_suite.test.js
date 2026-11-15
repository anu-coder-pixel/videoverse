/**
 * VideoVerse — Phase 4 Step 4: Production Readiness & Health Checks Test Suite
 *
 * Verifies:
 * 1. Missing mandatory environment variables.
 * 2. Invalid JWT secret length (< 32 chars).
 * 3. Valid development configuration.
 * 4. Valid production configuration.
 * 5. Missing optional service configuration (SMTP, Razorpay, TURN).
 * 6. Database-connected health response (HTTP 200, status: 'ok', database: 'connected').
 * 7. Database-disconnected health response (HTTP 503, status: 'degraded', database: 'disconnected').
 * 8. No secret leakage in health responses.
 * 9. Startup validation failure behavior (assertEnv throwing descriptive errors).
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { validateEnv, assertEnv } = require('../config/validateEnv');
const { app } = require('../index');

describe('Phase 4 Step 4: Environment Validation & Production Health Checks', () => {
  const baseValidDevEnv = {
    NODE_ENV: 'development',
    PORT: '5000',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/videoverse_test',
    JWT_SECRET: 'test_super_secret_jwt_key_that_is_at_least_32_characters_long',
  };

  describe('Centralized Environment Validation (validateEnv & assertEnv)', () => {
    it('1. should reject when MONGODB_URI is missing or has invalid format', () => {
      const missingUri = validateEnv({ ...baseValidDevEnv, MONGODB_URI: '' });
      expect(missingUri.valid).toBe(false);
      expect(missingUri.errors.some(e => e.includes('MONGODB_URI is required'))).toBe(true);

      const invalidProtocol = validateEnv({ ...baseValidDevEnv, MONGODB_URI: 'http://localhost:27017' });
      expect(invalidProtocol.valid).toBe(false);
      expect(invalidProtocol.errors.some(e => e.includes('must start with'))).toBe(true);
    });

    it('2. should reject when JWT_SECRET is missing or shorter than 32 characters', () => {
      const missingJwt = validateEnv({ ...baseValidDevEnv, JWT_SECRET: '' });
      expect(missingJwt.valid).toBe(false);
      expect(missingJwt.errors.some(e => e.includes('JWT_SECRET is required'))).toBe(true);

      const shortJwt = validateEnv({ ...baseValidDevEnv, JWT_SECRET: 'short_key_123' });
      expect(shortJwt.valid).toBe(false);
      expect(shortJwt.errors.some(e => e.includes('at least 32 characters long'))).toBe(true);
    });

    it('3. should accept a valid development environment configuration', () => {
      const res = validateEnv(baseValidDevEnv);
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);
      expect(res.config.mongoConfigured).toBe(true);
      expect(res.config.jwtConfigured).toBe(true);
    });

    it('4. should require valid CLIENT_URL in production environment', () => {
      const prodMissingClient = validateEnv({
        ...baseValidDevEnv,
        NODE_ENV: 'production',
        CLIENT_URL: '',
      });
      expect(prodMissingClient.valid).toBe(false);
      expect(prodMissingClient.errors.some(e => e.includes('CLIENT_URL is required in production'))).toBe(true);

      const prodValidClient = validateEnv({
        ...baseValidDevEnv,
        NODE_ENV: 'production',
        CLIENT_URL: 'https://videoverse.example.com',
      });
      expect(prodValidClient.valid).toBe(true);
      expect(prodValidClient.errors.length).toBe(0);
    });

    it('5. should enforce consistency when optional services are partially configured', () => {
      // Partial SMTP: host provided without user or pass
      const partialSmtp = validateEnv({
        ...baseValidDevEnv,
        SMTP_HOST: 'smtp.sendgrid.net',
      });
      expect(partialSmtp.valid).toBe(false);
      expect(partialSmtp.errors.some(e => e.includes('SMTP_USER is required'))).toBe(true);
      expect(partialSmtp.errors.some(e => e.includes('SMTP_PASS is required'))).toBe(true);

      // Partial Razorpay: key provided without secret
      const partialRazorpay = validateEnv({
        ...baseValidDevEnv,
        RAZORPAY_KEY_ID: 'rzp_live_1234567890',
      });
      expect(partialRazorpay.valid).toBe(false);
      expect(partialRazorpay.errors.some(e => e.includes('RAZORPAY_KEY_SECRET is required'))).toBe(true);

      // Partial TURN: URL provided without shared secret
      const partialTurn = validateEnv({
        ...baseValidDevEnv,
        TURN_SERVER_URL: 'turn:turn.example.com:3478',
      });
      expect(partialTurn.valid).toBe(false);
      expect(partialTurn.errors.some(e => e.includes('TURN_SHARED_SECRET is required'))).toBe(true);
    });

    it('6. assertEnv should throw a formatted error on invalid configuration and return safe config on success', () => {
      expect(() => {
        assertEnv({ NODE_ENV: 'development' });
      }).toThrow(/Environment Validation Failed/);

      let config;
      expect(() => {
        config = assertEnv(baseValidDevEnv);
      }).not.toThrow();
      expect(config).toBeDefined();
      expect(config.mongoConfigured).toBe(true);
      expect(config.jwtConfigured).toBe(true);
    });
  });

  describe('Database-Aware Health Check (GET /api/health)', () => {
    it('7. should return HTTP 200 with database: "connected" when mongoose is connected', async () => {
      // Ensure mongoose is connected
      if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/videoverse_test');
      }

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('database', 'connected');
      expect(res.body).toHaveProperty('uptime');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body).toHaveProperty('environment');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('version');
    });

    it('8. should return HTTP 503 with database: "disconnected" when mongoose is disconnected', async () => {
      // Set test override on app.locals to simulate database disconnection safely
      app.locals.dbReadyStateOverride = 0;

      try {
        const res = await request(app).get('/api/health');

        expect(res.status).toBe(503);
        expect(res.body).toHaveProperty('status', 'degraded');
        expect(res.body).toHaveProperty('database', 'disconnected');
        expect(res.body).toHaveProperty('uptime');
        expect(res.body).toHaveProperty('environment');
        expect(res.body).toHaveProperty('timestamp');
      } finally {
        delete app.locals.dbReadyStateOverride;
      }
    });

    it('9. should NEVER leak database credentials, connection strings, or system paths in health responses', async () => {
      const res = await request(app).get('/api/health');
      const responseString = JSON.stringify(res.body);

      // Verify no sensitive keys exist
      expect(responseString).not.toContain('password');
      expect(responseString).not.toContain('secret');
      expect(responseString).not.toContain('mongodb://');
      expect(responseString).not.toContain('mongodb+srv://');
      expect(responseString).not.toContain('C:\\');
      expect(responseString).not.toContain('/home/');
    });
  });
});
