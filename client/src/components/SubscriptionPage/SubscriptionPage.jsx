import { useState, useEffect, useCallback } from 'react';
import {
  Crown, Star, Zap, Award, Check, X, Download, Shield,
  ArrowRight, Loader2, CreditCard, ChevronDown, ChevronUp,
  BadgeCheck, Calendar, Receipt, AlertCircle, RefreshCw, FileText
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './SubscriptionPage.css';

// ── Multi-Cycle Plan Definitions ──────────────────────────────────────────────
const PLAN_TIERS = [
  {
    id: 'free',
    name: 'Free',
    color: 'free',
    badge: null,
    description: 'Essential viewing with daily offline access',
    prices: {
      monthly: { amount: '₹0', period: 'forever' },
      quarterly: { amount: '₹0', period: 'forever' },
      yearly: { amount: '₹0', period: 'forever' },
    },
    features: [
      { text: '1 download per 24 hours', included: true, highlight: true },
      { text: 'Full video library access', included: true },
      { text: 'Multilingual comments & translation', included: true },
      { text: 'Watch Later & Watch History', included: true },
      { text: 'Standard video streaming', included: true },
      { text: 'Priority support', included: false },
      { text: 'HD streaming priority', included: false },
      { text: 'VIP exclusive badge', included: false },
    ],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    color: 'bronze',
    badge: '🥉 Starter',
    description: 'Perfect for casual viewers wanting offline flexibility',
    prices: {
      monthly: { amount: '₹99', period: 'per month', raw: 99 },
      quarterly: { amount: '₹249', period: 'for 3 months', note: 'Save 16%', raw: 249 },
      yearly: { amount: '₹899', period: 'for 1 year', note: 'Save 24%', raw: 899 },
    },
    features: [
      { text: '5 downloads per 24 hours', included: true, highlight: true },
      { text: 'Full video library access', included: true },
      { text: 'Multilingual comments & translation', included: true },
      { text: 'Watch Later & Watch History', included: true },
      { text: 'High-speed video streaming', included: true },
      { text: 'Standard email support', included: true },
      { text: 'HD streaming priority', included: false },
      { text: 'VIP exclusive badge', included: false },
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    color: 'silver',
    badge: '⭐ Most Popular',
    description: 'For dedicated video enthusiasts and heavy downloaders',
    prices: {
      monthly: { amount: '₹199', period: 'per month', raw: 199 },
      quarterly: { amount: '₹499', period: 'for 3 months', note: 'Save 16%', raw: 499 },
      yearly: { amount: '₹1,799', period: 'for 1 year', note: 'Save 25%', raw: 1799 },
    },
    features: [
      { text: '25 downloads per 24 hours', included: true, highlight: true },
      { text: 'Full video library access', included: true },
      { text: 'Multilingual comments & translation', included: true },
      { text: 'Watch Later & Watch History', included: true },
      { text: 'HD video streaming priority', included: true },
      { text: 'Priority email & chat support', included: true },
      { text: 'Early access to select content', included: true },
      { text: 'VIP exclusive badge', included: false },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    color: 'gold',
    badge: '👑 Best Value',
    description: 'The ultimate VideoVerse VIP experience with no limits',
    prices: {
      monthly: { amount: '₹499', period: 'per month', raw: 499 },
      quarterly: { amount: '₹1,299', period: 'for 3 months', note: 'Save 13%', raw: 1299 },
      yearly: { amount: '₹4,499', period: 'for 1 year', note: 'Save 25%', raw: 4499 },
    },
    features: [
      { text: 'Unlimited downloads (No cap)', included: true, highlight: true },
      { text: 'Full video library access', included: true },
      { text: 'Multilingual comments & translation', included: true },
      { text: 'Watch Later & Watch History', included: true },
      { text: 'Ultra HD 4K streaming priority', included: true },
      { text: '24/7 dedicated VIP priority support', included: true },
      { text: 'Exclusive Gold VIP member badge', included: true },
      { text: 'Early access to all upcoming features', included: true },
    ],
  },
];

const FAQ_ITEMS = [
  {
    q: 'How do daily download quotas work?',
    a: 'Download quotas operate on a rolling 24-hour window from the moment each video is saved. Free users receive 1 download/day, Bronze gets 5, Silver gets 25, and Gold members enjoy unlimited downloads. Re-downloading the same video within 24 hours never consumes extra quota.',
  },
  {
    q: 'Is this real money or test mode?',
    a: 'This integration runs Razorpay in Test Mode. No real charges are made. You can safely complete test transactions using standard Razorpay test cards (e.g. 4111 1111 1111 1111) with any future expiry and CVV.',
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes! When you cancel, future renewals are stopped immediately, but your account retains all premium benefits, badges, and download limits until the end of your prepaid billing period.',
  },
  {
    q: 'What happens when a subscription expires?',
    a: 'If a subscription is not renewed before its expiry date, your account automatically and safely transitions to the Free plan (1 download/24h). Your download history and user data are never lost.',
  },
  {
    q: 'Can I upgrade between plans (e.g. Bronze to Gold)?',
    a: 'Yes! You can upgrade anytime. Upgrading immediately extends and enhances your plan benefits with server-side validation and automated invoice tracking.',
  },
];

export default function SubscriptionPage() {
  const {
    currentUser,
    upgradeTier,
    cancelSubscription,
    paymentLoading,
    quotaInfo,
    showToast,
  } = useApp();

  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'quarterly' | 'yearly'
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState(null);

  // Download Invoice PDF
  const handleDownloadInvoice = async (invoiceId) => {
    if (!invoiceId) {
      showToast('No invoice identifier available for this record.');
      return;
    }
    setDownloadingInvoiceId(invoiceId);
    try {
      const res = await fetch(`/api/payments/invoices/${encodeURIComponent(invoiceId)}/download`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        showToast(errJson.error || 'Failed to download invoice PDF.');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Invoice PDF downloaded successfully!');
    } catch (err) {
      console.error('[Invoice Download Error]', err);
      showToast('Network error while downloading invoice.');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  // Normalize user tier
  const currentTierRaw = currentUser?.subscriptionTier || 'free';
  const currentTier =
    currentTierRaw === 'vip' ? 'gold' : currentTierRaw === 'premium' ? 'silver' : currentTierRaw;

  // Load payment history
  const loadPaymentHistory = useCallback(async () => {
    if (!currentUser) return;
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/payments/history', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPaymentHistory(Array.isArray(data.payments) ? data.payments : []);
      }
    } catch (err) {
      console.warn('[SubscriptionPage] Failed to fetch payment history:', err.message);
    } finally {
      setHistoryLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadPaymentHistory();
  }, [loadPaymentHistory]);

  const handleUpgradeClick = async (tierId) => {
    if (!currentUser) {
      showToast('Please sign in to select a subscription plan.');
      return;
    }
    await upgradeTier(tierId, billingCycle);
    loadPaymentHistory();
  };

  const handleCancelConfirm = async () => {
    setCancelling(true);
    const success = await cancelSubscription();
    setCancelling(false);
    setShowCancelModal(false);
    if (success) {
      loadPaymentHistory();
    }
  };

  function getTierIcon(tierId) {
    switch (tierId) {
      case 'gold':
      case 'vip':
        return <Crown size={30} className="tier-icon tier-icon--gold" />;
      case 'silver':
      case 'premium':
        return <Award size={30} className="tier-icon tier-icon--silver" />;
      case 'bronze':
        return <Star size={30} className="tier-icon tier-icon--bronze" />;
      default:
        return <Zap size={30} className="tier-icon tier-icon--free" />;
    }
  }

  function getButtonState(tier) {
    if (currentTier === tier.id) {
      return { label: 'Current Plan', disabled: true, current: true };
    }
    if (tier.id === 'free') {
      return { label: null, disabled: true, current: false };
    }
    return { label: `Get ${tier.name}`, disabled: paymentLoading, current: false };
  }

  const isPaidActive = currentTier !== 'free' && !currentUser?.isSubscriptionExpired;
  const isCancelled = Boolean(currentUser?.subscriptionCancelledAt);

  return (
    <div className="subscription-page" id="subscription-page">
      {/* ── Hero Section ────────────────────────────────────────────────── */}
      <div className="subscription-hero">
        <div className="subscription-hero__badge">
          <CreditCard size={14} />
          <span>Razorpay Test Mode — 100% Safe Simulation</span>
        </div>
        <h1 className="subscription-hero__title">
          Flexible Plans for <span className="gradient-text">VideoVerse</span> Viewers
        </h1>
        <p className="subscription-hero__subtitle">
          Unlock controlled video downloads, higher quality, and exclusive perks.
          Upgrade, renew, or cancel anytime.
        </p>

        {/* ── Active Subscription Status Banner ──────────────────────────── */}
        {currentUser && (
          <div className="subscription-status-card" id="active-subscription-card">
            <div className="subscription-status-card__header">
              <div className="subscription-status-card__info">
                <span className="status-label">Active Plan</span>
                <div className="status-tier-row">
                  <span className={`tier-chip tier-chip--${currentTier}`}>
                    {currentTier === 'gold' && '👑 Gold VIP'}
                    {currentTier === 'silver' && '🥈 Silver'}
                    {currentTier === 'bronze' && '🥉 Bronze'}
                    {currentTier === 'free' && '⚡ Free'}
                  </span>
                  {currentUser.subscriptionBillingCycle && (
                    <span className="cycle-chip">
                      {currentUser.subscriptionBillingCycle.toUpperCase()}
                    </span>
                  )}
                  {isCancelled && (
                    <span className="status-badge status-badge--warning">
                      Cancellation Scheduled
                    </span>
                  )}
                </div>
              </div>

              {/* Expiry Details */}
              <div className="subscription-status-card__dates">
                {currentUser.subscriptionExpiresAt ? (
                  <div className="date-item">
                    <Calendar size={14} />
                    <span>
                      {isCancelled ? 'Access ends: ' : 'Renews on: '}
                      <strong>{new Date(currentUser.subscriptionExpiresAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="date-item text-muted">
                    <span>Unlimited lifetime Free tier</span>
                  </div>
                )}
                <div className="quota-pill">
                  <Download size={13} />
                  <span>
                    {quotaInfo.limit === null
                      ? 'Unlimited downloads'
                      : `${quotaInfo.remaining} / ${quotaInfo.limit} left today`}
                  </span>
                </div>
              </div>

              {/* Cancellation CTA */}
              {isPaidActive && !isCancelled && (
                <button
                  className="btn-cancel-sub"
                  onClick={() => setShowCancelModal(true)}
                  id="cancel-subscription-btn"
                >
                  Cancel Plan
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Billing Cycle Pill Toggle ────────────────────────────────────── */}
      <div className="billing-cycle-toggle-wrapper" role="radiogroup" aria-label="Billing Cycle Options">
        <div className="billing-cycle-toggle">
          <button
            type="button"
            className={`cycle-btn ${billingCycle === 'monthly' ? 'cycle-btn--active' : ''}`}
            onClick={() => setBillingCycle('monthly')}
            id="billing-cycle-monthly"
          >
            Monthly
          </button>
          <button
            type="button"
            className={`cycle-btn ${billingCycle === 'quarterly' ? 'cycle-btn--active' : ''}`}
            onClick={() => setBillingCycle('quarterly')}
            id="billing-cycle-quarterly"
          >
            <span>Quarterly</span>
            <span className="discount-tag">Save 16%</span>
          </button>
          <button
            type="button"
            className={`cycle-btn ${billingCycle === 'yearly' ? 'cycle-btn--active' : ''}`}
            onClick={() => setBillingCycle('yearly')}
            id="billing-cycle-yearly"
          >
            <span>Yearly</span>
            <span className="discount-tag discount-tag--best">Save up to 25%</span>
          </button>
        </div>
      </div>

      {/* ── 4-Tier Plan Cards ────────────────────────────────────────────── */}
      <div className="subscription-tiers subscription-tiers--four" id="subscription-tiers-grid">
        {PLAN_TIERS.map((tier) => {
          const btn = getButtonState(tier);
          const isCurrent = currentTier === tier.id;
          const priceObj = tier.prices[billingCycle];

          return (
            <div
              key={tier.id}
              className={`tier-card tier-card--${tier.color} ${isCurrent ? 'tier-card--current' : ''}`}
              id={`tier-card-${tier.id}`}
            >
              {tier.badge && (
                <div className={`tier-badge tier-badge--${tier.color}`}>{tier.badge}</div>
              )}

              <div className="tier-card__header">
                {getTierIcon(tier.id)}
                <h2 className="tier-card__name">{tier.name}</h2>
                <div className="tier-card__price">
                  <span className="tier-card__amount">{priceObj.amount}</span>
                  <span className="tier-card__period">/{priceObj.period}</span>
                </div>
                {priceObj.note && (
                  <span className="tier-card__savings">{priceObj.note}</span>
                )}
                <p className="tier-card__desc">{tier.description}</p>
              </div>

              <ul className="tier-card__features" aria-label={`${tier.name} features`}>
                {tier.features.map((f, i) => (
                  <li
                    key={i}
                    className={`tier-feature ${f.included ? 'tier-feature--yes' : 'tier-feature--no'} ${f.highlight ? 'tier-feature--highlight' : ''}`}
                  >
                    {f.included ? (
                      <Check size={15} className="tier-feature__icon" aria-hidden="true" />
                    ) : (
                      <X size={15} className="tier-feature__icon" aria-hidden="true" />
                    )}
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>

              <div className="tier-card__cta">
                {tier.id === 'free' ? (
                  isCurrent ? (
                    <div className="tier-cta-current">
                      <BadgeCheck size={16} />
                      <span>Your Current Plan</span>
                    </div>
                  ) : null
                ) : (
                  <button
                    className={`tier-cta-btn tier-cta-btn--${tier.color} ${btn.current ? 'tier-cta-btn--current' : ''}`}
                    onClick={() => handleUpgradeClick(tier.id)}
                    disabled={btn.disabled || paymentLoading}
                    id={`upgrade-${tier.id}-btn`}
                    aria-label={btn.label}
                  >
                    {paymentLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : btn.current ? (
                      <BadgeCheck size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                    <span>{btn.label}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Feature Comparison Matrix ────────────────────────────────────── */}
      <div className="subscription-compare" id="features-comparison-matrix">
        <h2 className="subscription-compare__title">Detailed Feature Comparison</h2>
        <div className="compare-grid compare-grid--four">
          <div className="compare-row compare-row--header">
            <span>Feature</span>
            <span>Free</span>
            <span>Bronze</span>
            <span>Silver</span>
            <span>Gold VIP</span>
          </div>
          {[
            ['Daily Video Downloads', '1 / 24h', '5 / 24h', '25 / 24h', 'Unlimited'],
            ['Duplicate Download (24h free)', '✓', '✓', '✓', '✓'],
            ['Video Library Access', '✓', '✓', '✓', '✓'],
            ['Multilingual Translation', '✓', '✓', '✓', '✓'],
            ['Watch Later & History', '✓', '✓', '✓', '✓'],
            ['Streaming Quality Priority', 'Standard', 'High', 'Full HD', 'Ultra 4K'],
            ['Priority Customer Support', '✗', 'Standard', 'Priority', '24/7 Dedicated'],
            ['Exclusive VIP Crown Badge', '✗', '✗', '✗', '✓'],
            ['Early Feature Access', '✗', '✗', '✓', '✓'],
          ].map(([feature, free, bronze, silver, gold], i) => (
            <div key={i} className="compare-row">
              <span className="compare-feature">{feature}</span>
              <span className={free === '✗' ? 'compare-no' : 'compare-val'}>
                {free === '✗' ? <X size={14} /> : free === '✓' ? <Check size={14} /> : free}
              </span>
              <span className={bronze === '✗' ? 'compare-no' : 'compare-val'}>
                {bronze === '✗' ? <X size={14} /> : bronze === '✓' ? <Check size={14} /> : bronze}
              </span>
              <span className={silver === '✗' ? 'compare-no' : 'compare-val'}>
                {silver === '✗' ? <X size={14} /> : silver === '✓' ? <Check size={14} /> : silver}
              </span>
              <span className={gold === '✗' ? 'compare-no' : 'compare-val compare-gold'}>
                {gold === '✗' ? <X size={14} /> : gold === '✓' ? <Check size={14} /> : gold}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Transaction & Billing History ────────────────────────────────── */}
      {currentUser && (
        <div className="subscription-history-section" id="payment-history-section">
          <div className="subscription-history-header">
            <div className="history-title-row">
              <Receipt size={20} className="text-brand-primary" />
              <h2>Billing & Payment History</h2>
            </div>
            <button
              className="btn-refresh-history"
              onClick={loadPaymentHistory}
              disabled={historyLoading}
              title="Refresh transaction history"
            >
              <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {historyLoading ? (
            <div className="history-loading">
              <Loader2 size={24} className="animate-spin" />
              <p>Loading transactions...</p>
            </div>
          ) : paymentHistory.length === 0 ? (
            <div className="history-empty">
              <p>No billing transactions found. Once you upgrade, invoices and receipts will appear here.</p>
            </div>
          ) : (
            <div className="payment-history-table-wrapper">
              <table className="payment-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Cycle</th>
                    <th>Invoice #</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}</td>
                      <td>
                        <span className={`history-plan-tag history-plan-tag--${item.tier}`}>
                          {item.tier.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-capitalize">{item.billingCycle || 'monthly'}</td>
                      <td>
                        <code className="invoice-code">{item.invoiceNumber || '—'}</code>
                      </td>
                      <td>₹{(item.amount / 100).toFixed(2)}</td>
                      <td>
                        <span className={`status-pill status-pill--${item.status}`}>
                          {item.status === 'paid' ? 'Paid' : item.status === 'disputed' ? 'Disputed' : item.status === 'created' ? 'Pending' : 'Failed'}
                        </span>
                      </td>
                      <td>
                        {item.status === 'paid' ? (
                          <button
                            className="invoice-download-btn"
                            title="Download PDF Tax Invoice"
                            disabled={downloadingInvoiceId === (item.invoiceNumber || item.id)}
                            onClick={() => handleDownloadInvoice(item.invoiceNumber || item.id)}
                          >
                            {downloadingInvoiceId === (item.invoiceNumber || item.id) ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <>
                                <FileText size={14} />
                                <span>PDF</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-muted text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Security Note ────────────────────────────────────────────────── */}
      <div className="subscription-security">
        <Shield size={20} className="subscription-security__icon" />
        <div>
          <p className="subscription-security__title">Enterprise-Grade Security via Razorpay</p>
          <p className="subscription-security__desc">
            All upgrade payments are verified server-side using cryptographic HMAC-SHA256 signature verification.
            Card numbers and credentials never touch our application server. Razorpay key secrets are strictly protected.
          </p>
        </div>
      </div>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <div className="subscription-faq">
        <h2 className="subscription-faq__title">Frequently Asked Questions</h2>
        <div className="faq-list">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className={`faq-item ${openFaqIndex === i ? 'faq-item--open' : ''}`}>
              <button
                className="faq-question"
                onClick={() => setOpenFaqIndex(openFaqIndex === i ? null : i)}
                aria-expanded={openFaqIndex === i}
                id={`faq-item-${i}`}
              >
                <span>{item.q}</span>
                {openFaqIndex === i ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openFaqIndex === i && <p className="faq-answer">{item.a}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Test Mode Disclaimer ─────────────────────────────────────────── */}
      <div className="subscription-disclaimer">
        <p>
          🧪 <strong>Razorpay Test Mode Active:</strong> Test keys are configured safely for sandbox verification.
          Use any standard test card number <code>4111 1111 1111 1111</code> with any future expiry date and 3-digit CVV.
        </p>
      </div>

      {/* ── Cancellation Confirmation Modal ──────────────────────────────── */}
      {showCancelModal && (
        <div className="modal-overlay animate-fade-in" onClick={() => setShowCancelModal(false)}>
          <div className="cancel-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cancel-modal__header">
              <AlertCircle size={24} className="text-warning" />
              <h3>Cancel Subscription Renewal?</h3>
            </div>
            <p className="cancel-modal__body">
              Are you sure you want to stop renewal for your <strong>{currentTier.toUpperCase()}</strong> plan?
              <br /><br />
              You will keep all paid perks and download limits until your prepaid period ends on{' '}
              <strong>
                {currentUser?.subscriptionExpiresAt
                  ? new Date(currentUser.subscriptionExpiresAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })
                  : 'the end of your billing cycle'}
              </strong>.
            </p>
            <div className="cancel-modal__actions">
              <button
                className="btn-modal-back"
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
              >
                Keep Plan
              </button>
              <button
                className="btn-modal-confirm-cancel"
                onClick={handleCancelConfirm}
                disabled={cancelling}
                id="confirm-cancel-subscription-btn"
              >
                {cancelling ? <Loader2 size={16} className="animate-spin" /> : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
