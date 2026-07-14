import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, EPGProgram } from '../types';
import { ChannelCard } from './ChannelCard';

const INITIAL_VISIBLE_COUNT = 60;
const LOAD_MORE_COUNT = 40;

interface LiveGridProps {
  channels: Channel[];
  categories: string[];
  activeChannel: Channel | null;
  favoriteChannelIds: Set<string>;
  onPlayChannel: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  getChannelEpgInfo: (channel: Channel) => { program: EPGProgram | null; progress: number; upcoming?: EPGProgram[] };
  initialCategory?: string;
  showFavoritesOnly?: boolean;
  qualityMappings?: Record<string, string>;
  nowMs?: number;
}

const LiveGridComponent: React.FC<LiveGridProps> = ({
  channels,
  categories,
  activeChannel,
  favoriteChannelIds,
  onPlayChannel,
  onToggleFavorite,
  getChannelEpgInfo,
  initialCategory = 'All channels',
  showFavoritesOnly = false,
  qualityMappings,
  nowMs = 0
}) => {
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [searchText, setSearchText] = useState('');
  const [density, setDensity] = useState<'compact' | 'comfortable' | 'large'>('comfortable');
  const [nowOnly, setNowOnly] = useState(false);
  const [startingSoonMinutes, setStartingSoonMinutes] = useState<0 | 15 | 30 | 60>(0);
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = useMemo(
    () => deferredSearchText.toLowerCase().trim(),
    [deferredSearchText]
  );
  const effectiveSelectedCategory = selectedCategory === 'All channels' || categories.includes(selectedCategory)
    ? selectedCategory
    : 'All channels';
  const filterKey = `${effectiveSelectedCategory}\u0000${normalizedSearchText}\u0000${showFavoritesOnly}\u0000${nowOnly}\u0000${startingSoonMinutes}`;
  const [pagination, setPagination] = useState({ filterKey, visibleCount: INITIAL_VISIBLE_COUNT });
  const visibleCount = pagination.filterKey === filterKey ? pagination.visibleCount : INITIAL_VISIBLE_COUNT;
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when filters change; page size is derived from filterKey.
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filterKey]);

  // Filter & search channels
  const isChannelFavorite = useCallback((channel: Channel) => {
    if (favoriteChannelIds.has(channel.id)) return true;
    return (channel.variants || []).some(variant => favoriteChannelIds.has(variant.id));
  }, [favoriteChannelIds]);

  const filteredChannels = useMemo(() => {
    const result: Channel[] = [];
    const hasSearch = normalizedSearchText.length > 0;

    for (const channel of channels) {
      if (showFavoritesOnly && !isChannelFavorite(channel)) {
        continue;
      }

      if (!showFavoritesOnly && effectiveSelectedCategory !== 'All channels' && channel.groupTitle !== effectiveSelectedCategory) {
        continue;
      }

      if (hasSearch) {
        const channelMatch = channel.name.toLowerCase().includes(normalizedSearchText);
        if (!channelMatch) {
          const epg = getChannelEpgInfo(channel);
          const programMatch = epg.program?.title?.toLowerCase().includes(normalizedSearchText) || false;
          if (!programMatch) continue;
        }
      }

      const epg = (nowOnly || startingSoonMinutes > 0) ? getChannelEpgInfo(channel) : null;
      if (nowOnly && !epg?.program) continue;
      if (startingSoonMinutes > 0) {
        const threshold = nowMs + startingSoonMinutes * 60_000;
        const startsSoon = epg?.upcoming?.some(programme => {
          const start = Date.parse(programme.startUtc);
          return Number.isFinite(start) && start >= nowMs && start <= threshold;
        });
        if (!startsSoon) continue;
      }

      result.push(channel);
    }

    return result;
  }, [channels, effectiveSelectedCategory, getChannelEpgInfo, isChannelFavorite, normalizedSearchText, nowMs, nowOnly, showFavoritesOnly, startingSoonMinutes]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleCount),
    [filteredChannels, visibleCount]
  );

  // Handle scroll trigger to load more items (Infinite Scroll)
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    // Check if scrolled near the bottom (within 200px)
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 200) {
      setPagination(prev => {
        const currentVisibleCount = prev.filterKey === filterKey ? prev.visibleCount : INITIAL_VISIBLE_COUNT;
        if (currentVisibleCount >= filteredChannels.length) {
          return prev;
        }

        const nextVisibleCount = Math.min(filteredChannels.length, currentVisibleCount + LOAD_MORE_COUNT);
        return {
          filterKey,
          visibleCount: nextVisibleCount
        };
      });
    }
  }, [filterKey, filteredChannels.length]);

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
          <p className="page-eyebrow">{showFavoritesOnly ? 'Library' : 'Broadcasts'}</p>
          <h2>{showFavoritesOnly ? 'Favorites' : 'Live TV'}</h2>
          <p>{filteredChannels.length.toLocaleString()} {filteredChannels.length === 1 ? 'channel' : 'channels'} available</p>
        </div>
      </header>

      <div 
        className="live-toolbar"
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          gap: '16px',
          flexWrap: 'wrap'
        }}
      >
        {/* Category Dropdown (only show if not favorites tab) */}
        {!showFavoritesOnly ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label htmlFor="live-category" className="field-label">Category</label>
            <select
              id="live-category"
              value={effectiveSelectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
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
                  {cat}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Browse your starred favorite channels.
          </div>
        )}

        {/* Search and density controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <label className="settings-switch-row live-filter-switch"><input type="checkbox" checked={nowOnly} onChange={(event) => setNowOnly(event.target.checked)} /><span><strong>On now</strong></span></label>
          <label className="field-label">Starting soon<select className="text-input" value={startingSoonMinutes} onChange={(event) => setStartingSoonMinutes(Number(event.target.value) as 0 | 15 | 30 | 60)}><option value={0}>Any time</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label>
          <div className="segmented-control density-control" aria-label="Channel card density">
            {(['compact', 'comfortable', 'large'] as const).map(option => (
              <button
                key={option}
                type="button"
                className={density === option ? 'is-selected' : ''}
                aria-pressed={density === option}
                onClick={() => setDensity(option)}
              >
                {option === 'compact' ? 'Compact' : option === 'comfortable' ? 'Comfortable' : 'Large'}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="search-field">
            <input
              type="search"
              aria-label="Search channels or programmes"
              className="text-input"
              placeholder="Search channels or programmes..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ 
                width: '100%', 
                borderRadius: 'var(--radius-control)',
                paddingLeft: '38px',
                paddingTop: '10px',
                paddingBottom: '10px'
              }}
            />
            <div aria-hidden="true" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Container with Scroll Listener */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: '4px'
        }}
      >
        {visibleChannels.length > 0 ? (
          <div
            className={`channel-grid channel-grid--${density}`}
            style={{ paddingBottom: activeChannel ? '180px' : '20px' }}
          >
            {visibleChannels.map((channel) => {
              const { program, progress } = getChannelEpgInfo(channel);
              const isActive = activeChannel
                ? activeChannel.id === channel.id || (channel.variants?.some(v => v.id === activeChannel.id) ?? false)
                : false;
              return (
                <ChannelCard
                  key={channel.id}
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
              );
            })}
          </div>
        ) : (
          <div 
            style={{
              padding: '80px 20px',
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px dashed rgba(255, 255, 255, 0.05)',
              borderRadius: 'var(--radius-card)',
              color: 'var(--text-secondary)',
              fontSize: '13px'
            }}
          >
            {showFavoritesOnly
              ? 'No favorite channels yet. Star a channel to add it here.'
              : normalizedSearchText || selectedCategory !== 'All channels'
                ? 'No channels found matching the selected filters.'
                : 'No channels are available. Configure a playlist in Settings.'}
          </div>
        )}
      </div>
    </div>
  );
};

export const LiveGrid = memo(LiveGridComponent);
