const mongoose = require('mongoose');

/**
 * Payment — Persists each Razorpay payment attempt.
 *
 * Purpose:
 *   - Audit trail for all upgrade attempts
 *   - Idempotency guard: prevents double-processing the same payment
 *   - Ownership verification: paymentId verified against userId before tier upgrade
 *
 * Lifecycle:
 *   1. POST /api/payments/create-order  → status: 'created'
 *   2. Razorpay checkout (client-side)  → user completes payment
 *   3. POST /api/payments/verify        → status: 'paid'  (or 'failed' on bad signature)
 */
const paymentSchema = new mongoose.Schema(
  {
    // The user who initiated the payment
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Razorpay order ID (generated server-side, never client-side)
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Set after successful client payment, verified on server
    razorpayPaymentId: {
      type: String,
      default: null,
    },

    // HMAC-SHA256 signature — stored only after successful verification
    razorpaySignature: {
      type: String,
      default: null,
    },

    // The tier this payment was intended to unlock
    tier: {
      type: String,
      enum: ['premium', 'vip'],
      required: true,
    },

    // Amount in smallest currency unit (paise for INR)
    amount: {
      type: Number,
      required: true,
    },

    // Currency code
    currency: {
      type: String,
      default: 'INR',
    },

    // Payment lifecycle status
    status: {
      type: String,
      enum: ['created', 'paid', 'failed'],
      default: 'created',
      index: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Compound index for quick per-user payment lookups
paymentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
