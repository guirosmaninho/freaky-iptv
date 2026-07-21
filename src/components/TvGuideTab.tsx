import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, EPGProgram, Reminder } from '../types';

const INITIAL_VISIBLE_GUIDE_COUNT = 80;
const GUIDE_LOAD_MORE_COUNT = 60;

interface TvGuideTabProps {
  channels: Channel[];
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

const formatTime = (isoString: string) => {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
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
  const reminderId = (programme: EPGProgram) => `${channel.id}\u0000${programme.startUtc}`;
  const reminderButton = (programme: EPGProgram) => (
    <button
      type="button"
      className="player-ghost-button tv-guide-reminder-button"
      onClick={(event) => { event.stopPropagation(); onToggleReminder(channel, programme); }}
      aria-label={`${reminders.some(reminder => reminder.id === reminderId(programme)) ? 'Remove' : 'Set'} reminder for ${programme.title}`}
    >
      {reminders.some(reminder => reminder.id === reminderId(programme)) ? 'Reminder set' : 'Remind me'}
    </button>
  );
  const renderUpcomingCell = (upcomingProgram: EPGProgram | undefined, label: string, className = '') => (
    <div className={`tv-guide-cell tv-guide-upcoming ${className}`}>
      {upcomingProgram ? (
        <>
          <span className="tv-guide-cell-label">{label}</span>
          <span className="tv-guide-program-title" title={upcomingProgram.title}>
            {upcomingProgram.title}
          </span>
          <span className="tv-guide-program-time">
            {formatTime(upcomingProgram.startUtc)} - {formatTime(upcomingProgram.stopUtc)}
          </span>
          {reminderButton(upcomingProgram)}
        </>
      ) : (
        <span className="tv-guide-empty">No upcoming programme</span>
      )}
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className="tv-guide-grid tv-guide-row glass-card"
      onClick={() => onPlayChannel(channel)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPlayChannel(channel);
        }
      }}
      title={`Play ${channel.name}`}
    >
      <div className="tv-guide-channel">
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
          <span className="tv-guide-channel-group" title={channel.groupTitle}>
            {channel.groupTitle || 'Uncategorised'}
          </span>
        </div>
      </div>

      <div className="tv-guide-cell tv-guide-current">
        {program ? (
          <>
            <span className="tv-guide-now-label">
              <span className="live-indicator" />
              Live now
            </span>
            <span className="tv-guide-program-title tv-guide-program-title--current" title={program.title}>
              {program.title}
            </span>
            <span className="tv-guide-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
            <span className="tv-guide-program-time">
              {formatTime(program.startUtc)} - {formatTime(program.stopUtc)}
            </span>
            {reminderButton(program)}
          </>
        ) : (
          <span className="tv-guide-empty">No schedule available</span>
        )}
      </div>

      {renderUpcomingCell(upcoming[0], 'Next')}
      {renderUpcomingCell(upcoming[1], 'Later', 'tv-guide-later-2')}
      {renderUpcomingCell(upcoming[2], 'Later', 'tv-guide-later-3')}
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
    prevProps.onToggleReminder === nextProps.onToggleReminder &&
    areUpcomingEqual(prevProps.upcoming, nextProps.upcoming)
  );
});

const TvGuideTabComponent: React.FC<TvGuideTabProps> = ({
  channels,
  onPlayChannel,
  getChannelEpgInfo,
  reminders,
  onToggleReminder
}) => {
  const [searchText, setSearchText] = useState('');
  const [reminderLeadMinutes, setReminderLeadMinutes] = useState<Reminder['leadMinutes']>(10);
  const [logoFailedMap, setLogoFailedMap] = useState<Record<string, boolean>>({});
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = useMemo(
    () => deferredSearchText.toLowerCase().trim(),
    [deferredSearchText]
  );
  const filterKey = normalizedSearchText;
  const [pagination, setPagination] = useState({
    filterKey,
    visibleCount: INITIAL_VISIBLE_GUIDE_COUNT
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const visibleCount = pagination.filterKey === filterKey
    ? pagination.visibleCount
    : INITIAL_VISIBLE_GUIDE_COUNT;

  const handleLogoError = useCallback((channelId: string) => {
    setLogoFailedMap(prev => ({ ...prev, [channelId]: true }));
  }, []);

  const handleRowToggleReminder = useCallback(
    (channel: Channel, programme: EPGProgram) => onToggleReminder(channel, programme, reminderLeadMinutes),
    [onToggleReminder, reminderLeadMinutes]
  );

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filterKey]);

  const filteredChannels = useMemo(() => {
    if (!normalizedSearchText) {
      return channels;
    }

    return channels.filter(channel => {
      const nameMatch = channel.name.toLowerCase().includes(normalizedSearchText);
      if (nameMatch) return true;

      const epg = getChannelEpgInfo(channel);
      const activeMatch = epg.program?.title?.toLowerCase().includes(normalizedSearchText) || false;
      const upcomingMatch = epg.upcoming?.some(prog => prog.title.toLowerCase().includes(normalizedSearchText)) || false;
      return activeMatch || upcomingMatch;
    });
  }, [channels, getChannelEpgInfo, normalizedSearchText]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleCount),
    [filteredChannels, visibleCount]
  );

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (container.scrollHeight - container.scrollTop - container.clientHeight < 240) {
      setPagination(prev => {
        const currentVisibleCount = prev.filterKey === filterKey ? prev.visibleCount : INITIAL_VISIBLE_GUIDE_COUNT;
        if (currentVisibleCount >= filteredChannels.length) {
          return prev;
        }

        return {
          filterKey,
          visibleCount: Math.min(filteredChannels.length, currentVisibleCount + GUIDE_LOAD_MORE_COUNT)
        };
      });
    }
  }, [filterKey, filteredChannels.length]);

  return (
    <div className="tv-guide-tab animate-fade">
      <div className="tv-guide-toolbar">
        <div className="tv-guide-heading">
          <p className="page-eyebrow">Schedule</p>
          <h2 className="tv-guide-title">TV Guide</h2>
          <p className="tv-guide-subtitle">
            See current and upcoming schedules for channels in your playlist.
          </p>
        </div>

        <div className="tv-guide-search">
          <input
            type="search"
            aria-label="Search TV guide channels or programmes"
            className="text-input"
            placeholder="Search channels or programmes..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <div className="tv-guide-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
        <label className="field-label">
          Reminder
          <select value={reminderLeadMinutes} onChange={(event) => setReminderLeadMinutes(Number(event.target.value) as Reminder['leadMinutes'])} className="text-input">
            {[0, 5, 10, 15, 30].map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? 'At start' : `${minutes} min before`}</option>)}
          </select>
        </label>
      </div>

      <div className="tv-guide-scroll" onScroll={handleScroll} ref={scrollContainerRef}>
        {filteredChannels.length > 0 ? (
          <>
            <div className="tv-guide-grid tv-guide-header-row" aria-hidden="true">
              <span>Channel</span>
              <span>Now airing</span>
              <span>Next</span>
              <span className="tv-guide-later-2">Later</span>
              <span className="tv-guide-later-3">Later</span>
            </div>

            <div className="tv-guide-list">
              {visibleChannels.map((channel) => {
                const { program, progress, upcoming } = getChannelEpgInfo(channel);

                return (
                  <TvGuideRow
                    key={channel.id}
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
                );
              })}
            </div>
          </>
        ) : (
          <div className="tv-guide-empty-state">
            No matching channels found.
          </div>
        )}
      </div>
    </div>
  );
};

export const TvGuideTab = memo(TvGuideTabComponent);
