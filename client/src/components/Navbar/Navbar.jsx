import { useState, useRef, useEffect } from 'react';
import { Search, Menu, Bell, Upload, User, X, Video, Mic } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import './Navbar.css';

export default function Navbar() {
  const {
    toggleSidebar,
    searchQuery,
    setSearchQuery,
    handleSearchSubmit,
    selectSidebarItem,
    showToast,
  } = useApp();
  const [searchFocused, setSearchFocused] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef(null);

  // Close notifications on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (!e.target.closest('.navbar__notif-wrapper')) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function onSearchFormSubmit(e) {
    e.preventDefault();
    handleSearchSubmit();
  }

  function handleClearSearch() {
    setSearchQuery('');
    searchRef.current?.focus();
  }

  return (
    <header className="navbar glass" role="banner">
      {/* Left — Logo + Menu toggle */}
      <div className="navbar__left">
        <button
          className="navbar__icon-btn"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar menu"
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
          <div className="navbar__logo-icon">
            <Video size={18} strokeWidth={2.5} />
          </div>
          <span className="navbar__logo-text">
            Video<span className="text-gradient">Verse</span>
          </span>
        </button>
      </div>

      {/* Center — Search bar */}
      <div className={`navbar__center ${searchFocused ? 'navbar__center--focused' : ''}`}>
        <form className="navbar__search-form" onSubmit={onSearchFormSubmit} role="search">
          <label htmlFor="main-search" className="sr-only">Search videos</label>
          <div className="navbar__search-wrapper">
            <Search size={16} className="navbar__search-icon" aria-hidden="true" />
            <input
              id="main-search"
              ref={searchRef}
              type="search"
              className="navbar__search-input"
              placeholder="Search videos, channels, topics…"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
              }}
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
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="navbar__search-btn"
            aria-label="Submit search"
            id="search-submit-btn"
          >
            <Search size={16} />
          </button>
        </form>
        <button
          className="navbar__icon-btn navbar__mic-btn"
          aria-label="Voice search (planned feature)"
          onClick={() => showToast('🎙️ Voice search will be integrated with speech-to-text API.')}
          id="voice-search-btn"
        >
          <Mic size={16} />
        </button>
      </div>

      {/* Right — Actions */}
      <div className="navbar__right">
        {/* Upload — mock button */}
        <button
          className="navbar__icon-btn"
          aria-label="Upload video (planned feature)"
          title="Upload — coming soon"
          onClick={() => showToast('📤 Video uploading with transcoding pipeline is planned for next stages.')}
          id="upload-btn"
        >
          <Upload size={18} />
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

        {/* User avatar — mock sign-in */}
        <button
          className="navbar__avatar-btn"
          aria-label="Sign in (planned feature)"
          title="Sign in — planned for Task 4"
          onClick={() => showToast('🔐 Authentication with JWT & session cookies is planned for Task 4.')}
          id="signin-btn"
        >
          <User size={16} />
        </button>
      </div>
    </header>
  );
}

// ⚠️ MOCK notification data
const MOCK_NOTIFICATIONS = [
  { id: 'n1', initials: 'CC', color: '#6c63ff', message: 'CodeCraft Studio uploaded a new video', time: '2m ago', unread: true },
  { id: 'n2', initials: 'TD', color: '#40c4ff', message: 'Techverse Daily: "AI Breakthroughs" is trending', time: '1h ago', unread: true },
  { id: 'n3', initials: 'QQ', color: '#43e97b', message: 'QuantumQuest replied to your comment', time: '3h ago', unread: false },
];
