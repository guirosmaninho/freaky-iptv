import React, { memo, useCallback, useDeferredValue, useMemo } from 'react';
import type { Channel, EPGProgram } from '../types';
import { ChannelCard } from './ChannelCard';
import { useI18n } from '../hooks/useI18n';
import { useNavigationState } from '../hooks/useNavigationState';
import { useVirtualCollection } from '../hooks/useVirtualCollection';
import { normalizeSearchText } from '../services/searchText';
import '../navigation.css';

interface LiveGridProps {
  channels: Channel[];
  categories: string[];
  activeChannel: Channel | null;
  favoriteChannelIds: Set<string>;
  onNavigate: (section: string) => void;
  onPlayChannel: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  getChannelEpgInfo: (channel: Channel) => { program: EPGProgram | null; progress: number; upcoming?: EPGProgram[] };
  initialCategory?: string;
  showFavoritesOnly?: boolean;
  qualityMappings?: Record<string, string>;
}

const LiveGridComponent: React.FC<LiveGridProps> = ({
  channels,
  categories,
  activeChannel,
  favoriteChannelIds,
  onPlayChannel,
  onNavigate,
  onToggleFavorite,
  getChannelEpgInfo,
  initialCategory = 'All channels',
  showFavoritesOnly = false,
  qualityMappings
}) => {
  const { t, locale } = useI18n();
  const { state, updateState, saveScrollTop, initialScrollTop, density, setDensity } = useNavigationState(showFavoritesOnly ? 'favorites' : 'live', initialCategory);
  const { selectedCategory, searchText } = state;
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = useMemo(
    () => normalizeSearchText(deferredSearchText.trim()),
    [deferredSearchText]
  );
  const effectiveSelectedCategory = selectedCategory === 'All channels' || categories.includes(selectedCategory)
    ? selectedCategory
    : 'All channels';

  // Filter & search channels
  const isChannelFavorite = useCallback((channel: Channel) => {
    if (favoriteChannelIds.has(channel.id)) return true;
    return (channel.variants || []).some(variant => favoriteChannelIds.has(variant.id));
  }, [favoriteChannelIds]);

  const filteredChannels = useMemo(() => {
    const hasSearch = normalizedSearchText.length > 0;

    if (!showFavoritesOnly && effectiveSelectedCategory === 'All channels' && !hasSearch) {
      return channels;
    }

    const result: Channel[] = [];

    for (const channel of channels) {
      if (showFavoritesOnly && !isChannelFavorite(channel)) {
        continue;
      }

      if (!showFavoritesOnly && effectiveSelectedCategory !== 'All channels' && channel.groupTitle !== effectiveSelectedCategory) {
        continue;
      }

      if (hasSearch) {
        const channelMatch = normalizeSearchText(channel.name).includes(normalizedSearchText);
        if (!channelMatch) {
          const epg = getChannelEpgInfo(channel);
          const programMatch = epg.program?.title ? normalizeSearchText(epg.program.title).includes(normalizedSearchText) : false;
          if (!programMatch) continue;
        }
      }

      result.push(channel);
    }

    return result;
  }, [channels, effectiveSelectedCategory, getChannelEpgInfo, isChannelFavorite, normalizedSearchText, showFavoritesOnly]);

  const { scrollContainerRef, handleScroll, resetScroll, handleFocusCapture, handleBlurCapture, columns, virtualized, window: virtualWindow } = useVirtualCollection({
    itemCount: filteredChannels.length,
    itemHeight: 190,
    gap: 14,
    minimumWidth: density === 'compact' ? 158 : density === 'large' ? 240 : 190,
    initialScrollTop,
    onScrollTop: saveScrollTop
  });

  const renderChannel = (channel: Channel, index: number, top?: number) => {
    const { program, progress } = getChannelEpgInfo(channel);
    const isActive = activeChannel
      ? activeChannel.id === channel.id || (channel.variants?.some(v => v.id === activeChannel.id) ?? false)
      : false;
    return (
      <div
        key={channel.id}
        data-virtual-index={index}
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={filteredChannels.length}
        className={virtualized ? 'navigation-virtual-channel-item' : undefined}
        style={top === undefined ? undefined : {
          top,
          left: `calc(${(index % columns) * 100 / columns}% + ${(index % columns) * 14 / columns}px)`,
          width: `calc(${100 / columns}% - ${(columns - 1) * 14 / columns}px)`
        }}
      >
        <ChannelCard
          channel={channel}
          isActive={isActive}
          isFavorite={isChannelFavorite(channel)}
          onPlay={onPlayChannel}
          onToggleFavorite={onToggleFavorite}
          currentProgram={program}
          currentProgress={progress}
          activeChannelId={activeChannel?.id}
          qualityMappings={qualityMappings}
        />
      </div>
    );
  };

  return (
    <div 
      className="live-page animate-fade"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        height: '100%'
      }}
    >
      <header className="page-header live-page-header">
        <div>
          <h2>{t(showFavoritesOnly ? 'Favorites' : 'Live TV')} <span className="page-result-count" role="status" aria-live="polite" aria-label={t('{count} channels available', { count: filteredChannels.length.toLocaleString(locale) })}>{filteredChannels.length.toLocaleString(locale)}</span></h2>
        </div>
      </header>

      <div className="live-toolbar">
        {/* Category Dropdown (only show if not favorites tab) */}
        {!showFavoritesOnly ? (
          <div className="live-toolbar__category">
            <label htmlFor="live-category" className="field-label">{t('Category')}</label>
            <select
              id="live-category"
              value={effectiveSelectedCategory}
              onChange={(e) => { resetScroll(); updateState({ selectedCategory: e.target.value, scrollTop: 0 }); }}
              className="text-input"
              style={{
                borderRadius: 'var(--radius-control)',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '10px 16px',
                fontSize: '13px',
                minWidth: '200px',
                cursor: 'pointer'
              }}
            >
              {categories.map((cat, idx) => (
                <option key={idx} value={cat} style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
                  {cat === 'All channels' ? t('All channels') : cat}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Search and density controls */}
        <div className="live-toolbar__actions">
          <div className="search-field live-search-field">
            <input
              type="search"
              aria-label={t('Search channels or programmes')}
              className="text-input"
              placeholder={t('Search channels or programmes...')}
              value={searchText}
              onChange={(e) => { resetScroll(); updateState({ searchText: e.target.value, scrollTop: 0 }); }}
            />
            <div aria-hidden="true" className="live-search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>
          <div className="segmented-control density-control" role="group" aria-label={t('Channel card density')}>
            {(['compact', 'comfortable', 'large'] as const).map(option => (
              <button
                key={option}
                type="button"
                className={density === option ? 'is-selected' : ''}
                aria-pressed={density === option}
                onClick={() => setDensity(option)}
              >
                {t(option === 'compact' ? 'Compact' : option === 'comfortable' ? 'Comfortable' : 'Large')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid Container with Scroll Listener */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        className="navigation-channel-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: '4px'
        }}
      >
        {filteredChannels.length > 0 ? (
          <div className="navigation-channel-results" style={{ paddingBottom: activeChannel ? '180px' : '20px' }}>
            <div
              className={virtualized ? 'navigation-virtual-collection' : `channel-grid channel-grid--${density}`}
              role="list"
              aria-label={t('Channels')}
              style={virtualized ? { height: virtualWindow.totalHeight } : undefined}
            >
              {virtualized
                ? virtualWindow.rows.flatMap(row => filteredChannels.slice(row.startIndex, row.endIndex).map((channel, offset) => renderChannel(channel, row.startIndex + offset, row.top)))
                : filteredChannels.map((channel, index) => renderChannel(channel, index))}
            </div>
          </div>
        ) : (
          <div 
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '18px',
              padding: '80px 20px',
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px dashed rgba(255, 255, 255, 0.05)',
              borderRadius: 'var(--radius-card)',
              color: 'var(--text-secondary)',
              fontSize: '13px'
            }}
          >
            <strong>{t(normalizedSearchText || effectiveSelectedCategory !== 'All channels'
              ? 'No matching channels found.'
              : showFavoritesOnly ? 'No favorite channels yet.' : 'No channels available.')}</strong>
            <button type="button" className="btn-secondary" onClick={() => {
              if (normalizedSearchText || effectiveSelectedCategory !== 'All channels') {
                resetScroll();
                updateState({ searchText: '', selectedCategory: 'All channels', scrollTop: 0 });
              } else onNavigate(showFavoritesOnly ? 'Live' : 'Settings');
            }}>{t(normalizedSearchText || effectiveSelectedCategory !== 'All channels' ? 'Clear filters' : showFavoritesOnly ? 'Browse channels' : 'Add playlist')}</button>
          </div>
        )}
      </div>
    </div>
  );
};

export const LiveGrid = memo(LiveGridComponent);
