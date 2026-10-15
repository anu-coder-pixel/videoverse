import {
  Home, TrendingUp, PlaySquare, History, Clock, ThumbsUp,
  Download, Music, Gamepad2, Atom, BookOpen, ChevronRight,
  ChevronLeft, Laptop, Compass, Utensils, Trophy, Film,
  Globe, Smile, Newspaper, Dumbbell, X
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
};

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
    return activeCategory.toLowerCase() === itemId.toLowerCase();
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="sidebar__backdrop"
        onClick={toggleSidebar}
        aria-hidden="true"
      />

      <aside
        className={`sidebar glass ${collapsed ? 'sidebar--collapsed' : ''}`}
        aria-label="Main navigation"
      >
        {/* Collapse toggle */}
        <button
          className="sidebar__collapse-btn"
          onClick={toggleSidebarCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <nav className="sidebar__nav">
          {SIDEBAR_SECTIONS.map((section, sIdx) => (
            <div key={sIdx} className="sidebar__section">
              {section.title && !collapsed && (
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
                        title={collapsed ? item.label : undefined}
                        id={`sidebar-nav-${item.id}`}
                        aria-label={item.label}
                        aria-current={active ? 'page' : undefined}
                      >
                        {Icon && <Icon size={18} className="sidebar__item-icon" aria-hidden="true" />}
                        {!collapsed && (
                          <span className="sidebar__item-label">{item.label}</span>
                        )}
                        {!collapsed && item.badge && (
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

          {/* Subscriptions section */}
          {!collapsed && (
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
          )}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="sidebar__footer">
            <p>© 2026 VideoVerse</p>
            <p>Core Browsing & Playback Engine</p>
          </div>
        )}
      </aside>
    </>
  );
}
