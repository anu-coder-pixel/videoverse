const mongoose = require('mongoose');

/**
 * PaymentIntent – persisted idempotency key for Razorpay order creation.
 *
 * Fields:
 *   userId           – the user initiating the checkout (ObjectId, indexed)
 *   idempotencyKey   – client‑generated stable key per checkout attempt (String)
 *   intentId         – UUID for the intent (String, unique)
 *   razorpayOrderId  – Razorpay order id once created (String, unique, optional)
 *   createdAt        – timestamp of intent creation
 *   updatedAt        – timestamp of last update
 */
const paymentIntentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  idempotencyKey: { type: String, required: true },
  intentId: { type: String, required: true, unique: true },
  razorpayOrderId: { type: String, default: null, unique: true, sparse: true },
  tier: { type: String, default: null },
  billingCycle: { type: String, default: null },
  amount: { type: Number, default: null },
  currency: { type: String, default: 'INR' },
}, { timestamps: true });

// Composite unique index to guarantee idempotency per user.
paymentIntentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model('PaymentIntent', paymentIntentSchema);

