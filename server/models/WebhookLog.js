const mongoose = require('mongoose');

/**
 * WebhookLog — Persists incoming Razorpay webhook events to guarantee:
 * 1. Event Idempotency: Each eventId is stored once via unique index.
 * 2. Simultaneous request locking: State machine 'received' -> 'processing' -> 'processed' | 'failed' | 'ignored'.
 * 3. Safe retry and recovery: Interrupted events can be retried without double processing.
 * 4. Audit trail: Full record of event payload, event type, and outcome.
 */
const webhookLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    event: {
      type: String,
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      default: null,
      index: true,
    },
    paymentId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['received', 'processing', 'processed', 'failed', 'ignored'],
      default: 'received',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

webhookLogSchema.index({ eventId: 1, status: 1 });
webhookLogSchema.index({ orderId: 1, event: 1 });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);

