import React, { memo, useState } from 'react';

interface SidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  showYearReview: boolean;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'Home',
    label: 'Home',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  },
  {
    id: 'Live',
    label: 'Live TV',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
        <polyline points="17 2 12 7 7 2" />
      </svg>
    )
  },
  {
    id: 'Favorites',
    label: 'Favorites',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    )
  },
  {
    id: 'Guide',
    label: 'TV Guide',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
      </svg>
    )
  },
  {
    id: 'Stats',
    label: 'Statistics',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    )
  },
  {
    id: 'About',
    label: 'About',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    )
  }
];

const YEAR_REVIEW_ITEM: NavItem = {
  id: 'YearReview',
  label: 'Year Review',
  icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 4.2L18 8.5l-3.5 2.7.1 4.5L12 13.2l-2.6 2.5.1-4.5L6 8.5l4.5-1.3L12 3Z" />
      <path d="M5 17.5c2 2.2 4.3 3.3 7 3.3s5-1.1 7-3.3" />
    </svg>
  )
};

const SidebarComponent: React.FC<SidebarProps> = ({
  activeSection,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
  showYearReview
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <aside 
      className={`glass-panel liquid-sidebar ${isCollapsed ? 'is-collapsed' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: isCollapsed ? '72px' : '236px',
        height: '100%',
        transition: 'var(--transition-smooth)',
        overflow: 'hidden',
        zIndex: 10,
        position: 'relative'
      }}
    >
      {/* Brand Header & Toggle Button */}
      <div 
        className="sidebar-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          height: '64px',
          minHeight: '64px',
          padding: isCollapsed ? '0' : '0 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {!isCollapsed && (
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              animation: 'fadeIn 0.25s ease'
            }}
          >
            <img 
              src={`${import.meta.env.BASE_URL}cat_icon.png`}
              alt="Freaky Logo"
              decoding="async"
              style={{
                width: '28px',
                height: '28px',
                objectFit: 'contain'
              }}
            />
            <span 
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '0.3px',
                fontFamily: 'inherit'
              }}
            >
              Freaky IPTV
            </span>
          </div>
        )}

        <button
          className={`sidebar-toggle-button ${isCollapsed ? 'is-collapsed' : ''}`}
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={isCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-expanded={!isCollapsed}
          aria-controls="primary-navigation"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            color: 'var(--text-secondary)',
            background: 'rgba(255, 255, 255, 0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'var(--transition-fast)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            outline: 'none',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
          }}
        >
          <svg className="sidebar-toggle-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>

      {/* Nav List */}
      <nav
        id="primary-navigation"
        aria-label="Primary navigation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          gap: '4px',
          flex: 1
        }}
      >
        {[...NAV_ITEMS, ...(showYearReview ? [YEAR_REVIEW_ITEM] : [])].map((item) => {
          const isActive = activeSection === item.id;
          const isHovered = hoveredId === item.id;

          return (
            <div
              key={item.id}
              style={{
                position: 'relative',
                width: '100%',
                minHeight: '40px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {/* macOS Sidebar Selection Capsule */}
              {isActive && (
                <div 
                  className="sidebar-selection-capsule"
                  style={{
                    position: 'absolute',
                    top: '1px',
                    bottom: '1px',
                    left: '10px',
                    right: '10px',
                    borderRadius: '8px',
                    background: 'var(--ui-selection)',
                    border: '1px solid transparent',
                    zIndex: 1,
                    pointerEvents: 'none',
                    animation: 'fadeIn 0.15s ease'
                  }}
                />
              )}

              <button
                type="button"
                className={item.id === 'YearReview' ? 'sidebar-year-review--highlighted' : undefined}
                onClick={() => onNavigate(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                title={isCollapsed ? item.label : undefined}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: isCollapsed ? '0' : '0 12px',
                  margin: '0 10px',
                  height: '36px',
                  borderRadius: '8px',
                  background: (!isActive && isHovered) ? 'rgba(255, 255, 255, 0.055)' : 'transparent',
                  color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  gap: '12px',
                  width: 'calc(100% - 20px)',
                  textAlign: 'left',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  transition: 'var(--transition-fast)',
                  border: 'none',
                  outline: 'none',
                  cursor: 'pointer',
                  zIndex: 3
                }}
              >
                <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', minWidth: '18px', color: isActive ? '#FFFFFF' : 'currentColor' }}>
                  {item.icon}
                </span>
                {!isCollapsed && (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer-nav">
        <button
          type="button"
          className={`sidebar-footer-button ${activeSection === 'Settings' ? 'is-active' : ''}`}
          onClick={() => onNavigate('Settings')}
          aria-label="Settings"
          aria-current={activeSection === 'Settings' ? 'page' : undefined}
          title={isCollapsed ? 'Settings' : undefined}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {!isCollapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
};

export const Sidebar = memo(SidebarComponent);
