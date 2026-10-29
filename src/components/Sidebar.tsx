import { useI18n } from '../hooks/useI18n';
import React, { memo } from 'react';

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
    id: 'Recordings',
    label: 'Recordings',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /></svg>
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
  const { t } = useI18n();
  return (
    <aside className={`glass-panel liquid-sidebar ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">
            <img src={`${import.meta.env.BASE_URL}cat_icon.png`} alt={t('Freaky Logo')} decoding="async" />
          </span>
          {!isCollapsed && <span className="sidebar-brand-name"><strong>Freaky</strong><span>IPTV</span></span>}
        </div>
        <button type="button" className="sidebar-toggle-button"
          onClick={onToggleCollapse} title={t(isCollapsed ? 'Show sidebar' : 'Hide sidebar')}
          aria-label={t(isCollapsed ? 'Show sidebar' : 'Hide sidebar')}
          aria-expanded={!isCollapsed} aria-controls="primary-navigation">
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
        </button>
      </div>
      <nav id="primary-navigation" aria-label={t('Primary navigation')}>
        {[...NAV_ITEMS, ...(showYearReview ? [YEAR_REVIEW_ITEM] : [])].map(item => (
          <button key={item.id} type="button"
            className={`sidebar-nav-item ${item.id === 'Stats' ? 'sidebar-nav-item--divider' : ''} ${item.id === 'YearReview' ? 'sidebar-year-review--highlighted' : ''}`}
            onClick={() => onNavigate(item.id)} aria-label={t(item.label)}
            aria-current={activeSection === item.id ? 'page' : undefined}
            title={isCollapsed ? t(item.label) : undefined}>
            <span aria-hidden="true">{item.icon}</span>
            {!isCollapsed && <span>{t(item.label)}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer-nav">
        <button type="button" className={`sidebar-footer-button ${activeSection === 'Settings' ? 'is-active' : ''}`}
          onClick={() => onNavigate('Settings')} aria-label={t('Settings')}
          aria-current={activeSection === 'Settings' ? 'page' : undefined} title={isCollapsed ? t('Settings') : undefined}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" /></svg>
          {!isCollapsed && <span>{t('Settings')}</span>}
        </button>
      </div>
    </aside>
  );
};

export const Sidebar = memo(SidebarComponent);
