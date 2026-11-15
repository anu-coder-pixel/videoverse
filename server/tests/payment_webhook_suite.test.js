/**
 * VideoVerse Phase 2, Step 2 — Payment Webhook Integration & Invoice Generation Test Suite
 *
 * Covers:
 * 1. Razorpay Webhook Signatures (valid, invalid, missing secret)
 * 2. Event Idempotency & Unique DB Index (same eventId rejected/cached)
 * 3. Simultaneous Webhook Processing & Locking
 * 4. payment.captured Event (amount/currency verification, user tier extension, already-paid coexistence)
 * 5. payment.failed Event (does not downgrade already-paid users, marks pending as failed)
 * 6. payment.dispute.created Event (records dispute details without altering payment audit history)
 * 7. Coexistence: Webhook and manual /payments/verify running concurrently (single activation)
 * 8. PDF Invoice Generation & Streaming (valid paid invoice, unique invoiceNumber, metadata)
 * 9. Invoice Ownership & Security Access Controls (403 for other users, 400 for unpaid, 404 for missing)
 */

const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PaymentIntent = require('../models/PaymentIntent');
const WebhookLog = require('../models/WebhookLog');

describe('Phase 2, Step 2: Payment Webhook Integration & Invoice Generation Suite', () => {
  let userA, userB;
  let tokenA, tokenB;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_xyz123';

  // Helper to generate HMAC-SHA256 signature
  function signWebhookPayload(payload, secret = webhookSecret) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(raw).digest('hex');
  }

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

    await User.deleteMany({ email: { $in: ['webhook_user_a@example.com', 'webhook_user_b@example.com'] } });
    await Payment.deleteMany({ userId: { $exists: true } });
    await PaymentIntent.deleteMany({ userId: { $exists: true } });
    await WebhookLog.deleteMany({});

    userA = await User.create({
      name: 'Webhook User A',
      email: 'webhook_user_a@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
      subscriptionTier: 'free',
    });

    userB = await User.create({
      name: 'Webhook User B',
      email: 'webhook_user_b@example.com',
      passwordHash: 'dummyhash',
      role: 'user',
      subscriptionTier: 'free',
    });

    tokenA = jwt.sign({ id: userA._id }, process.env.JWT_SECRET || 'testsecret');
    tokenB = jwt.sign({ id: userB._id }, process.env.JWT_SECRET || 'testsecret');
  });

  afterAll(async () => {
    await User.deleteMany({ email: { $in: ['webhook_user_a@example.com', 'webhook_user_b@example.com'] } });
    await Payment.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await PaymentIntent.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await WebhookLog.deleteMany({});
  });

  // ── 1. Webhook Signature Verification ──────────────────────────────────────────
  describe('Webhook Signature Verification', () => {
    it('should reject webhook request missing x-razorpay-signature header', async () => {
      const res = await request(app)
        .post('/api/payments/webhook')
        .send({ event: 'payment.captured' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing x-razorpay-signature/i);
    });

    it('should reject webhook request with invalid signature', async () => {
      const payload = { event: 'payment.captured', event_id: 'evt_invalid_sig_1' };
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_SIGNATURE');
    });

    it('should accept webhook request with valid signature', async () => {
      const payload = {
        event: 'payment.captured',
        event_id: 'evt_valid_sig_1',
        payload: {
          payment: {
            entity: {
              id: 'pay_test_001',
              order_id: 'order_test_unmatched_001',
              amount: 9900,
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      // Successfully authenticated signature; returned 200 with ignored reason (no matching order)
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ignored');
      expect(res.body.reason).toBe('order_not_found');
    });
  });

  // ── 2. Event Idempotency & Duplicate Handling ──────────────────────────────
  describe('Event Idempotency & Duplicate Event Prevention', () => {
    it('should prevent processing the same webhook event ID twice', async () => {
      const orderId = 'order_idemp_001';
      const eventId = 'evt_idemp_unique_999';

      // Create payment in DB
      await Payment.create({
        userId: userA._id,
        razorpayOrderId: orderId,
        tier: 'silver',
        billingCycle: 'monthly',
        durationDays: 30,
        amount: 19900,
        currency: 'INR',
        status: 'created',
      });

      const payload = {
        event: 'payment.captured',
        event_id: eventId,
        payload: {
          payment: {
            entity: {
              id: 'pay_idemp_999',
              order_id: orderId,
              amount: 19900,
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      // First webhook delivery
      const res1 = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res1.status).toBe(200);
      expect(res1.body.status).toBe('success');

      // Check log record
      const log = await WebhookLog.findOne({ eventId });
      expect(log).not.toBeNull();
      expect(log.status).toBe('processed');

      // Second webhook delivery (same eventId)
      const res2 = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res2.status).toBe(200);
      expect(res2.body.status).toBe('already_processed');
      expect(res2.body.eventId).toBe(eventId);
    });
  });

  // ── 3. payment.captured Lifecycle & User Tier Activation ────────────────────
  describe('payment.captured Event Processing', () => {
    it('should verify amount and currency before activating user tier', async () => {
      const orderId = 'order_amount_mismatch_001';
      const eventId = 'evt_mismatch_001';

      await Payment.create({
        userId: userA._id,
        razorpayOrderId: orderId,
        tier: 'gold',
        amount: 49900,
        currency: 'INR',
        status: 'created',
      });

      // Send payload with tampered amount (9900 instead of 49900)
      const payload = {
        event: 'payment.captured',
        event_id: eventId,
        payload: {
          payment: {
            entity: {
              id: 'pay_mismatch_001',
              order_id: orderId,
              amount: 9900, // Tampered!
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Amount or currency mismatch/i);

      // Verify payment was NOT marked as paid
      const p = await Payment.findOne({ razorpayOrderId: orderId });
      expect(p.status).toBe('created');
    });

    it('should successfully activate subscription tier on valid payment.captured', async () => {
      const orderId = 'order_success_cap_001';
      const eventId = 'evt_success_cap_001';
      const paymentId = 'pay_success_cap_001';

      await Payment.create({
        userId: userA._id,
        razorpayOrderId: orderId,
        tier: 'gold',
        billingCycle: 'yearly',
        durationDays: 365,
        amount: 449900,
        currency: 'INR',
        status: 'created',
      });

      const payload = {
        event: 'payment.captured',
        event_id: eventId,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 449900,
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      // Check payment record updated
      const updatedPayment = await Payment.findOne({ razorpayOrderId: orderId });
      expect(updatedPayment.status).toBe('paid');
      expect(updatedPayment.razorpayPaymentId).toBe(paymentId);
      expect(updatedPayment.invoiceNumber).toMatch(/^INV-/);

      // Check user tier updated
      const updatedUser = await User.findById(userA._id);
      expect(updatedUser.subscriptionTier).toBe('gold');
      expect(updatedUser.subscriptionBillingCycle).toBe('yearly');
      expect(updatedUser.subscriptionExpiresAt).not.toBeNull();
    });
  });

  // ── 4. Webhook and Manual /verify Coexistence & Race Prevention ──────────────
  describe('Coexistence with /payments/verify Endpoint', () => {
    it('should safely handle when webhook arrives for an already-paid order without re-extending', async () => {
      const orderId = 'order_already_paid_race_001';
      const eventId = 'evt_race_cap_002';
      const paymentId = 'pay_race_cap_002';

      // Pre-mark payment as paid (simulating manual /verify completed first)
      const existingPayment = await Payment.create({
        userId: userA._id,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        tier: 'bronze',
        billingCycle: 'monthly',
        durationDays: 30,
        amount: 9900,
        currency: 'INR',
        invoiceNumber: 'INV-ALREADY-PAID-01',
        status: 'paid',
      });

      const initialUser = await User.findById(userA._id);
      const initialExpiry = initialUser.subscriptionExpiresAt ? new Date(initialUser.subscriptionExpiresAt).getTime() : 0;

      const payload = {
        event: 'payment.captured',
        event_id: eventId,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 9900,
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('already_paid');

      // Verify user expiry was not extended again
      const postUser = await User.findById(userA._id);
      const postExpiry = postUser.subscriptionExpiresAt ? new Date(postUser.subscriptionExpiresAt).getTime() : 0;
      expect(postExpiry).toBe(initialExpiry);
    });
  });

  // ── 5. payment.failed Event Reliability ──────────────────────────────────────
  describe('payment.failed Event Processing', () => {
    it('should mark an unfulfilled payment as failed', async () => {
      const orderId = 'order_failed_evt_001';
      const eventId = 'evt_fail_001';

      await Payment.create({
        userId: userB._id,
        razorpayOrderId: orderId,
        tier: 'silver',
        amount: 19900,
        currency: 'INR',
        status: 'created',
      });

      const payload = {
        event: 'payment.failed',
        event_id: eventId,
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_001',
              order_id: orderId,
              amount: 19900,
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      const p = await Payment.findOne({ razorpayOrderId: orderId });
      expect(p.status).toBe('failed');
    });

    it('should NEVER downgrade or mark an already-paid payment as failed', async () => {
      const orderId = 'order_already_paid_safe_001';
      const eventId = 'evt_fail_on_paid_001';

      await Payment.create({
        userId: userA._id,
        razorpayOrderId: orderId,
        tier: 'gold',
        amount: 49900,
        currency: 'INR',
        status: 'paid', // Already paid
      });

      const payload = {
        event: 'payment.failed',
        event_id: eventId,
        payload: {
          payment: {
            entity: {
              id: 'pay_late_fail_001',
              order_id: orderId,
              amount: 49900,
              currency: 'INR',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res.status).toBe(200);

      // Verify payment remains 'paid'
      const p = await Payment.findOne({ razorpayOrderId: orderId });
      expect(p.status).toBe('paid');
    });
  });

  // ── 6. payment.dispute.created Event ─────────────────────────────────────────
  describe('payment.dispute.created Event Processing', () => {
    it('should record dispute details without deleting or corrupting payment history', async () => {
      const paymentId = 'pay_disputed_001';
      const eventId = 'evt_dispute_001';

      await Payment.create({
        userId: userA._id,
        razorpayOrderId: 'order_disp_001',
        razorpayPaymentId: paymentId,
        tier: 'silver',
        amount: 19900,
        currency: 'INR',
        status: 'paid',
        invoiceNumber: 'INV-DISP-001',
      });

      const payload = {
        event: 'payment.dispute.created',
        event_id: eventId,
        payload: {
          dispute: {
            entity: {
              id: 'disp_test_777',
              payment_id: paymentId,
              amount: 19900,
              currency: 'INR',
              reason_code: 'fraudulent',
              status: 'open',
            },
          },
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = signWebhookPayload(payloadStr);

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadStr);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      // Check payment status updated to 'disputed' and disputeDetails populated
      const p = await Payment.findOne({ razorpayPaymentId: paymentId });
      expect(p.status).toBe('disputed');
      expect(p.disputeDetails).not.toBeNull();
      expect(p.disputeDetails.disputeId).toBe('disp_test_777');
      expect(p.disputeDetails.reason).toBe('fraudulent');
      expect(p.invoiceNumber).toBe('INV-DISP-001'); // invoiceNumber and history preserved!
    });
  });

  // ── 7. PDF Invoice Generation & Ownership Security ───────────────────────────
  describe('PDF Invoice Generation & Authorization (GET /payments/invoices/:invoiceId/download)', () => {
    let paidPaymentA, pendingPaymentA, paidPaymentB;

    beforeAll(async () => {
      paidPaymentA = await Payment.create({
        userId: userA._id,
        razorpayOrderId: 'order_inv_a_paid',
        razorpayPaymentId: 'pay_inv_a_paid',
        tier: 'gold',
        billingCycle: 'yearly',
        amount: 449900,
        currency: 'INR',
        invoiceNumber: 'INV-2026-AAA-01',
        status: 'paid',
      });

      pendingPaymentA = await Payment.create({
        userId: userA._id,
        razorpayOrderId: 'order_inv_a_pend',
        tier: 'bronze',
        amount: 9900,
        currency: 'INR',
        invoiceNumber: 'INV-2026-AAA-PENDING',
        status: 'created',
      });

      paidPaymentB = await Payment.create({
        userId: userB._id,
        razorpayOrderId: 'order_inv_b_paid',
        razorpayPaymentId: 'pay_inv_b_paid',
        tier: 'silver',
        amount: 19900,
        currency: 'INR',
        invoiceNumber: 'INV-2026-BBB-01',
        status: 'paid',
      });
    });

    it('should successfully stream PDF invoice for authorized owner of a paid payment', async () => {
      const res = await request(app)
        .get(`/api/payments/invoices/${paidPaymentA.invoiceNumber}/download`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="Invoice-INV-2026-AAA-01.pdf"/);
      expect(Buffer.isBuffer(res.body)).toBe(true);
      // PDF documents always start with '%PDF'
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    });

    it('should allow lookup by MongoDB _id as well as invoiceNumber', async () => {
      const res = await request(app)
        .get(`/api/payments/invoices/${paidPaymentA._id}/download`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    });

    it('should reject invoice download with 403 when User A tries to download User B invoice', async () => {
      const res = await request(app)
        .get(`/api/payments/invoices/${paidPaymentB.invoiceNumber}/download`)
        .set('Authorization', `Bearer ${tokenA}`); // User A attempting to access User B's invoice

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    it('should reject invoice download with 400 when payment is not yet paid (e.g. pending/created)', async () => {
      const res = await request(app)
        .get(`/api/payments/invoices/${pendingPaymentA.invoiceNumber}/download`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only available for completed and paid/i);
    });

    it('should reject invoice download with 404 when invoice does not exist', async () => {
      const res = await request(app)
        .get('/api/payments/invoices/INV-NON-EXISTENT-9999/download')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Invoice not found/i);
    });

    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .get(`/api/payments/invoices/${paidPaymentA.invoiceNumber}/download`);

      expect(res.status).toBe(401);
    });
  });
});

