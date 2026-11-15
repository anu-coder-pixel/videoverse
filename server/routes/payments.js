/**
 * VideoVerse — Payment Routes (Task 3: Subscriptions with Razorpay)
 *
 * Routes:
 *   POST /api/payments/create-order  → Create Razorpay order server-side
 *   POST /api/payments/verify        → Verify Razorpay signature and upgrade tier
 *   GET  /api/payments/history       → Return user's payment history
 *
 * Security principles:
 *   - Amount is ALWAYS derived server-side from the tier; client never sends amount.
 *   - Signature is verified via HMAC-SHA256 before any tier change.
 *   - Payment record ownership is verified (userId must match req.user._id).
 *   - verify endpoint is idempotent: already-paid orders return success without re-processing.
 *   - Key secret (RAZORPAY_KEY_SECRET) is never sent to the client.
 */

require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Payment = require('../models/Payment');
const PaymentIntent = require('../models/PaymentIntent');
const WebhookLog = require('../models/WebhookLog');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { paymentOrderLimiter } = require('../middleware/rateLimiter');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');

// ── Tier definitions (server-authoritative; client cannot override these) ──────
const PLAN_CONFIG = {
  bronze: {
    label: 'Bronze',
    cycles: {
      monthly: { amount: 9900, durationDays: 30, label: 'Monthly' },
      quarterly: { amount: 24900, durationDays: 90, label: 'Quarterly' },
      yearly: { amount: 89900, durationDays: 365, label: 'Yearly' },
    },
  },
  silver: {
    label: 'Silver',
    cycles: {
      monthly: { amount: 19900, durationDays: 30, label: 'Monthly' },
      quarterly: { amount: 49900, durationDays: 90, label: 'Quarterly' },
      yearly: { amount: 179900, durationDays: 365, label: 'Yearly' },
    },
  },
  gold: {
    label: 'Gold',
    cycles: {
      monthly: { amount: 49900, durationDays: 30, label: 'Monthly' },
      quarterly: { amount: 129900, durationDays: 90, label: 'Quarterly' },
      yearly: { amount: 449900, durationDays: 365, label: 'Yearly' },
    },
  },
};

/**
 * Helper: Normalizes tier string to bronze, silver, or gold,
 * mapping legacy aliases ('vip' -> 'gold', 'premium' -> 'silver')
 */
function normalizeTier(tier) {
  if (!tier) return null;
  const t = String(tier).toLowerCase().trim();
  if (t === 'gold' || t === 'vip') return 'gold';
  if (t === 'silver' || t === 'premium') return 'silver';
  if (t === 'bronze') return 'bronze';
  return null;
}

// Legacy TIER_CONFIG for backward compatibility with existing tests
const TIER_CONFIG = {
  bronze: { label: 'Bronze', amount: 9900, currency: 'INR' },
  silver: { label: 'Silver', amount: 19900, currency: 'INR' },
  gold: { label: 'Gold', amount: 49900, currency: 'INR' },
  premium: { label: 'Silver', amount: 19900, currency: 'INR' },
  vip: { label: 'Gold', amount: 49900, currency: 'INR' },
};

// ── Razorpay client (lazy-initialized) ────────────────────────────────────────
let razorpayInstance = null;

function getRazorpay() {
  if (razorpayInstance) return razorpayInstance;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured in server/.env. ' +
      'Get test keys from: https://dashboard.razorpay.com/app/keys'
    );
  }

  // Safe mock in test environment when placeholder keys are present
  if (process.env.NODE_ENV === 'test' && keyId.includes('REPLACE')) {
    return {
      orders: {
        create: async (params) => ({
          id: `order_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          entity: 'order',
          amount: params.amount,
          currency: params.currency || 'INR',
          status: 'created',
          notes: params.notes,
        }),
      },
    };
  }

  razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/create-order
//
// Creates a Razorpay order on the server and returns the orderId + amount
// to the client so it can open the checkout modal.
//
// Body: { tier: 'bronze'|'silver'|'gold'|'premium'|'vip', billingCycle?: 'monthly'|'quarterly'|'yearly' }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/payments/create-order', requireAuth, paymentOrderLimiter, async (req, res) => {
  try {
    const { tier, billingCycle } = req.body;

    // 1. Validate tier
    const normTier = normalizeTier(tier);
    if (!normTier || !PLAN_CONFIG[normTier]) {
      return res.status(400).json({
        error: 'Invalid tier. Must be "bronze", "silver", or "gold".',
        code: 'INVALID_TIER',
      });
    }

    // 2. Validate billing cycle
    const cycle = (billingCycle || 'monthly').toLowerCase().trim();
    if (!['monthly', 'quarterly', 'yearly'].includes(cycle)) {
      return res.status(400).json({
        error: 'Invalid billing cycle. Must be "monthly", "quarterly", or "yearly".',
        code: 'INVALID_CYCLE',
      });
    }

    // 3. Server-side amount and duration from plan config
    const cycleConfig = PLAN_CONFIG[normTier].cycles[cycle];
    const { amount, durationDays } = cycleConfig;
    const currency = 'INR';

    // 4. Idempotency handling
    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency key required.', code: 'MISSING_IDEMPOTENCY_KEY' });
    }

    const PaymentIntent = require('../models/PaymentIntent');
    let intent = await PaymentIntent.findOne({ userId: req.user._id, idempotencyKey });
    if (intent) {
      // Validate immutable details: plan tier, billing cycle, and amount must match exactly
      if (intent.tier !== normTier || intent.billingCycle !== cycle || (intent.amount && intent.amount !== amount)) {
        return res.status(409).json({
          error: 'Idempotency key already used for a different tier, cycle, or amount.',
          code: 'IDEMPOTENCY_KEY_MISMATCH',
        });
      }
      if (intent.razorpayOrderId) {
        return res.status(200).json({
          success: true,
          orderId: intent.razorpayOrderId,
          amount: intent.amount,
          currency: intent.currency,
          tier: intent.tier,
          billingCycle: intent.billingCycle,
          invoiceNumber: intent.invoiceNumber,
          keyId: process.env.RAZORPAY_KEY_ID,
        });
      }
    }

    // 5. Create Razorpay order
    let razorpayOrder;
    try {
      razorpayOrder = await getRazorpay().orders.create({
        amount,
        currency,
        receipt: `vv-${req.user._id.toString().slice(-8)}-${Date.now()}`,
        notes: {
          userId: req.user._id.toString(),
          tier: normTier,
          billingCycle: cycle,
          durationDays: String(durationDays),
          platform: 'VideoVerse',
        },
      });
    } catch (razorpayErr) {
      console.error('[Razorpay Create Order Error]', razorpayErr);
      return res.status(502).json({
        error: 'Payment provider is unavailable. Please try again later.',
        code: 'PAYMENT_PROVIDER_ERROR',
      });
    }

    // 6. Save payment record (status: 'created')
    const invoiceNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await Payment.create({
      userId: req.user._id,
      razorpayOrderId: razorpayOrder.id,
      tier: normTier,
      billingCycle: cycle,
      durationDays,
      invoiceNumber,
      amount,
      currency,
      status: 'created',
    });

    // 7. Save or update PaymentIntent
    if (!intent) {
      const intentId = require('crypto').randomUUID();
      intent = new PaymentIntent({
        userId: req.user._id,
        idempotencyKey,
        intentId,
        razorpayOrderId: razorpayOrder.id,
        tier: normTier,
        billingCycle: cycle,
        amount,
        currency,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      intent.razorpayOrderId = razorpayOrder.id;
      intent.tier = normTier;
      intent.billingCycle = cycle;
      intent.amount = amount;
      intent.currency = currency;
    }
    await intent.save();

    // 8. Return response to client
    return res.status(201).json({
      success: true,
      orderId: razorpayOrder.id,
      amount,
      currency,
      tier: normTier,
      billingCycle: cycle,
      invoiceNumber,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    // Duplicate-key recovery completely outside transactions
    if (err.code === 11000) {
      try {
        const PaymentIntent = require('../models/PaymentIntent');
        const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;
        if (idempotencyKey) {
          const existingIntent = await PaymentIntent.findOne({ userId: req.user._id, idempotencyKey });
          if (existingIntent) {
            const normTier = normalizeTier(req.body?.tier);
            const cycle = (req.body?.billingCycle || 'monthly').toLowerCase().trim();
            const expectedAmount = PLAN_CONFIG[normTier]?.cycles[cycle]?.amount;
            if (
              existingIntent.tier !== normTier ||
              existingIntent.billingCycle !== cycle ||
              (expectedAmount && existingIntent.amount !== expectedAmount)
            ) {
              return res.status(409).json({
                error: 'Idempotency key already used for a different tier, cycle, or amount.',
                code: 'IDEMPOTENCY_KEY_MISMATCH',
              });
            }
            return res.status(200).json({
              success: true,
              orderId: existingIntent.razorpayOrderId,
              amount: existingIntent.amount,
              currency: existingIntent.currency,
              tier: existingIntent.tier,
              billingCycle: existingIntent.billingCycle,
              invoiceNumber: existingIntent.invoiceNumber,
              keyId: process.env.RAZORPAY_KEY_ID,
            });
          }
        }
      } catch (recoverErr) {
        console.error('[Duplicate Key Recovery Error]', recoverErr.message);
      }
    }
    console.error('[Create Order Error]', err.message);
    return res.status(500).json({ error: 'Failed to create payment order.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/verify
//
// Verifies the Razorpay payment signature server-side, then upgrades the user's
// subscription tier with calculated expiry. Idempotent — already-paid orders
// return success cleanly.
//
// Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/payments/verify', requireAuth, async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    // 1. Validate required fields
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        error: 'razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required.',
        code: 'MISSING_PAYMENT_FIELDS',
      });
    }

    // 2. Look up the payment record
    const payment = await Payment.findOne({ razorpayOrderId });
    if (!payment) {
      return res.status(404).json({
        error: 'Payment order not found.',
        code: 'ORDER_NOT_FOUND',
      });
    }

    // 3. Verify ownership — the payment must belong to the authenticated user
    if (payment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Payment order does not belong to your account.',
        code: 'FORBIDDEN',
      });
    }

    // 3b. Verify amount and currency if provided by caller against authoritative server record
    if (req.body.amount !== undefined && req.body.amount !== null && Number(req.body.amount) !== payment.amount) {
      return res.status(400).json({
        error: 'Payment amount mismatch.',
        code: 'AMOUNT_MISMATCH',
      });
    }
    if (req.body.currency && req.body.currency.toUpperCase() !== (payment.currency || 'INR').toUpperCase()) {
      return res.status(400).json({
        error: 'Payment currency mismatch.',
        code: 'CURRENCY_MISMATCH',
      });
    }

    // 4. Idempotency guard — if already verified and paid, return success cleanly
    if (payment.status === 'paid') {
      const user = await User.findById(req.user._id);
      return res.json({
        success: true,
        message: 'Payment already verified. Your tier is active.',
        user: user.toSafeObject(),
        payment: {
          orderId: payment.razorpayOrderId,
          paymentId: payment.razorpayPaymentId,
          invoiceNumber: payment.invoiceNumber,
          tier: normalizeTier(payment.tier) || payment.tier,
          billingCycle: payment.billingCycle,
          amount: payment.amount,
        },
      });
    }

    // 5. Verify HMAC-SHA256 signature
    //    Razorpay specification: HMAC_SHA256(orderId + "|" + paymentId, KEY_SECRET)
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('[Verify] RAZORPAY_KEY_SECRET is not configured');
      return res.status(500).json({
        error: 'Payment verification is not configured on the server.',
        code: 'SERVER_CONFIG_ERROR',
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const providedBuf = Buffer.from(razorpaySignature, 'hex');

    const isSignatureValid =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!isSignatureValid) {
      // Mark the payment record as failed
      payment.status = 'failed';
      await payment.save();

      return res.status(400).json({
        error: 'Payment signature verification failed. The payment may have been tampered with.',
        code: 'SIGNATURE_INVALID',
      });
    }

    // Atomic status transition from 'created' to prevent duplicate activation races
    // If a previous server process crashed while in 'verifying' (> 15s ago), allow recovering the lock
    const staleLockThreshold = new Date(Date.now() - 15 * 1000);
    const lockedPayment = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        $or: [
          { status: 'created' },
          { status: 'verifying', updatedAt: { $lt: staleLockThreshold } },
        ],
      },
      { $set: { status: 'verifying' } },
      { returnDocument: 'after' }
    );

    if (!lockedPayment) {
      const freshPayment = await Payment.findById(payment._id);
      if (freshPayment && freshPayment.status === 'paid') {
        const user = await User.findById(req.user._id);
        return res.json({
          success: true,
          message: 'Payment already verified. Your tier is active.',
          user: user.toSafeObject(),
          payment: {
            orderId: freshPayment.razorpayOrderId,
            paymentId: freshPayment.razorpayPaymentId,
            invoiceNumber: freshPayment.invoiceNumber,
            tier: normalizeTier(freshPayment.tier) || freshPayment.tier,
            billingCycle: freshPayment.billingCycle,
            amount: freshPayment.amount,
          },
        });
      }

      return res.status(409).json({
        error: 'Payment verification is currently in progress. Please retry in a few seconds.',
        code: 'VERIFICATION_IN_PROGRESS',
      });
    }

    // 6. Upgrade the user's tier and calculate subscription expiry
    // Atomically claim the transition from 'verifying' -> 'paid' FIRST.
    // This guarantees that even if another concurrent request re-acquired a stale lock after 15s,
    // exactly ONE request can ever execute the user upgrade and extend the subscription!
    const invoiceNum = payment.invoiceNumber || `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalizedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, status: 'verifying' },
      {
        $set: {
          status: 'paid',
          razorpayPaymentId,
          razorpaySignature,
          invoiceNumber: invoiceNum,
        },
      },
      { returnDocument: 'after' }
    );

    if (!finalizedPayment) {
      const freshPayment = await Payment.findById(payment._id);
      const freshUser = await User.findById(req.user._id);
      return res.json({
        success: true,
        message: 'Payment already verified. Your tier is active.',
        user: freshUser.toSafeObject(),
        payment: {
          orderId: freshPayment.razorpayOrderId,
          paymentId: freshPayment.razorpayPaymentId,
          invoiceNumber: freshPayment.invoiceNumber,
          tier: normalizeTier(freshPayment.tier) || freshPayment.tier,
          billingCycle: freshPayment.billingCycle,
          amount: freshPayment.amount,
        },
      });
    }

    const user = await User.findById(req.user._id);
    const normTier = normalizeTier(payment.tier) || payment.tier;
    const cycle = payment.billingCycle || 'monthly';
    const durationDays = payment.durationDays || (cycle === 'yearly' ? 365 : cycle === 'quarterly' ? 90 : 30);

    const now = Date.now();
    let baseTime = now;
    // If user already has an active subscription of the same tier, extend from existing expiry date
    if (
      user.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt).getTime() > now &&
      user.getEffectiveTier() === normTier
    ) {
      baseTime = new Date(user.subscriptionExpiresAt).getTime();
    }

    const expiresAt = new Date(baseTime + durationDays * 24 * 60 * 60 * 1000);

    user.subscriptionTier = payment.tier;
    user.subscriptionExpiresAt = expiresAt;
    user.subscriptionBillingCycle = cycle;
    user.subscriptionCancelledAt = null;
    await user.save();

    payment.status = 'paid';
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.invoiceNumber = invoiceNum;

    const tierLabel = PLAN_CONFIG[normTier]?.label || TIER_CONFIG[normTier]?.label || normTier;
    console.log(
      `[Payment] User ${user._id} upgraded to "${normTier}" (${cycle}) via order ${razorpayOrderId}, expires ${expiresAt.toISOString()}`
    );

    return res.json({
      success: true,
      message: `You are now a ${tierLabel} member!`,
      user: user.toSafeObject(),
      payment: {
        orderId: payment.razorpayOrderId,
        paymentId: payment.razorpayPaymentId,
        invoiceNumber: payment.invoiceNumber,
        tier: normTier,
        billingCycle: cycle,
        expiresAt,
        amount: payment.amount,
      },
    });
  } catch (err) {
    // Handle crypto.timingSafeEqual length mismatch (invalid hex signature)
    if (err.message && err.message.includes('length')) {
      return res.status(400).json({
        error: 'Payment signature format is invalid.',
        code: 'SIGNATURE_FORMAT_ERROR',
      });
    }
    console.error('[Verify Payment Error]', err.message);
    return res.status(500).json({ error: 'Failed to verify payment.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/cancel
//
// Cancels recurring renewal for the authenticated user's active paid subscription.
// Paid benefits remain active until user.subscriptionExpiresAt.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/payments/cancel', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const effectiveTier = user.getEffectiveTier ? user.getEffectiveTier() : user.subscriptionTier;

    if (effectiveTier === 'free') {
      return res.status(400).json({
        error: 'You do not have an active paid subscription to cancel.',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    }

    if (user.subscriptionCancelledAt) {
      const expDate = user.subscriptionExpiresAt
        ? new Date(user.subscriptionExpiresAt).toLocaleDateString()
        : 'end of billing cycle';
      return res.json({
        success: true,
        alreadyCancelled: true,
        message: `Your subscription is already scheduled for cancellation and will expire on ${expDate}.`,
        user: user.toSafeObject(),
      });
    }

    user.subscriptionCancelledAt = new Date();
    await user.save();

    const expDate = user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt).toLocaleDateString()
      : 'end of billing cycle';

    return res.json({
      success: true,
      message: `Subscription renewal cancelled. You will retain all paid benefits until your plan expires on ${expDate}.`,
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[Cancel Subscription Error]', err);
    return res.status(500).json({ error: 'Failed to cancel subscription.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/history
//
// Returns the authenticated user's payment records (safe fields only).
// Signature fields are never returned to the client.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payments/history', requireAuth, async (req, res) => {
  try {
    const records = await Payment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const safeRecords = records.map(p => ({
      id: p._id.toString(),
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId || null,
      tier: normalizeTier(p.tier) || p.tier,
      billingCycle: p.billingCycle || 'monthly',
      durationDays: p.durationDays || 30,
      invoiceNumber: p.invoiceNumber || null,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      // razorpaySignature is intentionally excluded
    }));

    return res.json({
      success: true,
      total: safeRecords.length,
      payments: safeRecords,
    });
  } catch (err) {
    console.error('[Payment History Error]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve payment history.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/invoices/:invoiceId/download
//
// Authenticated endpoint to download a signed PDF tax invoice.
// Verifies invoice ownership, paid status, and generates PDF stream.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payments/invoices/:invoiceId/download', requireAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice identifier is required.' });
    }

    // Lookup payment by invoiceNumber or _id
    let payment = null;
    if (invoiceId.startsWith('INV-')) {
      payment = await Payment.findOne({ invoiceNumber: invoiceId });
    } else if (/^[0-9a-fA-F]{24}$/.test(invoiceId)) {
      payment = await Payment.findById(invoiceId);
    } else {
      payment = await Payment.findOne({ invoiceNumber: invoiceId });
    }

    if (!payment) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    // Authorization & Ownership check: user can only download their own invoice
    if (payment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You do not own this invoice.' });
    }

    // Only allow download of paid invoices
    if (payment.status !== 'paid') {
      return res.status(400).json({
        error: 'Invoice is only available for completed and paid subscriptions.',
        status: payment.status,
      });
    }

    // Set response headers for PDF download
    const filename = `Invoice-${payment.invoiceNumber || payment._id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream generated PDF
    generateInvoicePDF({ payment, user: req.user, res });
  } catch (err) {
    console.error('[Invoice Download Error]', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to generate invoice.' });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook
//
// Razorpay Webhook endpoint.
// Validates raw body signature, guarantees event idempotency, safe state transitions,
// and handles payment.captured, payment.failed, and payment.dispute.created.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/payments/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Webhook Error] RAZORPAY_WEBHOOK_SECRET is not configured on the server.');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!signature) {
    return res.status(400).json({ error: 'Missing x-razorpay-signature header' });
  }

  // 1. Verify Razorpay webhook signature using raw body
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  const providedBuf = Buffer.from(signature, 'hex');

  const isSignatureValid =
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf);

  if (!isSignatureValid) {
    console.warn('[Webhook Warning] Invalid Razorpay webhook signature rejected.');
    return res.status(400).json({ error: 'Invalid webhook signature', code: 'BAD_SIGNATURE' });
  }

  const payload = req.body;
  const event = payload.event;
  // Razorpay event ID is passed in headers or payload
  const eventId = req.headers['x-razorpay-event-id'] || payload.event_id || (payload.payload && payload.payload.payment ? payload.payload.payment.entity.id + '_' + event : null);

  if (!eventId) {
    return res.status(400).json({ error: 'Missing event ID in webhook payload' });
  }

  // 2. Event Idempotency and Simultaneous Lock via WebhookLog
  let webhookLog = null;
  try {
    webhookLog = await WebhookLog.create({
      eventId,
      event,
      payload,
      status: 'processing',
      attempts: 1,
    });
  } catch (err) {
    if (err.code === 11000) {
      // Event already recorded in WebhookLog
      const existing = await WebhookLog.findOne({ eventId });
      if (existing && existing.status === 'processed') {
        return res.status(200).json({ status: 'already_processed', eventId });
      }
      if (existing && existing.status === 'processing') {
        // Check for stale lock (> 30s)
        const isStale = existing.updatedAt && (Date.now() - new Date(existing.updatedAt).getTime() > 30000);
        if (!isStale) {
          return res.status(200).json({ status: 'processing_in_progress', eventId });
        }
        // Recover stale lock
        existing.status = 'processing';
        existing.attempts += 1;
        await existing.save();
        webhookLog = existing;
      } else if (existing) {
        // Can retry previously failed event
        existing.status = 'processing';
        existing.attempts += 1;
        await existing.save();
        webhookLog = existing;
      }
    } else {
      console.error('[Webhook DB Error]', err.message);
      return res.status(500).json({ error: 'Database error storing webhook' });
    }
  }

  // Helper to mark WebhookLog outcome
  const markWebhookLog = async (status, errorMessage = null, orderId = null, paymentId = null) => {
    try {
      if (webhookLog) {
        webhookLog.status = status;
        if (errorMessage) webhookLog.errorMessage = errorMessage;
        if (orderId) webhookLog.orderId = orderId;
        if (paymentId) webhookLog.paymentId = paymentId;
        await webhookLog.save();
      }
    } catch (e) {
      console.error('[Webhook Log Update Error]', e.message);
    }
  };

  try {
    // 3. Handle Webhook Events
    if (event === 'payment.captured') {
      const paymentEntity = payload.payload && payload.payload.payment ? payload.payload.payment.entity : null;
      if (!paymentEntity) {
        await markWebhookLog('ignored', 'Missing payment entity in payload');
        return res.status(200).json({ status: 'ignored', reason: 'no_payment_entity' });
      }

      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const amount = paymentEntity.amount;
      const currency = paymentEntity.currency;

      if (!orderId) {
        await markWebhookLog('ignored', 'Missing order_id in payment entity');
        return res.status(200).json({ status: 'ignored', reason: 'no_order_id' });
      }

      // Lookup internal Payment by razorpayOrderId
      const payment = await Payment.findOne({ razorpayOrderId: orderId });
      if (!payment) {
        await markWebhookLog('ignored', `No matching payment record for order: ${orderId}`, orderId, paymentId);
        return res.status(200).json({ status: 'ignored', reason: 'order_not_found' });
      }

      // Verify payment amount and currency
      if (payment.amount !== amount || payment.currency !== currency) {
        console.warn(`[Webhook Warning] Amount/currency mismatch for order ${orderId}: Expected ${payment.amount} ${payment.currency}, got ${amount} ${currency}`);
        await markWebhookLog('failed', 'Amount or currency mismatch', orderId, paymentId);
        return res.status(400).json({ error: 'Amount or currency mismatch' });
      }

      // Verify internal PaymentIntent if present
      const paymentIntent = await PaymentIntent.findOne({ razorpayOrderId: orderId });
      if (paymentIntent) {
        if (paymentIntent.amount !== amount || paymentIntent.currency !== currency) {
          await markWebhookLog('failed', 'PaymentIntent amount/currency mismatch', orderId, paymentId);
          return res.status(400).json({ error: 'PaymentIntent amount or currency mismatch' });
        }
      }

      // Safe atomic status transition: Only transition if status is 'created' or 'verifying'
      const invoiceNum = payment.invoiceNumber || `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const finalizedPayment = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          status: { $in: ['created', 'verifying'] },
        },
        {
          $set: {
            status: 'paid',
            razorpayPaymentId: paymentId,
            invoiceNumber: invoiceNum,
          },
        },
        { returnDocument: 'after' }
      );

      // If already paid (by /payments/verify endpoint or previous webhook delivery), do not re-extend!
      if (!finalizedPayment) {
        const freshPayment = await Payment.findById(payment._id);
        if (freshPayment && freshPayment.status === 'paid') {
          await markWebhookLog('processed', null, orderId, paymentId);
          return res.status(200).json({ status: 'already_paid', orderId, invoiceNumber: freshPayment.invoiceNumber });
        }
      }

      // Activate/extend subscription on User model
      const user = await User.findById(payment.userId);
      if (user) {
        const normTier = normalizeTier(payment.tier) || payment.tier;
        const cycle = payment.billingCycle || 'monthly';
        const durationDays = payment.durationDays || (cycle === 'yearly' ? 365 : cycle === 'quarterly' ? 90 : 30);

        const now = Date.now();
        let baseTime = now;
        if (
          user.subscriptionExpiresAt &&
          new Date(user.subscriptionExpiresAt).getTime() > now &&
          user.getEffectiveTier() === normTier
        ) {
          baseTime = new Date(user.subscriptionExpiresAt).getTime();
        }

        const expiresAt = new Date(baseTime + durationDays * 24 * 60 * 60 * 1000);
        user.subscriptionTier = payment.tier;
        user.subscriptionExpiresAt = expiresAt;
        user.subscriptionBillingCycle = cycle;
        user.subscriptionCancelledAt = null;
        await user.save();
      }

      // Update PaymentIntent if present
      if (paymentIntent) {
        paymentIntent.status = 'paid';
        paymentIntent.razorpayPaymentId = paymentId;
        await paymentIntent.save();
      }

      await markWebhookLog('processed', null, orderId, paymentId);
      return res.status(200).json({ status: 'success', event: 'payment.captured', orderId });
    }

    if (event === 'payment.failed') {
      const paymentEntity = payload.payload && payload.payload.payment ? payload.payload.payment.entity : null;
      if (!paymentEntity) {
        await markWebhookLog('ignored', 'Missing payment entity in payload');
        return res.status(200).json({ status: 'ignored', reason: 'no_payment_entity' });
      }

      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      if (orderId) {
        // Never allow a failed payment event to downgrade an already-paid subscription!
        const payment = await Payment.findOne({ razorpayOrderId: orderId });
        if (payment && payment.status !== 'paid') {
          payment.status = 'failed';
          await payment.save();

          const paymentIntent = await PaymentIntent.findOne({ razorpayOrderId: orderId });
          if (paymentIntent && paymentIntent.status !== 'paid') {
            paymentIntent.status = 'failed';
            await paymentIntent.save();
          }
        }
      }

      await markWebhookLog('processed', null, orderId, paymentId);
      return res.status(200).json({ status: 'success', event: 'payment.failed', orderId });
    }

    if (event === 'payment.dispute.created') {
      const disputeEntity = payload.payload && payload.payload.dispute ? payload.payload.dispute.entity : null;
      const paymentId = disputeEntity ? disputeEntity.payment_id : null;
      const disputeId = disputeEntity ? disputeEntity.id : null;
      const reason = disputeEntity ? disputeEntity.reason_code || disputeEntity.reason : 'Dispute raised';

      if (paymentId) {
        // Update payment status to 'disputed' and store disputeDetails without silently deleting or altering payment history
        const payment = await Payment.findOne({ razorpayPaymentId: paymentId });
        if (payment) {
          payment.status = 'disputed';
          payment.disputeDetails = {
            disputeId: disputeId || `disp_${Date.now()}`,
            reason: reason,
            status: disputeEntity ? disputeEntity.status : 'open',
            createdAt: new Date(),
          };
          await payment.save();
        }
      }

      await markWebhookLog('processed', null, null, paymentId);
      return res.status(200).json({ status: 'success', event: 'payment.dispute.created', paymentId });
    }

    // Default for unhandled events
    await markWebhookLog('ignored', `Unhandled event type: ${event}`);
    return res.status(200).json({ status: 'ignored', event });
  } catch (err) {
    console.error('[Webhook Processing Error]', err.message);
    await markWebhookLog('failed', err.message);
    return res.status(500).json({ error: 'Internal error processing webhook' });
  }
});

module.exports = router;
