const PDFDocument = require('pdfkit');

/**
 * Generates a professional PDF invoice stream for a completed subscription payment.
 *
 * @param {Object} options
 * @param {Object} options.payment - The Payment document
 * @param {Object} options.user - The User document
 * @param {NodeJS.WritableStream} res - The Express response stream
 */
function generateInvoicePDF({ payment, user, res }) {
  const doc = new PDFDocument({
    margin: 50,
    size: 'A4',
    info: {
      Title: `VideoVerse Invoice ${payment.invoiceNumber}`,
      Author: 'VideoVerse Inc.',
      Subject: 'Subscription Receipt & Tax Invoice',
      Keywords: 'videoverse invoice receipt subscription',
    },
  });

  // Pipe directly to the response
  doc.pipe(res);

  // ── Header / Brand ─────────────────────────────────────────────────────────
  doc
    .fillColor('#ff0000')
    .fontSize(24)
    .font('Helvetica-Bold')
    .text('VIDEOVERSE', 50, 50);

  doc
    .fillColor('#666666')
    .fontSize(10)
    .font('Helvetica')
    .text('Next-Gen Multilingual Video & Streaming Platform', 50, 78)
    .text('support@videoverse.com | https://videoverse.com', 50, 92);

  // Invoice Title & Status
  doc
    .fillColor('#111111')
    .fontSize(20)
    .font('Helvetica-Bold')
    .text('TAX INVOICE', 380, 50, { align: 'right' });

  const isPaid = payment.status === 'paid';
  doc
    .fillColor(isPaid ? '#10b981' : '#ef4444')
    .fontSize(12)
    .font('Helvetica-Bold')
    .text(isPaid ? 'PAID' : payment.status.toUpperCase(), 380, 75, { align: 'right' });

  // Divider
  doc
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .moveTo(50, 115)
    .lineTo(545, 115)
    .stroke();

  // ── Invoice Meta Details ───────────────────────────────────────────────────
  const metaY = 130;
  doc
    .fillColor('#374151')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('Invoice Number:', 50, metaY)
    .font('Helvetica')
    .text(payment.invoiceNumber || 'INV-PENDING', 140, metaY);

  doc
    .font('Helvetica-Bold')
    .text('Invoice Date:', 50, metaY + 18)
    .font('Helvetica')
    .text(new Date(payment.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }), 140, metaY + 18);

  doc
    .font('Helvetica-Bold')
    .text('Order ID:', 50, metaY + 36)
    .font('Helvetica')
    .text(payment.razorpayOrderId || 'N/A', 140, metaY + 36);

  if (payment.razorpayPaymentId) {
    doc
      .font('Helvetica-Bold')
      .text('Payment ID:', 50, metaY + 54)
      .font('Helvetica')
      .text(payment.razorpayPaymentId, 140, metaY + 54);
  }

  // ── Customer Details ───────────────────────────────────────────────────────
  doc
    .fillColor('#374151')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('Billed To:', 340, metaY)
    .font('Helvetica')
    .text(user.name || 'VideoVerse Subscriber', 340, metaY + 18)
    .text(user.email || 'N/A', 340, metaY + 36)
    .text(`User ID: ${user._id.toString()}`, 340, metaY + 54);

  // Divider
  doc
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .moveTo(50, 215)
    .lineTo(545, 215)
    .stroke();

  // ── Line Items Table ───────────────────────────────────────────────────────
  const tableTop = 235;

  // Table Header Background
  doc
    .rect(50, tableTop, 495, 25)
    .fill('#f3f4f6');

  doc
    .fillColor('#111827')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('DESCRIPTION', 60, tableTop + 8)
    .text('BILLING CYCLE', 240, tableTop + 8)
    .text('DURATION', 340, tableTop + 8)
    .text('AMOUNT', 460, tableTop + 8, { align: 'right', width: 75 });

  const itemY = tableTop + 35;
  const tierName = (payment.tier || 'free').toUpperCase();
  const cycleName = (payment.billingCycle || 'monthly').toUpperCase();
  const durationText = `${payment.durationDays || 30} Days`;
  const formattedAmount = `${payment.currency === 'INR' ? 'INR' : payment.currency} ${(payment.amount / 100).toFixed(2)}`;

  doc
    .fillColor('#374151')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text(`VideoVerse ${tierName} Membership`, 60, itemY)
    .font('Helvetica')
    .fontSize(9)
    .text('Includes controlled high-speed downloads and exclusive streaming perks', 60, itemY + 14)
    .text(cycleName, 240, itemY)
    .text(durationText, 340, itemY)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(formattedAmount, 460, itemY, { align: 'right', width: 75 });

  // Divider below items
  doc
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .moveTo(50, itemY + 40)
    .lineTo(545, itemY + 40)
    .stroke();

  // ── Calculation Summary ────────────────────────────────────────────────────
  const subtotalY = itemY + 55;
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#4b5563')
    .text('Subtotal:', 340, subtotalY)
    .text(formattedAmount, 460, subtotalY, { align: 'right', width: 75 });

  doc
    .text('GST / Taxes (18% included):', 340, subtotalY + 16)
    .text(`${payment.currency === 'INR' ? 'INR' : payment.currency} ${((payment.amount / 100) * 0.18 / 1.18).toFixed(2)}`, 460, subtotalY + 16, { align: 'right', width: 75 });

  // Total bar
  doc
    .rect(330, subtotalY + 36, 215, 28)
    .fill('#f9fafb')
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .stroke();

  doc
    .fillColor('#111827')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('Total Paid:', 340, subtotalY + 44)
    .text(formattedAmount, 460, subtotalY + 44, { align: 'right', width: 75 });

  // ── Footer & Disclaimers ───────────────────────────────────────────────────
  doc
    .fillColor('#9ca3af')
    .fontSize(8)
    .font('Helvetica')
    .text(
      'This is an electronically generated invoice and does not require a physical signature. Powered by Razorpay Payment Gateway.',
      50,
      680,
      { align: 'center', width: 495 }
    )
    .text(
      'VideoVerse Platform Inc. | CIN: U72900KA2026PTC123456 | GSTIN: 29AABCU9603R1Z7',
      50,
      695,
      { align: 'center', width: 495 }
    );

  doc.end();
}

module.exports = {
  generateInvoicePDF,
};

