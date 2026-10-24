import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Laptop,
  Smartphone,
  Tablet,
  Trash2,
  AlertTriangle,
  Clock,
  Sun,
  Moon,
  Globe,
  CheckCircle,
  RefreshCw,
  LogOut,
  MapPin,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './SecurityPage.css';

export default function SecurityPage() {
  const {
    currentUser,
    openAuthModal,
    showToast,
    theme,
    themePreference,
    updateThemePreference,
  } = useApp();

  const [devices, setDevices] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch security data
  const fetchSecurityData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [devRes, histRes] = await Promise.all([
        fetch('/api/auth/security/devices', { credentials: 'include' }),
        fetch('/api/auth/security/history', { credentials: 'include' }),
      ]);

      if (devRes.ok) {
        const devData = await devRes.json();
        setDevices(devData.devices || []);
      }
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData.history || []);
      }
    } catch (err) {
      console.warn('[SecurityPage] Failed to load security telemetry:', err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchSecurityData();
  }, [fetchSecurityData]);

  // Revoke single device
  async function handleRevokeDevice(deviceId, deviceName) {
    if (!confirm(`Revoke trust for "${deviceName}"? This device will require an OTP on its next login.`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/auth/security/devices/${deviceId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Device trust revoked successfully.');
        setDevices(prev => prev.filter(d => d.id !== deviceId));
      } else {
        showToast(data.error || 'Failed to revoke device.');
      }
    } catch (err) {
      showToast('Network error while revoking device.');
    } finally {
      setActionLoading(false);
    }
  }

  // Revoke all other devices
  async function handleRevokeOthers() {
    if (!confirm('Revoke trust for all other devices? They will all require OTP verification to sign in again.')) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch('/api/auth/security/revoke-others', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'All other devices have been revoked.');
        setDevices(prev => prev.filter(d => d.isCurrentDevice));
      } else {
        showToast(data.error || 'Failed to revoke other devices.');
      }
    } catch (err) {
      showToast('Network error while revoking other devices.');
    } finally {
      setActionLoading(false);
    }
  }

  // Device type icon helper
  function getDeviceIcon(type) {
    if (type === 'mobile') return <Smartphone size={20} />;
    if (type === 'tablet') return <Tablet size={20} />;
    return <Laptop size={20} />;
  }

  // Format date helper
  function formatDate(isoString) {
    if (!isoString) return 'Unknown';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  if (!currentUser) {
    return (
      <div className="security-page">
        <div className="security-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Shield size={48} style={{ color: 'var(--color-brand-accent)', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>
            Security & Device Telemetry
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', maxWidth: '460px', margin: '0 auto 24px' }}>
            Sign in to VideoVerse to manage your 30-day trusted devices, review security audit logs, and configure automatic theme synchronization.
          </p>
          <div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openAuthModal}
            >
              Sign In to View Security
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="security-page animate-fade-in">
      {/* Page Header */}
      <div className="security-page__header">
        <div className="security-page__title-wrap">
          <div className="security-page__icon-badge">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="security-page__title">Security & Devices</h1>
            <p className="security-page__subtitle">
              Manage trusted browsers, review login sessions, and control your appearance settings.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={fetchSecurityData}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'auth-modal__spinner' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ── SECTION 1: THEME & APPEARANCE PREFERENCES ──────────────────────── */}
      <section className="security-card">
        <div className="security-card__header">
          <div>
            <h2 className="security-card__title">
              <Sun size={18} />
              <span>Theme & Appearance</span>
            </h2>
            <p className="security-card__description">
              Choose your preferred visual mode or enable automatic time-based switching according to Indian Standard Time (IST).
            </p>
          </div>
          <span className="badge badge--mock" style={{ fontSize: '12px' }}>
            Active: {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
          </span>
        </div>

        <div className="theme-selector-grid">
          <button
            type="button"
            className={`theme-card-btn ${themePreference === 'auto' ? 'theme-card-btn--active' : ''}`}
            onClick={() => updateThemePreference('auto')}
            id="theme-pref-auto-btn"
          >
            <div className="theme-card-btn__title">
              <Clock size={18} style={{ color: 'var(--color-brand-accent)' }} />
              <span>Automatic (IST)</span>
            </div>
            <p className="theme-card-btn__desc">
              Light mode from <strong>5:00 AM – 12:00 PM IST</strong>, Dark mode at all other times.
            </p>
          </button>

          <button
            type="button"
            className={`theme-card-btn ${themePreference === 'light' ? 'theme-card-btn--active' : ''}`}
            onClick={() => updateThemePreference('light')}
            id="theme-pref-light-btn"
          >
            <div className="theme-card-btn__title">
              <Sun size={18} style={{ color: 'var(--color-warning)' }} />
              <span>Light Mode</span>
            </div>
            <p className="theme-card-btn__desc">
              Clean white surfaces with high contrast text for daytime viewing.
            </p>
          </button>

          <button
            type="button"
            className={`theme-card-btn ${themePreference === 'dark' ? 'theme-card-btn--active' : ''}`}
            onClick={() => updateThemePreference('dark')}
            id="theme-pref-dark-btn"
          >
            <div className="theme-card-btn__title">
              <Moon size={18} style={{ color: '#aaa' }} />
              <span>Dark Mode</span>
            </div>
            <p className="theme-card-btn__desc">
              Authentic YouTube dark surfaces optimized for low-light environments.
            </p>
          </button>
        </div>
      </section>

      {/* ── SECTION 2: TRUSTED DEVICES ────────────────────────────────────── */}
      <section className="security-card">
        <div className="security-card__header">
          <div>
            <h2 className="security-card__title">
              <Laptop size={18} />
              <span>Trusted Devices ({devices.length})</span>
            </h2>
            <p className="security-card__description">
              Devices with 30-day rolling trust bypass two-factor email verification. Untrusted devices must verify via a 6-digit code.
            </p>
          </div>
          {devices.length > 1 && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleRevokeOthers}
              disabled={actionLoading}
              id="revoke-all-others-btn"
            >
              <LogOut size={14} />
              <span>Revoke All Other Devices</span>
            </button>
          )}
        </div>

        {devices.length === 0 ? (
          <div className="empty-state">No trusted devices registered yet.</div>
        ) : (
          <div className="devices-list">
            {devices.map(device => (
              <div
                key={device.id}
                className={`device-item ${device.isCurrentDevice ? 'device-item--current' : ''}`}
              >
                <div className="device-item__main">
                  <div className="device-item__icon">
                    {getDeviceIcon(device.deviceType)}
                  </div>
                  <div className="device-item__info">
                    <div className="device-item__name-row">
                      <span className="device-item__name">{device.deviceName}</span>
                      {device.isCurrentDevice && (
                        <span className="device-item__badge-current">Current Device</span>
                      )}
                    </div>
                    <div className="device-item__meta">
                      <span>{device.browser} on {device.os}</span>
                      {device.lastLocation?.display && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <MapPin size={12} />
                          {device.lastLocation.display}
                        </span>
                      )}
                      <span>Expires in {device.daysUntilExpiration} days</span>
                      <span>Added: {formatDate(device.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="device-item__actions">
                  {!device.isCurrentDevice && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ color: 'var(--color-error)' }}
                      onClick={() => handleRevokeDevice(device.id, device.deviceName)}
                      disabled={actionLoading}
                      title="Revoke trust for this device"
                    >
                      <Trash2 size={16} />
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── SECTION 3: RECENT LOGIN HISTORY AUDIT TRAIL ────────────────────── */}
      <section className="security-card">
        <div className="security-card__header">
          <div>
            <h2 className="security-card__title">
              <Clock size={18} />
              <span>Recent Login History</span>
            </h2>
            <p className="security-card__description">
              Audited authentication telemetry records including timestamp, browser, operating system, and approximate location.
            </p>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="empty-state">No login history recorded yet.</div>
        ) : (
          <div className="history-table-container">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Timestamp</th>
                  <th>Device / Browser</th>
                  <th>OS</th>
                  <th>Approximate Location</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {history.map(item => (
                  <tr key={item.id}>
                    <td>
                      <span className={`history-status-badge history-status--${item.status}`}>
                        {item.status === 'success' && <CheckCircle size={12} />}
                        {item.status === 'otp_required' && <Shield size={12} />}
                        {item.status === 'failed' && <AlertTriangle size={12} />}
                        <span>
                          {item.status === 'success'
                            ? 'Success'
                            : item.status === 'otp_required'
                            ? 'OTP Required'
                            : 'Failed'}
                        </span>
                      </span>
                    </td>
                    <td>{formatDate(item.timestamp)}</td>
                    <td>{item.browser} {item.browserVersion ? `(${item.browserVersion.split('.')[0]})` : ''}</td>
                    <td>{item.os} {item.osVersion || ''}</td>
                    <td>{item.location?.display || 'Local / Private Network'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {item.ip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
