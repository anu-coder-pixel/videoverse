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

// ── Tier definitions (server-authoritative; client cannot override these) ──────
const TIER_CONFIG = {
  premium: {
    label: 'Premium',
    amount: 19900, // ₹199 in paise
    currency: 'INR',
  },
  vip: {
    label: 'VIP',
    amount: 49900, // ₹499 in paise
    currency: 'INR',
  },
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
// Body: { tier: 'premium' | 'vip' }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/payments/create-order', requireAuth, async (req, res) => {
  try {
    const { tier } = req.body;

    // 1. Validate tier
    if (!tier || !TIER_CONFIG[tier]) {
      return res.status(400).json({
        error: 'Invalid tier. Must be "premium" or "vip".',
        code: 'INVALID_TIER',
      });
    }

    // 2. Prevent downgrade or re-purchase of current tier
    const currentTier = req.user.subscriptionTier;
    if (currentTier === 'vip') {
      return res.status(400).json({
        error: 'You already have the highest VIP subscription.',
        code: 'ALREADY_VIP',
      });
    }
    if (currentTier === tier) {
      return res.status(400).json({
        error: `You are already on the ${TIER_CONFIG[tier].label} plan.`,
        code: 'ALREADY_ON_TIER',
      });
    }

    // 3. Server-side amount from tier config — client never sends amount
    const { amount, currency } = TIER_CONFIG[tier];

    // 4. Create Razorpay order
    let razorpayOrder;
    try {
      razorpayOrder = await getRazorpay().orders.create({
        amount,
        currency,
        receipt: `vv-${req.user._id.toString().slice(-8)}-${Date.now()}`,
        notes: {
          userId: req.user._id.toString(),
          tier,
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
    await Payment.create({
      userId: req.user._id,
      razorpayOrderId: razorpayOrder.id,
      tier,
      amount,
      currency,
      status: 'created',
    });

    // 6. Return only the fields the client needs; never expose KEY_SECRET
    return res.status(201).json({
      success: true,
      orderId: razorpayOrder.id,
      amount,
      currency,
      tier,
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
// subscription tier. Idempotent — already-paid orders return success cleanly.
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

    // 4. Idempotency guard — if already verified and paid, return success
    if (payment.status === 'paid') {
      const user = await User.findById(req.user._id);
      return res.json({
        success: true,
        message: 'Payment already verified. Your tier is active.',
        user: user.toSafeObject(),
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

    const isSignatureValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(razorpaySignature, 'hex')
    );

    if (!isSignatureValid) {
      // Mark the payment record as failed
      payment.status = 'failed';
      await payment.save();

      return res.status(400).json({
        error: 'Payment signature verification failed. The payment may have been tampered with.',
        code: 'SIGNATURE_INVALID',
      });
    }

    // 6. Upgrade the user's tier
    const user = await User.findById(req.user._id);
    user.subscriptionTier = payment.tier;
    await user.save();

    // 7. Record verified payment details
    payment.status = 'paid';
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    await payment.save();

    console.log(
      `[Payment] User ${user._id} upgraded to "${payment.tier}" via order ${razorpayOrderId}`
    );

    return res.json({
      success: true,
      message: `You are now a ${TIER_CONFIG[payment.tier].label} member!`,
      user: user.toSafeObject(),
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
      tier: p.tier,
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
