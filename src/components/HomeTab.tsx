import React, { memo, useCallback } from 'react';
import type { AvailableReview, Channel, EPGProgram } from '../types';
import type { HomeGreeting, HomeGreetingAction } from '../services/homeGreeting';
import { ChannelCard } from './ChannelCard';
import { ReviewBanner } from './ReviewBanner';

interface HomeTabProps {
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

const renderHighlightedText = (text: string, channelName?: string, programTitle?: string) => {
  const terms = [
    channelName ? { text: channelName, className: 'home-greeting-channel' } : null,
    programTitle ? { text: programTitle, className: 'home-greeting-program' } : null
  ].filter((term): term is { text: string; className: string } => Boolean(term?.text));
  if (terms.length === 0) return text;

  const result: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = terms
      .map(term => ({ ...term, index: text.indexOf(term.text, cursor) }))
      .filter(term => term.index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (!next) {
      result.push(text.slice(cursor));
      break;
    }
    if (next.index > cursor) result.push(text.slice(cursor, next.index));
    result.push(<span className={next.className} key={`${next.className}-${next.index}`}>{next.text}</span>);
    cursor = next.index + next.text.length;
  }
  return result;
};

const HomeTabComponent: React.FC<HomeTabProps> = ({
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
  const isChannelFavorite = useCallback((channel: Channel) => {
    if (favoriteChannelIds.has(channel.id)) return true;
    return (channel.variants || []).some(variant => favoriteChannelIds.has(variant.id));
  }, [favoriteChannelIds]);

  return (
    <div className="home-page animate-fade">
      <section
        className="home-greeting-hero"
        data-greeting-id={greeting?.id}
        aria-labelledby="home-greeting-title"
        aria-busy={!greeting}
      >
        <div className="home-greeting-glow" aria-hidden="true" />
        <div className="home-greeting-brand" data-greeting-content>
          <img src={`${import.meta.env.BASE_URL}cat_icon.png`} alt="Freaky IPTV" decoding="async" />
          <span>Freaky IPTV</span>
        </div>
        <div
          className="home-greeting-copy"
          key={greeting ? `${greeting.id}:${greeting.headline}:${greeting.detail}` : 'loading'}
          data-greeting-content
        >
          <p className="home-greeting-eyebrow">{greeting?.eyebrow || 'Welcome back'}</p>
          <h2 id="home-greeting-title" data-greeting-content>
            {renderHighlightedText(
              greeting?.headline || 'Getting your lineup ready.',
              greeting?.highlight,
              greeting?.programTitle
            )}
          </h2>
          <p className="home-greeting-detail" data-greeting-content>
            {renderHighlightedText(
              greeting?.detail || 'Your channels will be here in a moment.',
              greeting?.highlight,
              greeting?.programTitle
            )}
          </p>
        </div>
        {greeting && (
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

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="page-eyebrow">Continue watching</p>
            <h3>Recently viewed</h3>
          </div>
          <span className="section-count">{recentChannels.length}</span>
        </div>

        {recentChannels.length > 0 ? (
          <div className="channel-grid channel-grid--recent">
            {recentChannels.map((channel) => {
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
          <div className="empty-state">
            <strong>No recent channels</strong>
            <span>Play a channel from Live TV and it will appear here.</span>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('Live')}>Browse channels</button>
          </div>
        )}
      </section>
    </div>
  );
};

export const HomeTab = memo(HomeTabComponent);
