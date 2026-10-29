import { formatProgrammeTime as formatTime } from '../services/programmeTime';
import { useI18n } from '../hooks/useI18n';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, EPGProgram } from '../types';
import { getChannelBaseNamePreserveCase, getChannelQualityLabel } from '../services/utils';
import { getChannelInitials, isUsableChannelLogo } from '../services/channelArtwork';

interface ChannelCardProps {
  channel: Channel;
  isActive: boolean;
  isFavorite: boolean;
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  currentProgram: EPGProgram | null;
  currentProgress: number; // 0..100
  activeChannelId?: string;
  qualityMappings?: Record<string, string>;
}

const ChannelCardComponent: React.FC<ChannelCardProps> = ({
  channel,
  isActive,
  isFavorite,
  onPlay,
  onToggleFavorite,
  currentProgram,
  currentProgress,
  activeChannelId,
  qualityMappings
}) => {
  const { t, locale } = useI18n();
  const displayName = getChannelBaseNamePreserveCase(channel.name, qualityMappings) || channel.name;
  const [logoFailed, setLogoFailed] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const channelInitials = useMemo(() => getChannelInitials(channel.name), [channel.name]);

  const closeQualityMenu = useCallback((restoreFocus = true) => {
    setIsDropdownOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => qualityButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;

    const selectedMenuItem = qualityMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
    const firstMenuItem = qualityMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    requestAnimationFrame(() => (selectedMenuItem ?? firstMenuItem)?.focus());

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (qualityButtonRef.current?.contains(target) || qualityMenuRef.current?.contains(target)) return;
      closeQualityMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeQualityMenu();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeQualityMenu, isDropdownOpen]);

  return (
    <article className="channel-card" aria-current={isActive ? 'true' : undefined}>
      <button
        type="button"
        className="channel-card-play"
        aria-label={t('Play {channel}', { channel: displayName })}
        onClick={() => onPlay(channel)}
      />
      <div className="channel-artwork" aria-hidden="true">
        {isUsableChannelLogo(channel.logoUrl) && !logoFailed ? (
          <img src={channel.logoUrl} alt="" loading="lazy" decoding="async" onError={() => setLogoFailed(true)} />
        ) : <span className="channel-initials">{channelInitials}</span>}
        <span className="channel-play-affordance">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7Z" /></svg>
        </span>
        {isActive && <span className="channel-on-air"><i />{t('LIVE')}</span>}
      </div>
      <div className="channel-card-tools">
        {channel.variants && channel.variants.length > 1 && (
          <button
            ref={qualityButtonRef}
            type="button"
            className="channel-tool"
            aria-label={t('Choose transmission quality for {channel}', { channel: displayName })}
            aria-haspopup="menu"
            aria-expanded={isDropdownOpen}
            onClick={() => isDropdownOpen ? closeQualityMenu(false) : setIsDropdownOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
          </button>
        )}
        <button
          type="button"
          className="channel-tool channel-favorite"
          aria-label={t(isFavorite ? 'Remove {channel} from favorites' : 'Add {channel} to favorites', { channel: displayName })}
          aria-pressed={isFavorite}
          onClick={() => onToggleFavorite(channel)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        </button>
      </div>
      {isDropdownOpen && channel.variants && (
        <div
          ref={qualityMenuRef}
          className="channel-quality-menu"
          role="menu"
          aria-label={t('Transmission quality for {channel}', { channel: displayName })}
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
            const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[nextIndex]?.focus();
          }}
        >
          {channel.variants.map(variant => (
            <button key={variant.id} type="button" role="menuitemradio" aria-checked={variant.id === activeChannelId}
              onClick={() => { closeQualityMenu(); onPlay(variant); }}>
              <span>{t(getChannelQualityLabel(variant.name, qualityMappings))}</span>
              {variant.id === activeChannelId && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
            </button>
          ))}
        </div>
      )}
      <div className="channel-card-copy">
        <h3 title={displayName}>{displayName}</h3>
        <div className="channel-programme">
          <span className="channel-programme-title" title={currentProgram?.title}>{currentProgram?.title || t('No programme information')}</span>
          {currentProgram && <>
            <div className="channel-programme-progress" aria-hidden="true"><span style={{ width: `${currentProgress}%` }} /></div>
            <div className="channel-programme-time"><span>{formatTime(currentProgram.startUtc, locale)}</span><span>{formatTime(currentProgram.stopUtc, locale)}</span></div>
          </>}
        </div>
      </div>
    </article>
  );
};

export const ChannelCard = memo(ChannelCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.isFavorite === nextProps.isFavorite &&
    (!nextProps.isActive || prevProps.activeChannelId === nextProps.activeChannelId) &&
    Math.round(prevProps.currentProgress) === Math.round(nextProps.currentProgress) &&
    prevProps.currentProgram === nextProps.currentProgram &&
    channelContentEqual(prevProps.channel, nextProps.channel) &&
    prevProps.qualityMappings === nextProps.qualityMappings
  );
});

function channelContentEqual(left: Channel, right: Channel): boolean {
  if (left === right) return true;
  if (left.contentRevision && right.contentRevision) return left.contentRevision === right.contentRevision;
  if (left.id !== right.id || left.tvgId !== right.tvgId || left.name !== right.name ||
    left.logoUrl !== right.logoUrl || left.groupTitle !== right.groupTitle || left.streamUrl !== right.streamUrl) {
    return false;
  }
  const leftVariants = left.variants || [];
  const rightVariants = right.variants || [];
  if (leftVariants.length !== rightVariants.length) return false;
  for (let index = 0; index < leftVariants.length; index += 1) {
    const a = leftVariants[index];
    const b = rightVariants[index];
    if (a.id !== b.id || a.name !== b.name || a.streamUrl !== b.streamUrl || a.logoUrl !== b.logoUrl || a.tvgId !== b.tvgId) {
      return false;
    }
  }
  return true;
}
