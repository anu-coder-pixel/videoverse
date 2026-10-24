import { useState, useRef, useEffect } from 'react';
import { Search, Menu, Bell, Upload, User, X, Mic, ArrowLeft, LogOut, Settings, Zap, Crown, Star, Shield, Sun, Moon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './Navbar.css';

export default function Navbar() {
  const {
    sidebarOpen,
    toggleSidebar,
    toggleSidebarCollapse,
    searchQuery,
    setSearchQuery,
    handleSearchSubmit,
    selectSidebarItem,
    showToast,
    currentUser,
    openAuthModal,
    logout,
    theme,
    themePreference,
    updateThemePreference,
  } = useApp();
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchRef = useRef(null);

  // Close notifications and user menu on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (!e.target.closest('.navbar__notif-wrapper')) {
        setNotifOpen(false);
      }
      if (!e.target.closest('.navbar__user-menu-wrapper')) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleMenuToggle() {
    if (window.innerWidth <= 768) {
      toggleSidebar();
    } else {
      if (!sidebarOpen) {
        toggleSidebar();
      } else {
        toggleSidebarCollapse();
      }
    }
  }

  function onSearchFormSubmit(e) {
    e.preventDefault();
    handleSearchSubmit();
    if (mobileSearchOpen) {
      setMobileSearchOpen(false);
    }
  }

  function handleClearSearch() {
    setSearchQuery('');
    searchRef.current?.focus();
  }

  return (
    <header className="navbar glass" role="banner">
      {/* ── Mobile Search Overlay (when active) ── */}
      {mobileSearchOpen ? (
        <div className="navbar__mobile-search-bar animate-fade-in">
          <button
            type="button"
            className="navbar__icon-btn"
            onClick={() => setMobileSearchOpen(false)}
            aria-label="Back to main navbar"
          >
            <ArrowLeft size={20} />
          </button>
          <form className="navbar__search-form navbar__search-form--mobile" onSubmit={onSearchFormSubmit} role="search">
            <div className="navbar__search-wrapper">
              <input
                ref={searchRef}
                type="search"
                className="navbar__search-input"
                placeholder="Search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="navbar__search-clear"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="navbar__search-btn"
              aria-label="Submit search"
            >
              <Search size={18} />
            </button>
          </form>
          <button
            type="button"
            className="navbar__icon-btn navbar__mic-btn"
            aria-label="Voice search"
            onClick={() => showToast('🎙️ Voice search will be integrated with speech-to-text API.')}
          >
            <Mic size={18} />
          </button>
        </div>
      ) : (
        <>
          {/* ── Left — Menu button + YouTube-styled VideoVerse Logo ── */}
          <div className="navbar__left">
            <button
              className="navbar__icon-btn navbar__menu-btn"
              onClick={handleMenuToggle}
              aria-label="Toggle navigation menu"
              id="sidebar-toggle-btn"
            >
              <Menu size={20} />
            </button>
            <button
              className="navbar__logo"
              onClick={() => selectSidebarItem('home')}
              aria-label="Go to VideoVerse home"
              id="navbar-logo-btn"
            >
              <div className="navbar__logo-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="navbar__logo-play-icon">
                  <path d="M8 5v14l11-7z" fill="white" />
                </svg>
              </div>
              <span className="navbar__logo-text">VideoVerse</span>
            </button>
          </div>

          {/* ── Center — YouTube Search Pill + Voice Button ── */}
          <div className={`navbar__center ${searchFocused ? 'navbar__center--focused' : ''}`}>
            <form className="navbar__search-form" onSubmit={onSearchFormSubmit} role="search">
              <label htmlFor="main-search" className="sr-only">Search videos</label>
              <div className="navbar__search-wrapper">
                <input
                  id="main-search"
                  ref={searchRef}
                  type="search"
                  className="navbar__search-input"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  autoComplete="off"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="navbar__search-clear"
                    onClick={handleClearSearch}
                    aria-label="Clear search"
                    id="search-clear-btn"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="navbar__search-btn"
                aria-label="Search"
                id="search-submit-btn"
                title="Search"
              >
                <Search size={18} />
              </button>
            </form>
            <button
              className="navbar__icon-btn navbar__mic-btn"
              aria-label="Search with your voice"
              title="Search with your voice"
              onClick={() => showToast('🎙️ Voice search will be integrated with speech-to-text API.')}
              id="voice-search-btn"
            >
              <Mic size={18} />
            </button>
          </div>

          {/* ── Right — Mobile search trigger, Create, Notifications, Profile / Sign In ── */}
          <div className="navbar__right">
            {/* Mobile search trigger */}
            <button
              className="navbar__icon-btn navbar__mobile-search-trigger"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="Open search bar"
            >
              <Search size={20} />
            </button>

            {/* Create / Upload */}
            <button
              className="navbar__icon-btn navbar__create-btn"
              aria-label="Create or upload video"
              title="Create"
              onClick={() => showToast('📤 Video uploading with transcoding pipeline is planned for next stages.')}
              id="upload-btn"
            >
              <Upload size={18} />
              <span className="navbar__create-label">Create</span>
            </button>

            {/* Notifications */}
            <div className="navbar__notif-wrapper">
              <button
                className={`navbar__icon-btn ${notifOpen ? 'active' : ''}`}
                onClick={() => setNotifOpen(prev => !prev)}
                aria-label="Notifications"
                aria-expanded={notifOpen}
                id="notifications-btn"
              >
                <Bell size={18} />
                <span className="navbar__notif-dot" aria-hidden="true" />
              </button>

              {notifOpen && (
                <div className="navbar__notif-panel glass animate-fade-in" role="region" aria-label="Notifications">
                  <div className="navbar__notif-header">
                    <span>Notifications</span>
                    <span className="badge badge--mock">Mock Data</span>
                  </div>
                  {MOCK_NOTIFICATIONS.map(n => (
                    <div key={n.id} className="navbar__notif-item">
                      <div className="navbar__notif-avatar" style={{ background: n.color }}>
                        {n.initials}
                      </div>
                      <div className="navbar__notif-text">
                        <p>{n.message}</p>
                        <span>{n.time}</span>
                      </div>
                      {n.unread && <div className="navbar__notif-unread" aria-label="Unread" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── User Authentication (Sign In vs Profile Menu) ── */}
            {currentUser ? (
              <div className="navbar__user-menu-wrapper">
                <button
                  className="navbar__avatar-btn navbar__avatar-btn--logged-in"
                  onClick={() => setUserMenuOpen(prev => !prev)}
                  aria-label="User account menu"
                  aria-expanded={userMenuOpen}
                  id="user-menu-btn"
                  title={currentUser.name}
                >
                  <span className="navbar__avatar-initials">{currentUser.initials}</span>
                </button>

                {userMenuOpen && (
                  <div className="navbar__user-dropdown glass animate-fade-in" role="menu">
                    <div className="navbar__user-dropdown-header">
                      <div className="navbar__dropdown-avatar" style={{ background: currentUser.avatarColor }}>
                        {currentUser.initials}
                      </div>
                      <div className="navbar__dropdown-meta">
                        <p className="navbar__dropdown-name truncate">{currentUser.name}</p>
                        <p className="navbar__dropdown-email truncate">{currentUser.email}</p>
                        {currentUser.subscriptionTier === 'vip' ? (
                          <span className="navbar__tier-badge navbar__tier-badge--vip">
                            <Crown size={11} /> VIP
                          </span>
                        ) : currentUser.subscriptionTier === 'premium' ? (
                          <span className="navbar__tier-badge navbar__tier-badge--premium">
                            <Star size={11} /> Premium
                          </span>
                        ) : (
                          <span className="navbar__tier-badge navbar__tier-badge--free">
                            Free Member
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="navbar__dropdown-divider" />

                    <button
                      type="button"
                      className="navbar__dropdown-item"
                      onClick={() => {
                        setUserMenuOpen(false);
                        showToast(`Signed in as ${currentUser.name}`);
                      }}
                      role="menuitem"
                    >
                      <User size={16} />
                      <span>Your Profile</span>
                    </button>

                    {/* Security & Devices (Task 4) */}
                    <button
                      type="button"
                      className="navbar__dropdown-item"
                      onClick={() => {
                        setUserMenuOpen(false);
                        selectSidebarItem('security');
                      }}
                      role="menuitem"
                      id="navbar-security-btn"
                    >
                      <Shield size={16} />
                      <span>Security & Devices</span>
                    </button>

                    {/* Interactive Appearance Toggle (Task 4) */}
                    <button
                      type="button"
                      className="navbar__dropdown-item"
                      onClick={() => {
                        const nextPref = themePreference === 'auto' ? 'light' : themePreference === 'light' ? 'dark' : 'auto';
                        updateThemePreference(nextPref);
                      }}
                      role="menuitem"
                      id="navbar-appearance-btn"
                      title="Click to cycle: Auto IST -> Light -> Dark"
                    >
                      {theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
                      <span>
                        Theme: {themePreference === 'auto' ? `Auto IST (${theme.toUpperCase()})` : themePreference.toUpperCase()}
                      </span>
                    </button>

                    <div className="navbar__dropdown-divider" />

                    {/* Upgrade CTA — only shown for free-tier users */}
                    {currentUser.subscriptionTier === 'free' && (
                      <button
                        type="button"
                        className="navbar__dropdown-item navbar__dropdown-item--upgrade"
                        onClick={() => {
                          setUserMenuOpen(false);
                          selectSidebarItem('upgrade');
                        }}
                        role="menuitem"
                        id="upgrade-plan-btn"
                      >
                        <Zap size={16} />
                        <span>Upgrade to Premium</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="navbar__dropdown-item navbar__dropdown-item--danger"
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      role="menuitem"
                    >
                      <LogOut size={16} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="navbar__signin-btn"
                onClick={openAuthModal}
                aria-label="Sign in to VideoVerse"
                id="signin-btn"
              >
                <User size={18} />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </>
      )}
    </header>
  );
}

// ⚠️ MOCK notification data
const MOCK_NOTIFICATIONS = [
  { id: 'n1', initials: 'CC', color: '#ff0000', message: 'CodeCraft Studio uploaded a new video', time: '2m ago', unread: true },
  { id: 'n2', initials: 'TD', color: '#3ea6ff', message: 'Techverse Daily: "AI Breakthroughs" is trending', time: '1h ago', unread: true },
  { id: 'n3', initials: 'QQ', color: '#2ba640', message: 'QuantumQuest replied to your comment', time: '3h ago', unread: false },
];
