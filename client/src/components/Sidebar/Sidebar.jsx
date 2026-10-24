import {
  Home, TrendingUp, PlaySquare, History, Clock, ThumbsUp,
  Download, Music, Gamepad2, Atom, BookOpen, ChevronRight,
  ChevronLeft, Laptop, Compass, Utensils, Trophy, Film,
  Globe, Smile, Newspaper, Dumbbell, User, Sparkles, Shield
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SIDEBAR_SECTIONS, MOCK_CHANNELS } from '../../data/mockData';
import './Sidebar.css';

// Icon map (string → Lucide component)
const ICON_MAP = {
  Home,
  TrendingUp,
  PlaySquare,
  History,
  Clock,
  ThumbsUp,
  Download,
  Shield,
  Laptop,
  Gamepad2,
  Music,
  BookOpen,
  Compass,
  Atom,
  Utensils,
  Trophy,
  Film,
  Globe,
  Smile,
  Newspaper,
  Dumbbell,
  User,
  Sparkles,
};

// YouTube-style mini sidebar items for collapsed mode
const MINI_NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'trending', label: 'Trending', icon: TrendingUp },
  { id: 'subscriptions', label: 'Subscriptions', icon: PlaySquare },
  { id: 'history', label: 'You', icon: History },
  { id: 'upgrade', label: 'Upgrade', icon: Sparkles },
];

export default function Sidebar() {
  const {
    sidebarOpen,
    sidebarCollapsed,
    toggleSidebarCollapse,
    toggleSidebar,
    currentView,
    activeCategory,
    activeChannelFilter,
    selectSidebarItem,
    filterByChannel,
    subscribedChannels,
    toggleSubscribe,
    currentUser,
  } = useApp();

  const collapsed = sidebarCollapsed;

  if (!sidebarOpen) return null;

  function isItemActive(itemId) {
    if (activeChannelFilter) return false;
    if (itemId === 'home') return currentView === 'all' && activeCategory === 'All';
    if (itemId === 'trending') return currentView === 'trending';
    if (itemId === 'subscriptions') return currentView === 'subscriptions';
    if (itemId === 'history') return currentView === 'history';
    if (itemId === 'watch-later') return currentView === 'watch-later';
    if (itemId === 'liked') return currentView === 'liked';
    if (itemId === 'downloads') return currentView === 'downloads';
    if (itemId === 'security') return currentView === 'security';
    if (itemId === 'upgrade') return currentView === 'upgrade';
    return activeCategory.toLowerCase() === itemId.toLowerCase();
  }

  return (
    <>
      {/* Mobile backdrop overlay */}
      <div
        className="sidebar__backdrop"
        onClick={toggleSidebar}
        aria-hidden="true"
      />

      <aside
        className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}
        aria-label="Main navigation"
      >
        {/* Collapse toggle button */}
        <button
          className="sidebar__collapse-btn"
          onClick={toggleSidebarCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {collapsed ? (
          /* ── YouTube Mini Sidebar (Collapsed Mode) ── */
          <nav className="sidebar__mini-nav" aria-label="Quick navigation">
            <ul className="sidebar__mini-list" role="list">
              {MINI_NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const active = isItemActive(item.id);
                return (
                  <li key={item.id}>
                    <button
                      className={`sidebar__mini-item ${active ? 'sidebar__mini-item--active' : ''}`}
                      onClick={() => selectSidebarItem(item.id)}
                      id={`sidebar-mini-${item.id}`}
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon size={22} className="sidebar__mini-icon" aria-hidden="true" />
                      <span className="sidebar__mini-label">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : (
          /* ── YouTube Full Expanded Sidebar ── */
          <nav className="sidebar__nav">
            {SIDEBAR_SECTIONS.map((section, sIdx) => (
              <div key={sIdx} className="sidebar__section">
                {section.title && (
                  <p className="sidebar__section-title">{section.title}</p>
                )}
                <ul className="sidebar__list" role="list">
                  {section.items.map(item => {
                    const Icon = ICON_MAP[item.icon];
                    const active = isItemActive(item.id);
                    return (
                      <li key={item.id}>
                        <button
                          className={`sidebar__item ${active ? 'sidebar__item--active' : ''}`}
                          onClick={() => selectSidebarItem(item.id)}
                          id={`sidebar-nav-${item.id}`}
                          aria-label={item.label}
                          aria-current={active ? 'page' : undefined}
                        >
                          {Icon && <Icon size={20} className="sidebar__item-icon" aria-hidden="true" />}
                          <span className="sidebar__item-label">{item.label}</span>
                          {item.badge && (
                            <span className="sidebar__item-badge badge badge--mock">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {/* Premium Upgrade Banner for free / non-VIP users */}
            {(!currentUser || currentUser.subscriptionTier !== 'vip') && (
              <div className="sidebar__upgrade-banner">
                <div className="sidebar__upgrade-banner-header">
                  <Sparkles size={16} className="sidebar__upgrade-sparkle" />
                  <span>Go Premium</span>
                </div>
                <p className="sidebar__upgrade-banner-text">
                  Unlock 25/day or unlimited downloads & exclusive badges.
                </p>
                <button
                  type="button"
                  className="sidebar__upgrade-banner-btn"
                  onClick={() => selectSidebarItem('upgrade')}
                  id="sidebar-upgrade-btn"
                >
                  Explore Plans
                </button>
              </div>
            )}

            {/* Subscriptions section */}
            <div className="sidebar__section">
              <p className="sidebar__section-title">
                Subscriptions
                <span className="badge badge--mock" style={{ marginLeft: 8, fontSize: 10 }}>Local</span>
              </p>
              <ul className="sidebar__list" role="list">
                {MOCK_CHANNELS.map(channel => {
                  const isSub = subscribedChannels.has(channel.id);
                  const isFiltered = activeChannelFilter === channel.id;
                  return (
                    <li key={channel.id}>
                      <div className={`sidebar__channel-row ${isFiltered ? 'sidebar__channel-row--active' : ''}`}>
                        <button
                          className="sidebar__channel-item"
                          onClick={() => filterByChannel(channel.id)}
                          aria-label={`View ${channel.name} channel videos`}
                          id={`sidebar-channel-${channel.id}`}
                          title={`Click to view ${channel.name}'s videos`}
                        >
                          <div
                            className="sidebar__channel-avatar"
                            style={{ background: channel.avatarColor }}
                            aria-hidden="true"
                          >
                            {channel.initials}
                            {isSub && (
                              <div className="sidebar__channel-active-dot" aria-hidden="true" />
                            )}
                          </div>
                          <div className="sidebar__channel-info">
                            <span className="sidebar__channel-name truncate">{channel.name}</span>
                            <span className="sidebar__channel-subs">{channel.subscribers}</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          className={`sidebar__sub-toggle-btn ${isSub ? 'sidebar__sub-toggle-btn--subbed' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSubscribe(channel.id);
                          }}
                          aria-label={isSub ? `Unsubscribe from ${channel.name}` : `Subscribe to ${channel.name}`}
                          title={isSub ? 'Subscribed (click to unsubscribe)' : 'Subscribe'}
                        >
                          {isSub ? '✓' : '+'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Footer */}
            <div className="sidebar__footer">
              <p>© 2026 VideoVerse</p>
              <p>Stream · Share · Connect</p>
            </div>
          </nav>
        )}
      </aside>
    </>
  );
}
