import { useState, useCallback } from 'react';
import {
  Crown, Star, Zap, Check, X, Download, MessageSquare,
  Shield, Infinity as InfinityIcon, ArrowRight, Loader2,
  CreditCard, ChevronDown, ChevronUp, BadgeCheck
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './SubscriptionPage.css';

// ── Tier definitions (for display only — amounts are authoritative on server) ─
const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '₹0',
    period: 'forever',
    description: 'Everything you need to get started',
    badge: null,
    color: 'free',
    features: [
      { text: '5 downloads per 24 hours', included: true },
      { text: 'Full video library access', included: true },
      { text: 'Comments & interactions', included: true },
      { text: 'Watch Later & History', included: true },
      { text: 'Standard video quality', included: true },
      { text: 'Priority support', included: false },
      { text: 'Unlimited downloads', included: false },
      { text: 'Exclusive VIP badge', included: false },
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '₹199',
    period: 'per month',
    description: 'For dedicated video enthusiasts',
    badge: '⭐ Most Popular',
    color: 'premium',
    features: [
      { text: '25 downloads per 24 hours', included: true },
      { text: 'Full video library access', included: true },
      { text: 'Comments & interactions', included: true },
      { text: 'Watch Later & History', included: true },
      { text: 'HD video quality priority', included: true },
      { text: 'Priority support', included: true },
      { text: 'Unlimited downloads', included: false },
      { text: 'Exclusive VIP badge', included: false },
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    price: '₹499',
    period: 'per month',
    description: 'The ultimate VideoVerse experience',
    badge: '👑 Best Value',
    color: 'vip',
    features: [
      { text: 'Unlimited downloads', included: true },
      { text: 'Full video library access', included: true },
      { text: 'Comments & interactions', included: true },
      { text: 'Watch Later & History', included: true },
      { text: 'HD video quality priority', included: true },
      { text: 'Priority support', included: true },
      { text: 'Exclusive VIP badge', included: true },
      { text: 'Early access to new features', included: true },
    ],
  },
];

const FAQ_ITEMS = [
  {
    q: 'Is this real money?',
    a: 'No. This app uses Razorpay in Test Mode. No real charges are made. Use Razorpay test cards (e.g. 4111 1111 1111 1111) to complete a test payment.',
  },
  {
    q: 'What happens to my downloads after upgrading?',
    a: 'Your new quota takes effect immediately. If you are on Premium (25/day) or VIP (unlimited), you can download more videos within the next 24-hour window.',
  },
  {
    q: 'Can I upgrade from Premium to VIP?',
    a: 'Yes. Click "Get VIP" to upgrade your existing Premium plan to VIP.',
  },
  {
    q: 'Can I downgrade my plan?',
    a: 'Downgrades are not supported in this MVP. Contact support if needed.',
  },
  {
    q: 'How does the Razorpay test checkout work?',
    a: 'Click "Get Premium" or "Get VIP". You\'ll see the Razorpay checkout popup. Enter any test card number (see Razorpay test card docs) and complete the payment. The tier upgrade is processed server-side after signature verification.',
  },
];

export default function SubscriptionPage() {
  const { currentUser, upgradeTier, paymentLoading, showToast } = useApp();
  const [openFaqIndex, setOpenFaqIndex] = useState(null);

  const currentTier = currentUser?.subscriptionTier || 'free';

  const handleUpgrade = useCallback(async (tierId) => {
    if (!currentUser) {
      showToast('Please sign in to upgrade your plan.');
      return;
    }
    await upgradeTier(tierId);
  }, [currentUser, upgradeTier, showToast]);

  function getTierIcon(tierId) {
    if (tierId === 'vip') return <Crown size={28} className="tier-icon tier-icon--vip" />;
    if (tierId === 'premium') return <Star size={28} className="tier-icon tier-icon--premium" />;
    return <Zap size={28} className="tier-icon tier-icon--free" />;
  }

  function getButtonState(tier) {
    if (currentTier === tier.id) return { label: 'Current Plan', disabled: true, current: true };
    if (tier.id === 'free') return { label: null, disabled: true, current: false }; // No CTA for free
    if (currentTier === 'vip') return { label: `Switch to ${tier.name}`, disabled: true, current: false };
    return { label: `Get ${tier.name}`, disabled: paymentLoading, current: false };
  }

  return (
    <div className="subscription-page" id="subscription-page">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="subscription-hero">
        <div className="subscription-hero__badge">
          <CreditCard size={14} />
          <span>Razorpay Test Mode — No real charges</span>
        </div>
        <h1 className="subscription-hero__title">
          Upgrade Your <span className="gradient-text">VideoVerse</span> Experience
        </h1>
        <p className="subscription-hero__subtitle">
          Unlock more downloads, exclusive badges, and priority support.
          Cancel anytime.
        </p>
        {currentUser && (
          <p className="subscription-hero__current">
            You are currently on the{' '}
            <span className={`tier-chip tier-chip--${currentTier}`}>
              {currentTier === 'free' ? 'Free' : currentTier === 'premium' ? '⭐ Premium' : '👑 VIP'}
            </span>{' '}
            plan.
          </p>
        )}
      </div>

      {/* ── Tier Cards ──────────────────────────────────────────────────── */}
      <div className="subscription-tiers">
        {TIERS.map((tier) => {
          const btn = getButtonState(tier);
          const isCurrent = currentTier === tier.id;
          return (
            <div
              key={tier.id}
              className={`tier-card tier-card--${tier.color} ${isCurrent ? 'tier-card--current' : ''}`}
            >
              {tier.badge && (
                <div className={`tier-badge tier-badge--${tier.color}`}>{tier.badge}</div>
              )}

              <div className="tier-card__header">
                {getTierIcon(tier.id)}
                <h2 className="tier-card__name">{tier.name}</h2>
                <div className="tier-card__price">
                  <span className="tier-card__amount">{tier.price}</span>
                  <span className="tier-card__period">/{tier.period}</span>
                </div>
                <p className="tier-card__desc">{tier.description}</p>
              </div>

              <ul className="tier-card__features" aria-label={`${tier.name} plan features`}>
                {tier.features.map((f, i) => (
                  <li key={i} className={`tier-feature ${f.included ? 'tier-feature--yes' : 'tier-feature--no'}`}>
                    {f.included
                      ? <Check size={14} className="tier-feature__icon" aria-hidden="true" />
                      : <X size={14} className="tier-feature__icon" aria-hidden="true" />
                    }
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
                    onClick={() => handleUpgrade(tier.id)}
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
                    <span>{btn.label || 'Your Current Plan'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Feature Comparison ──────────────────────────────────────────── */}
      <div className="subscription-compare">
        <h2 className="subscription-compare__title">What's Included</h2>
        <div className="compare-grid">
          <div className="compare-row compare-row--header">
            <span>Feature</span>
            <span>Free</span>
            <span>Premium</span>
            <span>VIP</span>
          </div>
          {[
            ['Daily Downloads', '5', '25', 'Unlimited'],
            ['Video Library Access', '✓', '✓', '✓'],
            ['Comments', '✓', '✓', '✓'],
            ['Watch Later', '✓', '✓', '✓'],
            ['Priority Support', '✗', '✓', '✓'],
            ['Exclusive Badge', '✗', '✗', '✓'],
            ['Early Access', '✗', '✗', '✓'],
          ].map(([feature, free, premium, vip], i) => (
            <div key={i} className="compare-row">
              <span className="compare-feature">{feature}</span>
              <span className={free === '✗' ? 'compare-no' : 'compare-yes'}>{free === '✗' ? <X size={14} /> : free === '✓' ? <Check size={14} /> : free}</span>
              <span className={premium === '✗' ? 'compare-no' : 'compare-yes'}>{premium === '✗' ? <X size={14} /> : premium === '✓' ? <Check size={14} /> : premium}</span>
              <span className={vip === '✗' ? 'compare-no' : 'compare-yes'}>{vip === '✗' ? <X size={14} /> : vip === '✓' ? <Check size={14} /> : vip}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Security Note ────────────────────────────────────────────────── */}
      <div className="subscription-security">
        <Shield size={18} className="subscription-security__icon" />
        <div>
          <p className="subscription-security__title">Secure Payments via Razorpay</p>
          <p className="subscription-security__desc">
            All payment verification is done server-side with HMAC-SHA256 signature validation.
            Your payment data never touches our application servers directly — only
            the Razorpay order ID and verified payment status are stored.
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
              {openFaqIndex === i && (
                <p className="faq-answer">{item.a}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Test Mode Disclaimer ─────────────────────────────────────────── */}
      <div className="subscription-disclaimer">
        <p>
          🧪 <strong>Test Mode Active.</strong> This integration uses Razorpay's test environment.
          No real charges are made. To get test API keys, visit{' '}
          <a
            href="https://dashboard.razorpay.com/app/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="disclaimer-link"
          >
            dashboard.razorpay.com
          </a>.
          Use test card <code>4111 1111 1111 1111</code> with any future expiry and CVV.
        </p>
      </div>
    </div>
  );
}
