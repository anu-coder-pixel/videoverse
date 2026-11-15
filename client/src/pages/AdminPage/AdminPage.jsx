import { useState, useEffect, useCallback } from 'react';
import {
  Users, Video, MessageSquare, CreditCard, BarChart3,
  FileText, ShieldAlert, CheckCircle2, XCircle, AlertTriangle,
  Search, RefreshCw, Eye, EyeOff, Trash2, Lock, Unlock,
  Clock, ArrowUpRight, Download, HardDrive, Filter,
  ChevronLeft, ChevronRight, Info, Crown, Star, Zap, Ban,
  Shield, ExternalLink
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './AdminPage.css';

export default function AdminPage() {
  const { currentUser, showToast } = useApp();

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Overview Data
  const [overviewMetrics, setOverviewMetrics] = useState(null);

  // Users Tab State
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userTierFilter, setUserTierFilter] = useState('');
  const [userSuspendedFilter, setUserSuspendedFilter] = useState('');
  const [selectedUserDetail, setSelectedUserDetail] = useState(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [suspensionModalUser, setSuspensionModalUser] = useState(null);
  const [suspensionReason, setSuspensionReason] = useState('');

  // Videos Tab State
  const [videos, setVideos] = useState([]);
  const [videosTotal, setVideosTotal] = useState(0);
  const [videosPage, setVideosPage] = useState(1);
  const [videosTotalPages, setVideosTotalPages] = useState(1);
  const [videoSearch, setVideoSearch] = useState('');
  const [videoStatusFilter, setVideoStatusFilter] = useState('');
  const [takedownVideo, setTakedownVideo] = useState(null);
  const [takedownReason, setTakedownReason] = useState('');

  // Moderation Tab State
  const [moderationComments, setModerationComments] = useState([]);
  const [moderationTotal, setModerationTotal] = useState(0);
  const [moderationPage, setModerationPage] = useState(1);
  const [moderationStatusFilter, setModerationStatusFilter] = useState('flagged');
  const [moderationActionNote, setModerationActionNote] = useState('');

  // Payments Tab State
  const [paymentAnalytics, setPaymentAnalytics] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [invoicesPage, setInvoicesPage] = useState(1);
  const [invoicesTotalPages, setInvoicesTotalPages] = useState(1);
  const [invoiceSearch, setInvoiceSearch] = useState('');

  // Platform Analytics State
  const [platformAnalytics, setPlatformAnalytics] = useState(null);

  // Audit Logs Tab State
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [auditLogsPage, setAuditLogsPage] = useState(1);
  const [auditLogsTotalPages, setAuditLogsTotalPages] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditTargetFilter, setAuditTargetFilter] = useState('');
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  // ── Fetchers ───────────────────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/overview', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load overview`);
      const data = await res.json();
      setOverviewMetrics(data.metrics);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit: 15 });
      if (userSearch.trim()) params.append('q', userSearch.trim());
      if (userRoleFilter) params.append('role', userRoleFilter);
      if (userTierFilter) params.append('tier', userTierFilter);
      if (userSuspendedFilter !== '') params.append('suspended', userSuspendedFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load users`);
      const data = await res.json();
      setUsers(data.users || []);
      setUsersTotal(data.total || 0);
      setUsersPage(data.page || 1);
      setUsersTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userSearch, userRoleFilter, userTierFilter, userSuspendedFilter]);

  const inspectUser = async (userId) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to retrieve user profile');
      const data = await res.json();
      setSelectedUserDetail(data);
      setInspectModalOpen(true);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleToggleSuspend = async () => {
    if (!suspensionModalUser) return;
    try {
      const willSuspend = !suspensionModalUser.isSuspended;
      const res = await fetch(`/api/admin/users/${suspensionModalUser.id}/suspend`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isSuspended: willSuspend, reason: suspensionReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update suspension');
      showToast(data.message);
      setSuspensionModalUser(null);
      setSuspensionReason('');
      fetchUsers(usersPage);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change role');
      showToast(data.message);
      fetchUsers(usersPage);
    } catch (err) {
      showToast(err.message);
    }
  };

  const fetchVideos = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit: 12 });
      if (videoSearch.trim()) params.append('q', videoSearch.trim());
      if (videoStatusFilter) params.append('status', videoStatusFilter);

      const res = await fetch(`/api/admin/videos?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load videos`);
      const data = await res.json();
      setVideos(data.videos || []);
      setVideosTotal(data.total || 0);
      setVideosPage(data.page || 1);
      setVideosTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [videoSearch, videoStatusFilter]);

  const handleTogglePublish = async (videoId, currentPublished) => {
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/publish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isPublished: !currentPublished }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update publishing status');
      showToast(data.message);
      fetchVideos(videosPage);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleTakedownVideo = async () => {
    if (!takedownVideo) return;
    try {
      const res = await fetch(`/api/admin/videos/${takedownVideo.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: takedownReason || 'Content policy violation' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to take down video');
      showToast(data.message);
      setTakedownVideo(null);
      setTakedownReason('');
      fetchVideos(videosPage);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleRetryTranscode = async (videoId) => {
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/retry-transcode`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retry transcoding');
      showToast(data.message);
      fetchVideos(videosPage);
    } catch (err) {
      showToast(err.message);
    }
  };

  const fetchModeration = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit: 15, status: moderationStatusFilter });
      const res = await fetch(`/api/admin/moderation/comments?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load moderation queue`);
      const data = await res.json();
      setModerationComments(data.comments || []);
      setModerationTotal(data.total || 0);
      setModerationPage(data.page || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [moderationStatusFilter]);

  const handleResolveComment = async (commentId, action) => {
    try {
      const res = await fetch(`/api/admin/moderation/comments/${commentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, note: moderationActionNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve moderation item');
      showToast(data.message);
      setModerationActionNote('');
      fetchModeration(moderationPage);
    } catch (err) {
      showToast(err.message);
    }
  };

  const fetchPayments = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsRes, invoicesRes] = await Promise.all([
        fetch('/api/admin/payments/analytics', { credentials: 'include' }),
        fetch(`/api/admin/payments/invoices?page=${page}&limit=12&q=${encodeURIComponent(invoiceSearch)}`, { credentials: 'include' }),
      ]);
      if (!analyticsRes.ok || !invoicesRes.ok) throw new Error('Failed to load payment records');
      const analyticsData = await analyticsRes.json();
      const invoicesData = await invoicesRes.json();
      setPaymentAnalytics(analyticsData.analytics);
      setInvoices(invoicesData.invoices || []);
      setInvoicesTotal(invoicesData.total || 0);
      setInvoicesPage(invoicesData.page || 1);
      setInvoicesTotalPages(invoicesData.totalPages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [invoiceSearch]);

  const fetchPlatformAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/analytics/platform', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load platform analytics');
      const data = await res.json();
      setPlatformAnalytics(data.platform);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAuditLogs = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (auditSearch.trim()) params.append('q', auditSearch.trim());
      if (auditActionFilter) params.append('action', auditActionFilter);
      if (auditTargetFilter) params.append('targetType', auditTargetFilter);

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      setAuditLogs(data.logs || []);
      setAuditLogsTotal(data.total || 0);
      setAuditLogsPage(data.page || 1);
      setAuditLogsTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [auditSearch, auditActionFilter, auditTargetFilter]);

  // Tab switch effect
  useEffect(() => {
    if (activeTab === 'overview') fetchOverview();
    else if (activeTab === 'users') fetchUsers(1);
    else if (activeTab === 'videos') fetchVideos(1);
    else if (activeTab === 'moderation') fetchModeration(1);
    else if (activeTab === 'payments') fetchPayments(1);
    else if (activeTab === 'analytics') fetchPlatformAnalytics();
    else if (activeTab === 'audit') fetchAuditLogs(1);
  }, [
    activeTab,
    fetchOverview,
    fetchUsers,
    fetchVideos,
    fetchModeration,
    fetchPayments,
    fetchPlatformAnalytics,
    fetchAuditLogs,
  ]);

  // ── Authentication Check ───────────────────────────────────────────────────
  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="admin-page__denied animate-fade-in" role="alert">
        <ShieldAlert size={64} className="text-danger" />
        <h2>Access Denied</h2>
        <p>Administrator privileges are strictly required to access the VideoVerse Operations Dashboard.</p>
        <span className="badge badge--danger">403 FORBIDDEN</span>
      </div>
    );
  }

  return (
    <div className="admin-page animate-fade-in" id="admin-dashboard-container">
      {/* ── Top Header Bar ── */}
      <header className="admin-page__header">
        <div className="admin-page__header-title">
          <div className="admin-page__header-icon">
            <Shield size={24} />
          </div>
          <div>
            <h1>Platform Administration & Moderation</h1>
            <p>Operations center for VideoVerse users, content, streaming jobs, revenue and audit trails.</p>
          </div>
        </div>
        <div className="admin-page__header-actions">
          <span className="badge badge--success">
            <span className="admin-page__pulse-dot" /> Live Telemetry
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              if (activeTab === 'overview') fetchOverview();
              else if (activeTab === 'users') fetchUsers(usersPage);
              else if (activeTab === 'videos') fetchVideos(videosPage);
              else if (activeTab === 'moderation') fetchModeration(moderationPage);
              else if (activeTab === 'payments') fetchPayments(invoicesPage);
              else if (activeTab === 'analytics') fetchPlatformAnalytics();
              else if (activeTab === 'audit') fetchAuditLogs(auditLogsPage);
              showToast('Data refreshed');
            }}
            title="Refresh current view"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* ── Navigation Tabs ── */}
      <nav className="admin-page__tabs" aria-label="Admin Navigation Tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={`admin-page__tab ${activeTab === 'overview' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <BarChart3 size={16} />
          <span>Overview</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'users'}
          className={`admin-page__tab ${activeTab === 'users' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={16} />
          <span>Users</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'videos'}
          className={`admin-page__tab ${activeTab === 'videos' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('videos')}
        >
          <Video size={16} />
          <span>Videos</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'moderation'}
          className={`admin-page__tab ${activeTab === 'moderation' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('moderation')}
        >
          <MessageSquare size={16} />
          <span>Moderation Queue</span>
          {overviewMetrics?.moderation?.totalPending > 0 && (
            <span className="badge badge--danger" style={{ marginLeft: 6 }}>
              {overviewMetrics.moderation.totalPending}
            </span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'payments'}
          className={`admin-page__tab ${activeTab === 'payments' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          <CreditCard size={16} />
          <span>Revenue & Invoices</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'analytics'}
          className={`admin-page__tab ${activeTab === 'analytics' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <ArrowUpRight size={16} />
          <span>Platform Analytics</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'audit'}
          className={`admin-page__tab ${activeTab === 'audit' ? 'admin-page__tab--active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <FileText size={16} />
          <span>Audit Logs</span>
        </button>
      </nav>

      {/* ── Error Banner ── */}
      {error && (
        <div className="admin-page__error-banner" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: OVERVIEW METRICS */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && overviewMetrics && (
        <div className="admin-page__tab-content animate-fade-in">
          <div className="admin-metrics-grid">
            {/* Users */}
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Total Registered Users</span>
                <Users size={20} className="text-brand-primary" />
              </div>
              <div className="admin-metric-card__value">{overviewMetrics.users.total.toLocaleString()}</div>
              <div className="admin-metric-card__sub">
                <span>DAU: <strong>{overviewMetrics.users.dau}</strong></span> · 
                <span>MAU: <strong>{overviewMetrics.users.mau}</strong></span>
              </div>
            </div>

            {/* Videos */}
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Video Catalog</span>
                <Video size={20} className="text-brand-accent" />
              </div>
              <div className="admin-metric-card__value">{overviewMetrics.videos.total.toLocaleString()}</div>
              <div className="admin-metric-card__sub">
                <span>Published: <strong>{overviewMetrics.videos.published}</strong></span> · 
                <span>Processing: <strong>{overviewMetrics.videos.processing}</strong></span>
              </div>
            </div>

            {/* Total Views */}
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Total Video Views</span>
                <Eye size={20} className="text-success" />
              </div>
              <div className="admin-metric-card__value">{overviewMetrics.videos.totalViews.toLocaleString()}</div>
              <div className="admin-metric-card__sub">
                <span>Completed Downloads: <strong>{overviewMetrics.downloads.total.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* Total Revenue */}
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Total Captured Revenue</span>
                <CreditCard size={20} className="text-warning" />
              </div>
              <div className="admin-metric-card__value">₹{overviewMetrics.revenue.totalRevenue.toLocaleString()}</div>
              <div className="admin-metric-card__sub">
                <span>Last 30 Days: <strong>₹{overviewMetrics.revenue.monthlyRevenue.toLocaleString()}</strong></span> · 
                <span>Failed: <strong>{overviewMetrics.revenue.failedPayments}</strong></span>
              </div>
            </div>

            {/* Subscriptions */}
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Active Subscriptions</span>
                <Crown size={20} className="text-brand-primary" />
              </div>
              <div className="admin-metric-card__value">{overviewMetrics.subscriptions.activeTotal.toLocaleString()}</div>
              <div className="admin-metric-card__sub">
                <span>Gold: <strong>{overviewMetrics.subscriptions.breakdown.gold}</strong></span> · 
                <span>Silver: <strong>{overviewMetrics.subscriptions.breakdown.silver}</strong></span> · 
                <span>Bronze: <strong>{overviewMetrics.subscriptions.breakdown.bronze}</strong></span>
              </div>
            </div>

            {/* Moderation Pending */}
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Pending Moderation</span>
                <ShieldAlert size={20} className="text-danger" />
              </div>
              <div className="admin-metric-card__value">{overviewMetrics.moderation.totalPending}</div>
              <div className="admin-metric-card__sub">
                <span>Reports: <strong>{overviewMetrics.moderation.pendingReports}</strong></span> · 
                <span>Flagged: <strong>{overviewMetrics.moderation.flaggedComments}</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: USERS MANAGEMENT */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="admin-page__tab-content animate-fade-in">
          {/* Controls Bar */}
          <div className="admin-controls-bar">
            <div className="admin-search-wrapper">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search user by name, email, or ID…"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') fetchUsers(1); }}
              />
            </div>
            <select value={userRoleFilter} onChange={e => { setUserRoleFilter(e.target.value); }}>
              <option value="">All Roles</option>
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </select>
            <select value={userTierFilter} onChange={e => { setUserTierFilter(e.target.value); }}>
              <option value="">All Tiers</option>
              <option value="free">Free</option>
              <option value="bronze">Bronze</option>
              <option value="silver">Silver</option>
              <option value="gold">Gold</option>
            </select>
            <select value={userSuspendedFilter} onChange={e => { setUserSuspendedFilter(e.target.value); }}>
              <option value="">All Account Statuses</option>
              <option value="false">Active Only</option>
              <option value="true">Suspended Only</option>
            </select>
            <button className="btn btn--primary btn--sm" onClick={() => fetchUsers(1)}>
              Apply Filters
            </button>
          </div>

          {/* Users Table */}
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Plan Tier</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-6 text-muted">No users found matching query.</td>
                  </tr>
                ) : (
                  users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div className="admin-user-cell">
                          <div className="admin-user-avatar" style={{ background: u.avatarColor || '#6c63ff' }}>
                            {u.initials || 'U'}
                          </div>
                          <div>
                            <strong className="admin-user-name">{u.name}</strong>
                            <div className="admin-user-email">{u.email}</div>
                            <span className="admin-user-id">ID: {u.id}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge--vip' : 'badge--secondary'}`}>
                          {u.role.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span className={`tier-badge-pill tier-badge-pill--${u.normalizedSubscriptionTier || 'free'}`}>
                          {(u.normalizedSubscriptionTier || 'free').toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {u.isSuspended ? (
                          <span className="badge badge--danger"><Ban size={12} /> Suspended</span>
                        ) : (
                          <span className="badge badge--success"><CheckCircle2 size={12} /> Active</span>
                        )}
                      </td>
                      <td className="text-muted text-sm">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="admin-action-btn-group">
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary"
                            onClick={() => inspectUser(u.id)}
                            title="Inspect full account profile & telemetry"
                          >
                            Inspect
                          </button>
                          <button
                            type="button"
                            className={`btn btn--sm ${u.isSuspended ? 'btn--primary' : 'btn--danger'}`}
                            onClick={() => setSuspensionModalUser(u)}
                            disabled={u.id === currentUser.id}
                            title={u.id === currentUser.id ? 'Cannot suspend own account' : u.isSuspended ? 'Reactivate account' : 'Suspend account'}
                          >
                            {u.isSuspended ? 'Reactivate' : 'Suspend'}
                          </button>
                          <select
                            className="admin-role-select"
                            value={u.role}
                            disabled={u.id === currentUser.id}
                            onChange={e => handleRoleChange(u.id, e.target.value)}
                            title="Update role"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="admin-pagination">
            <span className="text-muted text-sm">Showing page {usersPage} of {usersTotalPages} ({usersTotal} total users)</span>
            <div className="admin-pagination__buttons">
              <button
                className="btn btn--sm btn--secondary"
                disabled={usersPage <= 1}
                onClick={() => fetchUsers(usersPage - 1)}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <button
                className="btn btn--sm btn--secondary"
                disabled={usersPage >= usersTotalPages}
                onClick={() => fetchUsers(usersPage + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: VIDEO MANAGEMENT */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'videos' && (
        <div className="admin-page__tab-content animate-fade-in">
          {/* Controls Bar */}
          <div className="admin-controls-bar">
            <div className="admin-search-wrapper">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search video by title, ID, channel or category…"
                value={videoSearch}
                onChange={e => setVideoSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') fetchVideos(1); }}
              />
            </div>
            <select value={videoStatusFilter} onChange={e => { setVideoStatusFilter(e.target.value); }}>
              <option value="">All Processing Statuses</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
            </select>
            <button className="btn btn--primary btn--sm" onClick={() => fetchVideos(1)}>
              Apply Filters
            </button>
          </div>

          {/* Videos Table */}
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Category</th>
                  <th>Views</th>
                  <th>Processing</th>
                  <th>Visibility</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {videos.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-6 text-muted">No videos found.</td>
                  </tr>
                ) : (
                  videos.map(v => (
                    <tr key={v.id}>
                      <td>
                        <div className="admin-video-cell">
                          {v.thumbnailUrl ? (
                            <img src={v.thumbnailUrl} alt={v.title} className="admin-video-thumb" />
                          ) : (
                            <div className="admin-video-thumb admin-video-thumb--fallback">
                              <Video size={20} />
                            </div>
                          )}
                          <div className="admin-video-meta">
                            <strong className="admin-video-title">{v.title}</strong>
                            <div className="admin-video-channel">{v.channel?.name || 'Unknown Channel'} · ID: {v.id}</div>
                            {v.uploaderId && (
                              <div className="admin-video-uploader text-xs text-muted">
                                Uploader: {v.uploaderId.name} ({v.uploaderId.email})
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge--secondary">{v.category}</span>
                      </td>
                      <td>{v.views || '0'}</td>
                      <td>
                        <span className={`badge ${
                          v.processingStatus === 'ready' ? 'badge--success' :
                          v.processingStatus === 'failed' ? 'badge--danger' : 'badge--warning'
                        }`}>
                          {v.processingStatus || 'ready'}
                        </span>
                        {v.processingError && (
                          <div className="text-danger text-xs mt-1" title={v.processingError}>
                            {v.processingError.slice(0, 40)}…
                          </div>
                        )}
                      </td>
                      <td>
                        {v.isRemovedByAdmin ? (
                          <span className="badge badge--danger" title={v.adminRemovalReason || 'Removed by admin'}>
                            Takedown
                          </span>
                        ) : v.isPublished !== false ? (
                          <span className="badge badge--success">Published</span>
                        ) : (
                          <span className="badge badge--warning">Unpublished</span>
                        )}
                      </td>
                      <td>
                        <div className="admin-action-btn-group">
                          {/* Publish/Unpublish */}
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary"
                            onClick={() => handleTogglePublish(v.id, v.isPublished !== false)}
                            title={v.isPublished !== false ? 'Unpublish video' : 'Publish video'}
                          >
                            {v.isPublished !== false ? <EyeOff size={13} /> : <Eye size={13} />}
                            <span>{v.isPublished !== false ? 'Unpublish' : 'Publish'}</span>
                          </button>

                          {/* Content Takedown */}
                          {!v.isRemovedByAdmin && (
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => setTakedownVideo(v)}
                              title="Administrative takedown for inappropriate content"
                            >
                              <ShieldAlert size={13} />
                              <span>Takedown</span>
                            </button>
                          )}

                          {/* Retry Transcode */}
                          {v.processingStatus === 'failed' && (
                            <button
                              type="button"
                              className="btn btn--sm btn--primary"
                              onClick={() => handleRetryTranscode(v.id)}
                              title="Re-enqueue video transcoding pipeline"
                            >
                              <RefreshCw size={13} />
                              <span>Retry Transcode</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="admin-pagination">
            <span className="text-muted text-sm">Showing page {videosPage} of {videosTotalPages} ({videosTotal} total videos)</span>
            <div className="admin-pagination__buttons">
              <button
                className="btn btn--sm btn--secondary"
                disabled={videosPage <= 1}
                onClick={() => fetchVideos(videosPage - 1)}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <button
                className="btn btn--sm btn--secondary"
                disabled={videosPage >= videosTotalPages}
                onClick={() => fetchVideos(videosPage + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: MODERATION QUEUE */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'moderation' && (
        <div className="admin-page__tab-content animate-fade-in">
          <div className="admin-controls-bar">
            <select
              value={moderationStatusFilter}
              onChange={e => setModerationStatusFilter(e.target.value)}
            >
              <option value="flagged">Flagged Comments (Pending Review)</option>
              <option value="approved">Approved Comments</option>
              <option value="rejected">Rejected Comments</option>
              <option value="all">All Comments</option>
            </select>
            <input
              type="text"
              placeholder="Admin Resolution Note (optional)…"
              value={moderationActionNote}
              onChange={e => setModerationActionNote(e.target.value)}
              className="admin-note-input"
            />
          </div>

          <div className="admin-moderation-list">
            <div className="admin-pagination" style={{ marginBottom: 12 }}>
              <span className="text-muted text-sm">Showing {moderationComments.length} of {moderationTotal} comments</span>
            </div>
            {moderationComments.length === 0 ? (
              <div className="admin-empty-state">
                <CheckCircle2 size={48} className="text-success" />
                <h3>Moderation Queue is Clean</h3>
                <p>No comments are currently waiting for administrative review.</p>
              </div>
            ) : (
              moderationComments.map(c => (
                <div key={c.id} className="admin-moderation-card">
                  <div className="admin-moderation-card__header">
                    <div className="admin-moderation-author">
                      <div className="admin-user-avatar" style={{ background: c.authorColor || '#ff0000', width: 28, height: 28, fontSize: 11 }}>
                        {c.authorInitials || 'A'}
                      </div>
                      <strong>{c.author}</strong>
                      <span className="text-muted text-xs">· Video ID: {c.videoId}</span>
                      <span className="text-muted text-xs">· {new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <span className={`badge ${
                      c.moderationStatus === 'flagged' ? 'badge--warning' :
                      c.moderationStatus === 'approved' ? 'badge--success' : 'badge--danger'
                    }`}>
                      {c.moderationStatus.toUpperCase()}
                    </span>
                  </div>

                  <div className="admin-moderation-card__body">
                    <p className="admin-moderation-text">"{c.text}"</p>
                    {c.moderationReason && (
                      <div className="admin-moderation-flag-reason">
                        <AlertTriangle size={14} className="text-warning" />
                        <span>Filter Reason: <strong>{c.moderationReason}</strong></span>
                      </div>
                    )}
                    {c.reports && c.reports.length > 0 && (
                      <div className="admin-reports-summary">
                        <strong>User Reports ({c.reports.length}):</strong>
                        {c.reports.map((r, rIdx) => (
                          <div key={rIdx} className="admin-report-item">
                            <span>Reason: <em>{r.reason}</em></span>
                            {r.reportedBy && <span> · Reported by: {r.reportedBy.name} ({r.reportedBy.email})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="admin-moderation-card__actions">
                    <button
                      type="button"
                      className="btn btn--sm btn--success"
                      onClick={() => handleResolveComment(c.id, 'approve')}
                      title="Approve comment and show in public feed"
                    >
                      <CheckCircle2 size={13} />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--warning"
                      onClick={() => handleResolveComment(c.id, 'reject')}
                      title="Reject comment and keep hidden"
                    >
                      <XCircle size={13} />
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => handleResolveComment(c.id, 'delete')}
                      title="Permanently delete comment and all replies"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: PAYMENTS & REVENUE */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'payments' && paymentAnalytics && (
        <div className="admin-page__tab-content animate-fade-in">
          {/* Revenue Summaries */}
          <div className="admin-metrics-grid">
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">Total Captured Revenue</span>
              <div className="admin-metric-card__value">₹{paymentAnalytics.revenue.total.toLocaleString()}</div>
            </div>
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">30-Day Revenue</span>
              <div className="admin-metric-card__value">₹{paymentAnalytics.revenue.monthly.toLocaleString()}</div>
            </div>
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">1-Year Revenue</span>
              <div className="admin-metric-card__value">₹{paymentAnalytics.revenue.yearly.toLocaleString()}</div>
            </div>
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">Expiring Subscriptions (Next 7d)</span>
              <div className="admin-metric-card__value">{paymentAnalytics.expiringSubscriptionsNext7Days}</div>
            </div>
          </div>

          {/* Tier Breakdown */}
          <div className="admin-section-box">
            <h3>Revenue by Subscription Tier</h3>
            <div className="admin-tier-breakdown-grid">
              {Object.entries(paymentAnalytics.tierBreakdown).map(([tier, data]) => (
                <div key={tier} className="admin-tier-card">
                  <div className="admin-tier-card__header">
                    <span className={`tier-badge-pill tier-badge-pill--${tier}`}>{tier.toUpperCase()}</span>
                    <strong>₹{data.revenue.toLocaleString()}</strong>
                  </div>
                  <span className="text-muted text-sm">{data.count} successful transactions</span>
                </div>
              ))}
            </div>
          </div>

          {/* Invoices Search & Table */}
          <div className="admin-section-box">
            <div className="admin-section-box__header">
              <h3>Invoices & Transactions</h3>
              <div className="admin-search-wrapper" style={{ maxWidth: 300 }}>
                <Search size={14} />
                <input
                  type="search"
                  placeholder="Search invoice number or order ID…"
                  value={invoiceSearch}
                  onChange={e => setInvoiceSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') fetchPayments(1); }}
                />
              </div>
            </div>

            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Tier / Cycle</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="text-center py-6 text-muted">No invoices found.</td>
                    </tr>
                  ) : (
                    invoices.map(inv => (
                      <tr key={inv.id}>
                        <td>
                          <strong>{inv.invoiceNumber}</strong>
                          <div className="text-xs text-muted">Order: {inv.orderId}</div>
                        </td>
                        <td>
                          {inv.user ? (
                            <div>
                              <div>{inv.user.name}</div>
                              <span className="text-xs text-muted">{inv.user.email}</span>
                            </div>
                          ) : (
                            <span className="text-muted">N/A</span>
                          )}
                        </td>
                        <td>
                          <span className={`tier-badge-pill tier-badge-pill--${inv.tier}`}>{inv.tier.toUpperCase()}</span>
                          <span className="text-xs text-muted" style={{ marginLeft: 6 }}>({inv.billingCycle})</span>
                        </td>
                        <td><strong>₹{inv.amount}</strong></td>
                        <td className="text-muted text-sm">{new Date(inv.createdAt).toLocaleDateString()}</td>
                        <td>
                          <a
                            href={inv.invoicePdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn--sm btn--secondary"
                            title="Download PDF Tax Invoice"
                          >
                            <Download size={13} />
                            <span>PDF Invoice</span>
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Invoices Pagination */}
            <div className="admin-pagination">
              <span className="text-muted text-sm">Showing page {invoicesPage} of {invoicesTotalPages} ({invoicesTotal} total)</span>
              <div className="admin-pagination__buttons">
                <button
                  className="btn btn--sm btn--secondary"
                  disabled={invoicesPage <= 1}
                  onClick={() => fetchPayments(invoicesPage - 1)}
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <button
                  className="btn btn--sm btn--secondary"
                  disabled={invoicesPage >= invoicesTotalPages}
                  onClick={() => fetchPayments(invoicesPage + 1)}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 6: PLATFORM ANALYTICS */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && platformAnalytics && (
        <div className="admin-page__tab-content animate-fade-in">
          {/* Active Users Summary */}
          <div className="admin-metrics-grid">
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">Daily Active Users (DAU)</span>
              <div className="admin-metric-card__value">{platformAnalytics.activity.dau}</div>
            </div>
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">Weekly Active Users (WAU)</span>
              <div className="admin-metric-card__value">{platformAnalytics.activity.wau}</div>
            </div>
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">Monthly Active Users (MAU)</span>
              <div className="admin-metric-card__value">{platformAnalytics.activity.mau}</div>
            </div>
            <div className="admin-metric-card">
              <span className="admin-metric-card__title">Total Registered Accounts</span>
              <div className="admin-metric-card__value">{platformAnalytics.activity.totalUsers}</div>
            </div>
          </div>

          {/* Grid of Leaderboards */}
          <div className="admin-analytics-grid">
            {/* Top 10 Viewed Videos */}
            <div className="admin-section-box">
              <h3>Top 10 Most Viewed Videos</h3>
              <div className="admin-rank-list">
                {platformAnalytics.topViewedVideos.map((v, idx) => (
                  <div key={v.id} className="admin-rank-item">
                    <span className="admin-rank-num">#{idx + 1}</span>
                    <div className="admin-rank-info">
                      <strong>{v.title}</strong>
                      <span className="text-muted text-xs">{v.channel} · {v.category}</span>
                    </div>
                    <span className="badge badge--success">{v.views} views</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top 10 Downloaded Videos */}
            <div className="admin-section-box">
              <h3>Top 10 Downloaded Videos</h3>
              <div className="admin-rank-list">
                {platformAnalytics.topDownloadedVideos.map((d, idx) => (
                  <div key={d.videoId} className="admin-rank-item">
                    <span className="admin-rank-num">#{idx + 1}</span>
                    <div className="admin-rank-info">
                      <strong>{d.videoTitle}</strong>
                      <span className="text-muted text-xs">{d.channelName}</span>
                    </div>
                    <span className="badge badge--vip">{d.downloads} downloads</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Storage & Bandwidth Stats */}
          <div className="admin-metrics-grid" style={{ marginTop: 'var(--space-4)' }}>
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Download Egress Bandwidth</span>
                <HardDrive size={18} className="text-brand-primary" />
              </div>
              <div className="admin-metric-card__value">{platformAnalytics.bandwidth.totalDownloadMB} MB</div>
              <span className="text-muted text-xs">Total volume delivered to clients via controlled downloads</span>
            </div>
            <div className="admin-metric-card">
              <div className="admin-metric-card__header">
                <span className="admin-metric-card__title">Video Library Storage</span>
                <HardDrive size={18} className="text-brand-accent" />
              </div>
              <div className="admin-metric-card__value">{platformAnalytics.bandwidth.totalStorageMB} MB</div>
              <span className="text-muted text-xs">Total transcoded video assets & HLS streams on storage</span>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 7: AUDIT LOGS */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="admin-page__tab-content animate-fade-in">
          {/* Controls Bar */}
          <div className="admin-controls-bar">
            <div className="admin-search-wrapper">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search audit trail by admin email or target ID…"
                value={auditSearch}
                onChange={e => setAuditSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') fetchAuditLogs(1); }}
              />
            </div>
            <select value={auditActionFilter} onChange={e => { setAuditActionFilter(e.target.value); }}>
              <option value="">All Action Types</option>
              <option value="USER_SUSPEND">USER_SUSPEND</option>
              <option value="USER_REACTIVATE">USER_REACTIVATE</option>
              <option value="USER_ROLE_CHANGE">USER_ROLE_CHANGE</option>
              <option value="VIDEO_PUBLISH">VIDEO_PUBLISH</option>
              <option value="VIDEO_UNPUBLISH">VIDEO_UNPUBLISH</option>
              <option value="VIDEO_REMOVE">VIDEO_REMOVE</option>
              <option value="VIDEO_RETRY_TRANSCODE">VIDEO_RETRY_TRANSCODE</option>
              <option value="COMMENT_APPROVE">COMMENT_APPROVE</option>
              <option value="COMMENT_REJECT">COMMENT_REJECT</option>
              <option value="COMMENT_DELETE">COMMENT_DELETE</option>
            </select>
            <select value={auditTargetFilter} onChange={e => { setAuditTargetFilter(e.target.value); }}>
              <option value="">All Target Types</option>
              <option value="user">User</option>
              <option value="video">Video</option>
              <option value="comment">Comment</option>
              <option value="payment">Payment</option>
              <option value="system">System</option>
            </select>
            <button className="btn btn--primary btn--sm" onClick={() => fetchAuditLogs(1)}>
              Apply Filters
            </button>
          </div>

          {/* Audit Logs Table */}
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-6 text-muted">No audit logs found.</td>
                  </tr>
                ) : (
                  auditLogs.map(log => (
                    <tr key={log.id}>
                      <td className="text-muted text-sm whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <strong>{log.adminEmail}</strong>
                      </td>
                      <td>
                        <span className="badge badge--vip">{log.action}</span>
                      </td>
                      <td>
                        <span className="text-xs text-muted">{log.targetType.toUpperCase()}:</span> {log.targetId}
                      </td>
                      <td className="text-muted text-xs">{log.ipAddress || 'Internal'}</td>
                      <td>
                        <span className={`badge ${log.status === 'success' ? 'badge--success' : 'badge--danger'}`}>
                          {log.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => setSelectedAuditLog(log)}
                        >
                          View Diff
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="admin-pagination">
            <span className="text-muted text-sm">Showing page {auditLogsPage} of {auditLogsTotalPages} ({auditLogsTotal} total records)</span>
            <div className="admin-pagination__buttons">
              <button
                className="btn btn--sm btn--secondary"
                disabled={auditLogsPage <= 1}
                onClick={() => fetchAuditLogs(auditLogsPage - 1)}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <button
                className="btn btn--sm btn--secondary"
                disabled={auditLogsPage >= auditLogsTotalPages}
                onClick={() => fetchAuditLogs(auditLogsPage + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: INSPECT USER PROFILE & TELEMETRY */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {inspectModalOpen && selectedUserDetail && (
        <div className="admin-modal-backdrop" onClick={() => setInspectModalOpen(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header">
              <h3>User Profile & Telemetry</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setInspectModalOpen(false)}>✕</button>
            </div>

            <div className="admin-modal__body">
              {/* Profile Details */}
              <div className="admin-profile-overview">
                <div className="admin-user-avatar" style={{ background: selectedUserDetail.user.avatarColor, width: 48, height: 48, fontSize: 18 }}>
                  {selectedUserDetail.user.initials}
                </div>
                <div>
                  <h4>{selectedUserDetail.user.name}</h4>
                  <p className="text-muted text-sm">{selectedUserDetail.user.email} · ID: {selectedUserDetail.user.id}</p>
                  <div className="admin-tag-row">
                    <span className={`badge ${selectedUserDetail.user.role === 'admin' ? 'badge--vip' : 'badge--secondary'}`}>
                      {selectedUserDetail.user.role.toUpperCase()}
                    </span>
                    <span className={`tier-badge-pill tier-badge-pill--${selectedUserDetail.user.normalizedSubscriptionTier}`}>
                      {selectedUserDetail.user.normalizedSubscriptionTier.toUpperCase()} PLAN
                    </span>
                    {selectedUserDetail.user.isSuspended && (
                      <span className="badge badge--danger">SUSPENDED</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Login History */}
              <div className="admin-telemetry-section">
                <h5>Recent Login History ({selectedUserDetail.telemetry.loginHistory.length})</h5>
                <div className="admin-telemetry-list">
                  {selectedUserDetail.telemetry.loginHistory.length === 0 ? (
                    <span className="text-muted text-xs">No recorded logins</span>
                  ) : (
                    selectedUserDetail.telemetry.loginHistory.map((lh, idx) => (
                      <div key={idx} className="admin-telemetry-item">
                        <span>{new Date(lh.timestamp).toLocaleString()}</span>
                        <span>{lh.browser} on {lh.os}</span>
                        <span className="text-muted">{lh.ip} ({lh.location})</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Trusted Devices */}
              <div className="admin-telemetry-section">
                <h5>Trusted Devices ({selectedUserDetail.telemetry.trustedDevices.length})</h5>
                <div className="admin-telemetry-list">
                  {selectedUserDetail.telemetry.trustedDevices.length === 0 ? (
                    <span className="text-muted text-xs">No trusted devices bound</span>
                  ) : (
                    selectedUserDetail.telemetry.trustedDevices.map((td, idx) => (
                      <div key={idx} className="admin-telemetry-item">
                        <strong>{td.deviceName}</strong>
                        <span>{td.browser} / {td.os}</span>
                        <span className={`badge ${td.isRevoked ? 'badge--danger' : 'badge--success'}`}>
                          {td.isRevoked ? 'Revoked' : 'Active'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Download History */}
              <div className="admin-telemetry-section">
                <h5>Download Activity ({selectedUserDetail.telemetry.downloadHistory.length})</h5>
                <div className="admin-telemetry-list">
                  {selectedUserDetail.telemetry.downloadHistory.length === 0 ? (
                    <span className="text-muted text-xs">No downloads initiated</span>
                  ) : (
                    selectedUserDetail.telemetry.downloadHistory.map((d, idx) => (
                      <div key={idx} className="admin-telemetry-item">
                        <span>{d.videoTitle || d.videoId}</span>
                        <span className={`badge ${d.status === 'completed' ? 'badge--success' : 'badge--warning'}`}>
                          {d.status}
                        </span>
                        <span className="text-muted text-xs">{new Date(d.reservedAt).toLocaleDateString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="admin-modal__footer">
              <button className="btn btn--secondary" onClick={() => setInspectModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: SUSPEND / REACTIVATE USER */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {suspensionModalUser && (
        <div className="admin-modal-backdrop" onClick={() => setSuspensionModalUser(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header">
              <h3>{suspensionModalUser.isSuspended ? 'Reactivate Account' : 'Suspend Account'}</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setSuspensionModalUser(null)}>✕</button>
            </div>
            <div className="admin-modal__body">
              <p>
                Are you sure you want to {suspensionModalUser.isSuspended ? 'reactivate' : 'suspend'}{' '}
                <strong>{suspensionModalUser.name}</strong> ({suspensionModalUser.email})?
              </p>
              {!suspensionModalUser.isSuspended && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <label className="admin-label">Reason for Suspension (required):</label>
                  <input
                    type="text"
                    className="admin-input"
                    placeholder="e.g. Terms of Service violation, suspicious activity…"
                    value={suspensionReason}
                    onChange={e => setSuspensionReason(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="admin-modal__footer">
              <button className="btn btn--secondary" onClick={() => setSuspensionModalUser(null)}>Cancel</button>
              <button
                className={`btn ${suspensionModalUser.isSuspended ? 'btn--primary' : 'btn--danger'}`}
                onClick={handleToggleSuspend}
              >
                Confirm {suspensionModalUser.isSuspended ? 'Reactivation' : 'Suspension'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: VIDEO TAKEDOWN */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {takedownVideo && (
        <div className="admin-modal-backdrop" onClick={() => setTakedownVideo(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header">
              <h3>Administrative Video Takedown</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setTakedownVideo(null)}>✕</button>
            </div>
            <div className="admin-modal__body">
              <p>
                Take down <strong>"{takedownVideo.title}"</strong> ({takedownVideo.id})?
              </p>
              <p className="text-muted text-sm">
                Note: In accordance with platform policy, original video media files on disk will NOT be destroyed,
                allowing administrative review and legal compliance hold. The video will be hidden from all public feeds.
              </p>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <label className="admin-label">Takedown Reason:</label>
                <input
                  type="text"
                  className="admin-input"
                  placeholder="e.g. Inappropriate content, copyright infringement…"
                  value={takedownReason}
                  onChange={e => setTakedownReason(e.target.value)}
                />
              </div>
            </div>
            <div className="admin-modal__footer">
              <button className="btn btn--secondary" onClick={() => setTakedownVideo(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleTakedownVideo}>Confirm Takedown</button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 4: AUDIT LOG DIFF */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {selectedAuditLog && (
        <div className="admin-modal-backdrop" onClick={() => setSelectedAuditLog(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header">
              <h3>Audit Log Diff — {selectedAuditLog.action}</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedAuditLog(null)}>✕</button>
            </div>
            <div className="admin-modal__body">
              <div className="admin-audit-diff-meta">
                <div><strong>Admin:</strong> {selectedAuditLog.adminEmail}</div>
                <div><strong>Target:</strong> {selectedAuditLog.targetType} ({selectedAuditLog.targetId})</div>
                <div><strong>Timestamp:</strong> {new Date(selectedAuditLog.createdAt).toISOString()}</div>
                <div><strong>IP Address:</strong> {selectedAuditLog.ipAddress || 'Internal'}</div>
              </div>

              <div className="admin-audit-diff-columns">
                <div className="admin-audit-diff-col">
                  <h6>Previous Values</h6>
                  <pre className="admin-json-box">
                    {JSON.stringify(selectedAuditLog.previousValues, null, 2) || '(None)'}
                  </pre>
                </div>
                <div className="admin-audit-diff-col">
                  <h6>New Values</h6>
                  <pre className="admin-json-box">
                    {JSON.stringify(selectedAuditLog.newValues, null, 2) || '(None)'}
                  </pre>
                </div>
              </div>
            </div>
            <div className="admin-modal__footer">
              <button className="btn btn--secondary" onClick={() => setSelectedAuditLog(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

