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
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { paymentOrderLimiter } = require('../middleware/rateLimiter');

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

    // 3. Server-side amount and duration from plan config (client never dictates amount)
    const cycleConfig = PLAN_CONFIG[normTier].cycles[cycle];
    const { amount, durationDays } = cycleConfig;
    const currency = 'INR';

    // 4. Create Razorpay order
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

    // 5. Save payment record (status: 'created')
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

    // 6. Return only safe fields the client needs; never expose KEY_SECRET
    return res.status(201).json({
      success: true,
      orderId: razorpayOrder.id,
      amount,
      currency,
      tier: normTier,
      billingCycle: cycle,
      invoiceNumber,
      keyId: process.env.RAZORPAY_KEY_ID, // Safe to expose (public key)
    });
  } catch (err) {
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

    // 6. Upgrade the user's tier and calculate subscription expiry
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

    // 7. Record verified payment details
    payment.status = 'paid';
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    if (!payment.invoiceNumber) {
      payment.invoiceNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    await payment.save();

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

module.exports = router;
