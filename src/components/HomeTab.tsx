import React, { memo, useCallback, useMemo } from 'react';
import type { AvailableReview, Channel, EPGProgram } from '../types';
import type { HomeGreeting, HomeGreetingAction } from '../services/homeGreeting';
import { ChannelCard } from './ChannelCard';
import { ReviewBanner } from './ReviewBanner';
import { useI18n } from '../hooks/useI18n';
import '../navigation.css';

interface HomeTabProps {
  hasPlaylist?: boolean;
  channels?: Channel[];
  greeting: HomeGreeting | null;
  recentChannels: Channel[];
  activeChannel: Channel | null;
  favoriteChannelIds: Set<string>;
  onPlayChannel: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  getChannelEpgInfo: (channel: Channel) => { program: EPGProgram | null; progress: number };
  onNavigate: (section: string) => void;
  onGreetingAction: (action: HomeGreetingAction) => void;
  qualityMappings?: Record<string, string>;
  displayedReview: AvailableReview | null;
  isDisplayedReviewOpened: boolean;
  onOpenReview: (review: AvailableReview) => void;
  onDismissReview: (review: AvailableReview) => void;
}

const HomeTabComponent: React.FC<HomeTabProps> = ({
  hasPlaylist = true,
  channels = [],
  greeting,
  recentChannels,
  activeChannel,
  favoriteChannelIds,
  onPlayChannel,
  onToggleFavorite,
  getChannelEpgInfo,
  onNavigate,
  onGreetingAction,
  qualityMappings,
  displayedReview,
  isDisplayedReviewOpened,
  onOpenReview,
  onDismissReview
}) => {
  const { t, locale } = useI18n();
  const isChannelFavorite = useCallback((channel: Channel) => {
    if (favoriteChannelIds.has(channel.id)) return true;
    return (channel.variants || []).some(variant => favoriteChannelIds.has(variant.id));
  }, [favoriteChannelIds]);

  const favorites = useMemo(() => channels.filter(isChannelFavorite), [channels, isChannelFavorite]);
  const liveNow = useMemo(() => {
    const seen = new Set<string>();
    const result: Channel[] = [];
    for (const candidates of [favorites, recentChannels, channels]) {
      for (const channel of candidates) {
        if (seen.has(channel.id)) continue;
        seen.add(channel.id);
        if (getChannelEpgInfo(channel).program) result.push(channel);
        if (result.length === 6) break;
      }
      if (result.length === 6) break;
    }
    return result;
  }, [channels, favorites, getChannelEpgInfo, recentChannels]);

  const renderChannel = (channel: Channel) => {
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
  };

  return (
    <div className={`home-page ${hasPlaylist ? 'home-page--ready' : 'home-page--first-run'} animate-fade`}>
      <section
        className="home-greeting-hero"
        data-greeting-id={greeting?.id}
        aria-labelledby="home-greeting-title"
        aria-busy={hasPlaylist && !greeting}
      >
        {!hasPlaylist && <div className="home-greeting-brand" data-greeting-content>
          <img src={`${import.meta.env.BASE_URL}cat_icon.png`} alt="Freaky IPTV" decoding="async" />
        </div>}
        <div className="home-greeting-copy" data-greeting-content>
          {hasPlaylist && <span className="home-date">{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
          <h2 id="home-greeting-title">{hasPlaylist ? t('Home') : 'Freaky IPTV'}</h2>
          {hasPlaylist && greeting?.highlight && <p className="home-greeting-summary">{greeting.highlight}</p>}
          {hasPlaylist && greeting?.programTitle && <p className="home-current-program">{greeting.programTitle}</p>}
        </div>
        {!hasPlaylist ? (
          <button type="button" className="btn-primary home-greeting-action" onClick={() => onNavigate('Settings')}>
            {t('Add playlist')} <span aria-hidden="true">→</span>
          </button>
        ) : greeting && (
          <button
            type="button"
            className="btn-secondary home-greeting-action"
            onClick={() => onGreetingAction(greeting.action)}
            data-greeting-content
          >
            {greeting.action.kind === 'play-channel' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 4.5v15L19 12 7 4.5Z" />
              </svg>
            )}
            {greeting.action.label}
            {greeting.action.kind === 'navigate' && <span aria-hidden="true">→</span>}
          </button>
        )}
      </section>

      {displayedReview && (
        <ReviewBanner
          review={displayedReview}
          isOpened={isDisplayedReviewOpened}
          onOpen={onOpenReview}
          onDismiss={onDismissReview}
        />
      )}

      {hasPlaylist && <section className="content-section home-favorites-section">
        <div className="section-heading">
          <div><h3>{t('Favorites')}</h3></div>
          {favorites.length > 0 && <button type="button" className="btn-secondary" onClick={() => onNavigate('Favorites')}>{t('View all favorites')}</button>}
        </div>
        {favorites.length > 0 ? (
          <div className="channel-grid channel-grid--recent">{favorites.slice(0, 6).map(renderChannel)}</div>
        ) : (
          <div className="home-inline-empty"><span>{t('No favorite channels yet.')}</span><button type="button" className="btn-secondary" onClick={() => onNavigate('Live')}>{t('Browse channels')}</button></div>
        )}
      </section>}

      {hasPlaylist && liveNow.length > 0 && <section className="content-section home-now-section">
        <div className="section-heading">
          <div><h3>{t('Live now')}</h3></div>
          <button type="button" className="btn-secondary" onClick={() => onNavigate('Guide')}>{t('Open TV guide')}</button>
        </div>
        <div className="channel-grid channel-grid--recent">{liveNow.map(renderChannel)}</div>
      </section>}

      {hasPlaylist && <section className="content-section">
        <div className="section-heading">
          <div>
            <h3>{t('Recently viewed')}</h3>
          </div>
          <span className="section-count">{recentChannels.length}</span>
        </div>

        {recentChannels.length > 0 ? (
          <div className="channel-grid channel-grid--recent">
            {recentChannels.map(renderChannel)}
          </div>
        ) : (
          <div className="empty-state">
            <strong>{t('No recent channels')}</strong>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('Live')}>{t('Browse channels')}</button>
          </div>
        )}
      </section>}
    </div>
  );
};

export const HomeTab = memo(HomeTabComponent);
