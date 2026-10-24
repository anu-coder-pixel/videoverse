import { useState, useEffect, useRef } from 'react';
import {
  X,
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Laptop,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './AuthModal.css';

export default function AuthModal() {
  const {
    authModalOpen,
    closeAuthModal,
    login,
    verifyOtp,
    resendOtp,
    getDevLastOtp,
    register,
  } = useApp();

  // Wizard state: 'credentials' | 'otp'
  const [step, setStep] = useState('credentials');
  const [isRegister, setIsRegister] = useState(false);

  // Credentials form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // OTP form
  const [tempToken, setTempToken] = useState('');
  const [destinationMasked, setDestinationMasked] = useState('');
  const [otp, setOtp] = useState('');
  const [deviceName, setDeviceName] = useState('My Browser');
  const [resendCountdown, setResendCountdown] = useState(0);
  const [devOtp, setDevOtp] = useState('');

  // Status & error
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const modalRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && authModalOpen) {
        closeAuthModal();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authModalOpen, closeAuthModal]);

  // Reset form when modal opens or closes
  useEffect(() => {
    if (!authModalOpen) {
      setStep('credentials');
      setError('');
      setLoading(false);
      setOtp('');
      setDevOtp('');
    }
  }, [authModalOpen]);

  // Reset error when switching register/login
  useEffect(() => {
    setError('');
    setLoading(false);
  }, [isRegister]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  if (!authModalOpen) return null;

  // Handle Step 1: Submit Credentials
  async function handleCredentialsSubmit(e) {
    e.preventDefault();
    setError('');

    if (isRegister && (!name || !name.trim())) {
      setError('Please enter your full name.');
      return;
    }
    if (!email || !email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    let result;
    if (isRegister) {
      result = await register(name.trim(), email.trim(), password);
    } else {
      result = await login(email.trim(), password);
    }
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Authentication failed. Please try again.');
      return;
    }

    // Check if step-up OTP is required for this untrusted device
    if (result.requiresOtp) {
      setStep('otp');
      setTempToken(result.tempToken);
      setDestinationMasked(result.destinationMasked || 'your registered email');
      setResendCountdown(result.resendAvailableIn || 60);
      setOtp('');

      // Auto-detect browser/OS for friendly device name
      const ua = navigator.userAgent;
      let detectedName = 'Personal Computer';
      if (/iPhone|iPad|iPod/i.test(ua)) detectedName = 'Apple Mobile';
      else if (/Android/i.test(ua)) detectedName = 'Android Device';
      else if (/Macintosh|Mac OS X/i.test(ua)) detectedName = 'MacBook';
      else if (/Windows/i.test(ua)) detectedName = 'Windows PC';
      setDeviceName(detectedName);

      // Local dev testing helper: check if dev OTP is available
      const devRes = await getDevLastOtp(result.tempToken);
      if (devRes.success && devRes.otp) {
        setDevOtp(devRes.otp);
      }
    }
  }

  // Handle Step 2: Submit OTP
  async function handleOtpSubmit(e) {
    e.preventDefault();
    setError('');

    const cleanOtp = otp.trim().replace(/\D/g, '');
    if (cleanOtp.length !== 6) {
      setError('Please enter the full 6-digit verification code.');
      return;
    }

    setLoading(true);
    const result = await verifyOtp(tempToken, cleanOtp, deviceName.trim());
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Failed to verify code. Please try again.');
    }
  }

  // Handle Resend OTP
  async function handleResendCode() {
    if (resendCountdown > 0 || loading) return;
    setError('');
    setLoading(true);
    const result = await resendOtp(tempToken);
    setLoading(false);

    if (result.success) {
      setResendCountdown(result.resendAvailableIn || 60);
      // Refresh dev helper if available
      const devRes = await getDevLastOtp(tempToken);
      if (devRes.success && devRes.otp) {
        setDevOtp(devRes.otp);
      }
    } else {
      setError(result.error || 'Failed to resend code.');
      if (result.canResendIn) {
        setResendCountdown(result.canResendIn);
      }
    }
  }

  return (
    <div
      className="auth-modal__overlay animate-fade-in"
      onClick={closeAuthModal}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="auth-modal__dialog glass"
        onClick={e => e.stopPropagation()}
        ref={modalRef}
      >
        {/* Header */}
        <div className="auth-modal__header">
          <div className="auth-modal__brand">
            <div className="auth-modal__logo-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="auth-modal__logo-icon">
                <path d="M8 5v14l11-7z" fill="white" />
              </svg>
            </div>
            <span className="auth-modal__brand-title">VideoVerse</span>
          </div>
          <button
            type="button"
            className="auth-modal__close-btn"
            onClick={closeAuthModal}
            aria-label="Close authentication modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── STEP 1: CREDENTIALS (LOGIN / REGISTER) ────────────────────────── */}
        {step === 'credentials' && (
          <>
            {/* Tab switch */}
            <div className="auth-modal__tabs" role="tablist">
              <button
                type="button"
                className={`auth-modal__tab ${!isRegister ? 'auth-modal__tab--active' : ''}`}
                onClick={() => setIsRegister(false)}
                role="tab"
                aria-selected={!isRegister}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-modal__tab ${isRegister ? 'auth-modal__tab--active' : ''}`}
                onClick={() => setIsRegister(true)}
                role="tab"
                aria-selected={isRegister}
              >
                Create Account
              </button>
            </div>

            <p className="auth-modal__subtitle">
              {isRegister
                ? 'Join VideoVerse to save playlists, like videos, and subscribe to creators.'
                : 'Sign in to access your saved videos, subscriptions, and history.'}
            </p>

            {error && (
              <div className="auth-modal__error-banner" role="alert">
                {error}
              </div>
            )}

            {/* Form */}
            <form className="auth-modal__form" onSubmit={handleCredentialsSubmit} noValidate>
              {isRegister && (
                <div className="auth-modal__field">
                  <label htmlFor="auth-name">Full Name</label>
                  <div className="auth-modal__input-wrapper">
                    <User size={18} className="auth-modal__field-icon" aria-hidden="true" />
                    <input
                      id="auth-name"
                      type="text"
                      placeholder="e.g. Alex Johnson"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="auth-modal__field">
                <label htmlFor="auth-email">Email Address</label>
                <div className="auth-modal__input-wrapper">
                  <Mail size={18} className="auth-modal__field-icon" aria-hidden="true" />
                  <input
                    id="auth-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="auth-modal__field">
                <label htmlFor="auth-password">Password</label>
                <div className="auth-modal__input-wrapper">
                  <Lock size={18} className="auth-modal__field-icon" aria-hidden="true" />
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    required
                  />
                  <button
                    type="button"
                    className="auth-modal__password-toggle"
                    onClick={() => setShowPassword(prev => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="auth-modal__submit-btn"
                disabled={loading}
                id="auth-submit-btn"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="auth-modal__spinner" />
                    <span>Processing...</span>
                  </>
                ) : isRegister ? (
                  'Create Account'
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="auth-modal__footer">
              <p>
                {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  className="auth-modal__switch-link"
                  onClick={() => setIsRegister(prev => !prev)}
                >
                  {isRegister ? 'Sign In' : 'Create one now'}
                </button>
              </p>
            </div>
          </>
        )}

        {/* ── STEP 2: TWO-FACTOR OTP & TRUSTED DEVICE ───────────────────────── */}
        {step === 'otp' && (
          <div className="animate-fade-in">
            <div className="auth-modal__otp-icon-wrap" aria-hidden="true">
              <ShieldCheck size={28} />
            </div>

            <h3 style={{ textAlign: 'center', fontSize: '18px', fontWeight: '700', marginBottom: '6px' }}>
              Verify New Device
            </h3>

            <p className="auth-modal__subtitle" style={{ textAlign: 'center', marginBottom: '16px' }}>
              We sent a 6-digit verification code to <strong>{destinationMasked}</strong>.
            </p>

            {error && (
              <div className="auth-modal__error-banner" role="alert" style={{ marginBottom: '14px' }}>
                {error}
              </div>
            )}

            <form className="auth-modal__form" onSubmit={handleOtpSubmit} noValidate>
              <div className="auth-modal__field">
                <label htmlFor="auth-otp-input">Enter 6-Digit Code</label>
                <input
                  id="auth-otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="••••••"
                  className="auth-modal__otp-input"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  required
                />
              </div>

              <div className="auth-modal__field">
                <label htmlFor="auth-device-name">Device Name (30-day trust)</label>
                <div className="auth-modal__input-wrapper">
                  <Laptop size={18} className="auth-modal__field-icon" aria-hidden="true" />
                  <input
                    id="auth-device-name"
                    type="text"
                    placeholder="e.g. My Laptop"
                    value={deviceName}
                    onChange={e => setDeviceName(e.target.value)}
                    maxLength={40}
                  />
                </div>
              </div>

              <div className="auth-modal__otp-actions">
                <button
                  type="button"
                  className="auth-modal__resend-btn"
                  onClick={handleResendCode}
                  disabled={resendCountdown > 0 || loading}
                >
                  {resendCountdown > 0
                    ? `Resend code in ${resendCountdown}s`
                    : 'Resend verification code'}
                </button>
              </div>

              {/* Dev mode auto-fill helper (Strictly disabled in production) */}
              {devOtp && (
                <div className="auth-modal__dev-badge">
                  <span>🛠 Dev Code: <strong>{devOtp}</strong></span>
                  <button
                    type="button"
                    className="auth-modal__dev-fill-btn"
                    onClick={() => setOtp(devOtp)}
                  >
                    Auto-Fill
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="auth-modal__submit-btn"
                disabled={loading || otp.trim().length !== 6}
                id="auth-verify-otp-btn"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="auth-modal__spinner" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  'Verify & Trust Device'
                )}
              </button>
            </form>

            <div className="auth-modal__footer" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="btn--ghost"
                style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => {
                  setStep('credentials');
                  setError('');
                }}
              >
                <ArrowLeft size={14} />
                <span>Back to Sign In</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
