import { formatProgrammeTime as formatTime } from '../services/programmeTime';
import React, { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import type { Channel, EPGProgram, Reminder } from '../types';
import { useI18n } from '../hooks/useI18n';
import { useNavigationState } from '../hooks/useNavigationState';
import { useVirtualCollection } from '../hooks/useVirtualCollection';
import '../navigation.css';

interface TvGuideTabProps {
  channels: Channel[];
  onNavigate: (section: string) => void;
  onPlayChannel: (channel: Channel) => void;
  getChannelEpgInfo: (channel: Channel) => { program: EPGProgram | null; progress: number; upcoming: EPGProgram[] };
  reminders: Reminder[];
  onToggleReminder: (channel: Channel, programme: EPGProgram, leadMinutes: Reminder['leadMinutes']) => void;
}

const getInitials = (name: string) => {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'TV';
};



interface TvGuideRowProps {
  channel: Channel;
  onPlayChannel: (channel: Channel) => void;
  logoFailed: boolean;
  onLogoError: (channelId: string) => void;
  program: EPGProgram | null;
  progress: number;
  upcoming: EPGProgram[];
  reminders: Reminder[];
  onToggleReminder: (channel: Channel, programme: EPGProgram) => void;
}

const TvGuideRowComponent: React.FC<TvGuideRowProps> = ({
  channel,
  onPlayChannel,
  logoFailed,
  onLogoError,
  program,
  progress,
  upcoming,
  reminders,
  onToggleReminder
}) => {
  const { t, locale } = useI18n();
  const reminderId = (programme: EPGProgram) => `${channel.id}\u0000${programme.startUtc}`;
  const reminderButton = (programme: EPGProgram) => {
    const isReminderSet = reminders.some(reminder => reminder.id === reminderId(programme));

    return (
      <button
        type="button"
        className={`player-ghost-button tv-guide-reminder-button${isReminderSet ? ' is-active' : ''}`}
        onClick={(event) => { event.stopPropagation(); onToggleReminder(channel, programme); }}
        aria-pressed={isReminderSet}
        aria-label={t(isReminderSet ? 'Remove reminder for {programme}' : 'Set reminder for {programme}', { programme: programme.title })}
      >
        {t(isReminderSet ? 'Reminder set' : 'Remind me')}
      </button>
    );
  };
  const renderUpcomingCell = (upcomingProgram: EPGProgram | undefined, label: string, className = '') => (
    <div className={`tv-guide-cell tv-guide-upcoming ${className}`}>
      {upcomingProgram ? (
        <>
          <span className="sr-only">{label}</span>
          <span className="tv-guide-program-title" title={upcomingProgram.title}>
            {upcomingProgram.title}
          </span>
          <span className="tv-guide-program-time">
            {formatTime(upcomingProgram.startUtc, locale)} - {formatTime(upcomingProgram.stopUtc, locale)}
          </span>
          {reminderButton(upcomingProgram)}
        </>
      ) : (
        <span className="tv-guide-empty" aria-label={t('No upcoming programme')}>—</span>
      )}
    </div>
  );

  return (
    <div
      className="tv-guide-grid tv-guide-row glass-card"
      onClick={() => onPlayChannel(channel)}
    >
      <button
        type="button"
        className="tv-guide-channel navigation-guide-play"
        aria-label={t('Play {channel}', { channel: channel.name })}
        onClick={(event) => { event.stopPropagation(); onPlayChannel(channel); }}
      >
        <div className="tv-guide-logo">
          {channel.logoUrl && !logoFailed ? (
            <img
              src={channel.logoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => onLogoError(channel.id)}
            />
          ) : (
            <span>{getInitials(channel.name)}</span>
          )}
        </div>

        <div className="tv-guide-channel-text">
          <span className="tv-guide-channel-name" title={channel.name}>
            {channel.name}
          </span>
        </div>
      </button>

      <div className="tv-guide-cell tv-guide-current">
        {program ? (
          <>
            <span className="tv-guide-program-title tv-guide-program-title--current" title={program.title}>
              {program.title}
            </span>
            <span className="tv-guide-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
            <span className="tv-guide-program-time">
              {formatTime(program.startUtc, locale)} - {formatTime(program.stopUtc, locale)}
            </span>
            {reminderButton(program)}
          </>
        ) : (
          <span className="tv-guide-empty">{t('No schedule available')}</span>
        )}
      </div>

      {renderUpcomingCell(upcoming[0], t('Next'))}
      {renderUpcomingCell(upcoming[1], t('Later'), 'tv-guide-later-2')}
      {renderUpcomingCell(upcoming[2], t('Later'), 'tv-guide-later-3')}
    </div>
  );
};

const areUpcomingEqual = (a: EPGProgram[], b: EPGProgram[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const TvGuideRow = memo(TvGuideRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.logoFailed === nextProps.logoFailed &&
    prevProps.program === nextProps.program &&
    Math.round(prevProps.progress) === Math.round(nextProps.progress) &&
    prevProps.channel.id === nextProps.channel.id &&
    prevProps.channel.name === nextProps.channel.name &&
    prevProps.channel.logoUrl === nextProps.channel.logoUrl &&
    prevProps.channel.groupTitle === nextProps.channel.groupTitle &&
    prevProps.reminders === nextProps.reminders &&
    prevProps.onPlayChannel === nextProps.onPlayChannel &&
    prevProps.onLogoError === nextProps.onLogoError &&
    prevProps.onToggleReminder === nextProps.onToggleReminder &&
    areUpcomingEqual(prevProps.upcoming, nextProps.upcoming)
  );
});

const TvGuideTabComponent: React.FC<TvGuideTabProps> = ({
  channels,
  onPlayChannel,
  onNavigate,
  getChannelEpgInfo,
  reminders,
  onToggleReminder
}) => {
  const { t } = useI18n();
  const { state, updateState, saveScrollTop, initialScrollTop } = useNavigationState('guide');
  const { searchText, selectedCategory, reminderLeadMinutes } = state;
  const [logoFailedMap, setLogoFailedMap] = useState<Record<string, boolean>>({});
  const categories = useMemo(() => [...new Set(['All channels', ...channels.map(channel => channel.groupTitle).filter(Boolean)])], [channels]);
  const effectiveSelectedCategory = categories.includes(selectedCategory) ? selectedCategory : 'All channels';
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = useMemo(
    () => deferredSearchText.toLowerCase().trim(),
    [deferredSearchText]
  );

  const handleLogoError = useCallback((channelId: string) => {
    setLogoFailedMap(prev => ({ ...prev, [channelId]: true }));
  }, []);

  const handleRowToggleReminder = useCallback(
    (channel: Channel, programme: EPGProgram) => onToggleReminder(channel, programme, reminderLeadMinutes),
    [onToggleReminder, reminderLeadMinutes]
  );

  const filteredChannels = useMemo(() => {
    if (!normalizedSearchText && effectiveSelectedCategory === 'All channels') {
      return channels;
    }

    return channels.filter(channel => {
      if (effectiveSelectedCategory !== 'All channels' && channel.groupTitle !== effectiveSelectedCategory) return false;
      if (!normalizedSearchText) return true;
      const nameMatch = channel.name.toLowerCase().includes(normalizedSearchText);
      if (nameMatch) return true;

      const epg = getChannelEpgInfo(channel);
      const activeMatch = epg.program?.title?.toLowerCase().includes(normalizedSearchText) || false;
      const upcomingMatch = epg.upcoming?.some(prog => prog.title.toLowerCase().includes(normalizedSearchText)) || false;
      return activeMatch || upcomingMatch;
    });
  }, [channels, getChannelEpgInfo, normalizedSearchText, effectiveSelectedCategory]);

  const { scrollContainerRef, handleScroll, resetScroll, handleFocusCapture, handleBlurCapture, virtualized, window: virtualWindow } = useVirtualCollection({
    itemCount: filteredChannels.length,
    itemHeight: 148,
    gap: 8,
    leadingHeight: 42,
    initialScrollTop,
    onScrollTop: saveScrollTop
  });

  const renderRow = (channel: Channel, index: number, top?: number) => {
    const { program, progress, upcoming } = getChannelEpgInfo(channel);
    return (
      <div
        key={channel.id}
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={filteredChannels.length}
        data-virtual-index={index}
        className={virtualized ? 'navigation-virtual-guide-row' : undefined}
        style={top === undefined ? undefined : { top }}
      >
        <TvGuideRow
          channel={channel}
          onPlayChannel={onPlayChannel}
          logoFailed={Boolean(logoFailedMap[channel.id])}
          onLogoError={handleLogoError}
          program={program}
          progress={progress}
          upcoming={upcoming}
          reminders={reminders}
          onToggleReminder={handleRowToggleReminder}
        />
      </div>
    );
  };

  return (
    <div className="tv-guide-tab navigation-guide animate-fade">
      <div className="tv-guide-toolbar">
        <div className="tv-guide-heading">
          <h2 className="tv-guide-title">{t('TV Guide')}</h2>
        </div>

        <div className="tv-guide-search">
          <input
            type="search"
            aria-label={t('Search TV guide channels or programmes')}
            className="text-input"
            placeholder={t('Search channels or programmes...')}
            value={searchText}
            onChange={(event) => { resetScroll(); updateState({ searchText: event.target.value, scrollTop: 0 }); }}
          />
          <div className="tv-guide-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
        <label className="field-label">
          {t('Reminder')}
          <select value={reminderLeadMinutes} onChange={(event) => updateState({ reminderLeadMinutes: Number(event.target.value) as Reminder['leadMinutes'] })} className="text-input">
            {[0, 5, 10, 15, 30].map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? t('At start') : t('{minutes} min before', { minutes })}</option>)}
          </select>
        </label>
      </div>

      <div className="navigation-guide-filters">
        <label htmlFor="guide-category" className="field-label">{t('Category')}</label>
        <select id="guide-category" className="text-input" value={effectiveSelectedCategory} onChange={(event) => { resetScroll(); updateState({ selectedCategory: event.target.value, scrollTop: 0 }); }}>
          {categories.map(category => <option key={category} value={category}>{category === 'All channels' ? t('All channels') : category}</option>)}
        </select>
      </div>

      <div className="tv-guide-scroll" onScroll={handleScroll} ref={scrollContainerRef} onFocusCapture={handleFocusCapture} onBlurCapture={handleBlurCapture}>
        {filteredChannels.length > 0 ? (
          <>
            <div className="tv-guide-grid tv-guide-header-row" aria-hidden="true">
              <span>{t('Channel')}</span>
              <span>{t('Now airing')}</span>
              <span>{t('Next')}</span>
              <span className="tv-guide-later-2">{t('Later')}</span>
              <span className="tv-guide-later-3">{t('Later')}</span>
            </div>

            <div className={virtualized ? 'navigation-virtual-collection navigation-virtual-guide' : 'tv-guide-list'} role="list" aria-label={t('Channel schedules')} style={virtualized ? { height: virtualWindow.totalHeight } : undefined}>
              {virtualized
                ? virtualWindow.rows.map(row => renderRow(filteredChannels[row.startIndex], row.startIndex, row.top))
                : filteredChannels.map((channel, index) => renderRow(channel, index))}
            </div>
          </>
        ) : (
          <div className="tv-guide-empty-state">
            <strong>{t(channels.length ? 'No matching channels found.' : 'No channels available.')}</strong>
            <button type="button" className="btn-secondary" onClick={() => {
              if (!channels.length) { onNavigate('Settings'); return; }
              resetScroll();
              updateState({ searchText: '', selectedCategory: 'All channels', scrollTop: 0 });
            }}>{t(channels.length ? 'Clear filters' : 'Add playlist')}</button>
          </div>
        )}
      </div>
    </div>
  );
};

export const TvGuideTab = memo(TvGuideTabComponent);
