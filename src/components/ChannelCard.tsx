import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, EPGProgram } from '../types';
import { getChannelQualityLabel } from '../services/utils';

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

const getInitials = (name: string) => {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
};

const formatTime = (isoString: string) => {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

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
  const [logoFailed, setLogoFailed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const channelInitials = useMemo(() => getInitials(channel.name), [channel.name]);

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
    <article
      className="glass-card channel-card"
      aria-current={isActive ? 'true' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-card)',
        padding: '12px',
        position: 'relative',
        cursor: 'pointer',
        overflow: 'visible',
        height: '190px',
        border: isActive 
          ? '1px solid rgba(31, 122, 255, 0.72)'
          : (isHovered ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(255, 255, 255, 0.08)'),
        boxShadow: isActive 
          ? 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 16px 38px rgba(31, 122, 255, 0.2)'
          : (isHovered ? 'inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 14px 34px rgba(0, 0, 0, 0.28)' : 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 10px 28px rgba(0, 0, 0, 0.18)'),
        background: isActive 
          ? 'linear-gradient(180deg, rgba(31, 122, 255, 0.18), rgba(255, 255, 255, 0.026)), rgba(21, 24, 39, 0.72)'
          : (isHovered ? 'var(--surface-card-hover)' : 'var(--surface-card)'),
        transform: isHovered ? 'translateY(-2px)' : 'none',
        transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        aria-label={`Play ${channel.name}`}
        onClick={() => onPlay(channel)}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          border: 'none',
          borderRadius: 'var(--radius-card)',
          background: 'transparent',
          cursor: 'pointer'
        }}
      />

      {/* 3-dot Quality Menu (Only if variants exist) */}
      {channel.variants && channel.variants.length > 1 && (
        <>
          <button
            ref={qualityButtonRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isDropdownOpen) {
                closeQualityMenu(false);
              } else {
                setIsDropdownOpen(true);
              }
            }}
            title="Choose transmission quality"
            aria-label={`Choose transmission quality for ${channel.name}`}
            aria-expanded={isDropdownOpen}
            aria-haspopup="menu"
            aria-controls={`quality-menu-${channel.id}`}
            style={{
              position: 'absolute',
              top: '8px',
              right: '42px',
              zIndex: 99,
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: isDropdownOpen ? 'rgba(25, 25, 30, 0.9)' : 'rgba(15, 15, 20, 0.65)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              border: isDropdownOpen ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
              color: isDropdownOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              outline: 'none',
              transition: 'var(--transition-fast)'
            }}
            onMouseEnter={(e) => {
              if (!isDropdownOpen) {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.background = 'rgba(25, 25, 30, 0.85)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isDropdownOpen) {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.background = 'rgba(15, 15, 20, 0.65)';
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="6" cy="12" r="1.5" />
              <circle cx="18" cy="12" r="1.5" />
            </svg>
          </button>

          {/* Liquid Glass Dropdown Menu */}
          {isDropdownOpen && (
            <div
              ref={qualityMenuRef}
              id={`quality-menu-${channel.id}`}
              role="menu"
              aria-label={`Transmission quality for ${channel.name}`}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  closeQualityMenu(false);
                }
              }}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowDown'
                      ? (currentIndex + 1) % items.length
                      : (currentIndex - 1 + items.length) % items.length;
                items[nextIndex]?.focus();
              }}
              style={{
                position: 'absolute',
                top: '40px',
                right: '42px',
                zIndex: 100,
                background: 'rgba(20, 24, 35, 0.85)',
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                borderRadius: '10px',
                padding: '4px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                width: '120px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                cursor: 'default'
              }}
            >
              <div style={{ padding: '4px 8px', fontSize: '9.5px', color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px' }}>
                SELECT QUALITY
              </div>
              {channel.variants.map((v) => {
                const isSelected = v.id === activeChannelId;
                const q = getChannelQualityLabel(v.name, qualityMappings);
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    key={v.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeQualityMenu();
                      onPlay(v);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: '11.5px',
                      fontWeight: isSelected ? 600 : 500,
                      borderRadius: '6px',
                      background: 'transparent',
                      color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      textAlign: 'left',
                      border: 'none',
                      outline: 'none',
                      cursor: 'pointer',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.color = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)';
                    }}
                  >
                    <span>{q}</span>
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Favorite Button Overlay (macOS Gold Accent #FFD60A) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(channel);
        }}
        aria-label={`${isFavorite ? 'Remove' : 'Add'} ${channel.name} ${isFavorite ? 'from' : 'to'} favorites`}
        aria-pressed={isFavorite}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          zIndex: 5,
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: 'rgba(15, 15, 20, 0.65)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: isFavorite ? '#FFD60A' : 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          outline: 'none',
          transition: 'var(--transition-fast)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#FFD60A';
          e.currentTarget.style.background = 'rgba(25, 25, 30, 0.85)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = isFavorite ? '#FFD60A' : 'var(--text-tertiary)';
          e.currentTarget.style.background = 'rgba(15, 15, 20, 0.65)';
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill={isFavorite ? '#FFD60A' : 'none'} stroke="currentColor" strokeWidth="2.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>

      {/* Logo Area */}
      <div 
        style={{
          height: '76px',
          minHeight: '76px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          borderRadius: '8px',
          background: 'rgba(255, 255, 255, 0.02)',
          overflow: 'hidden',
          marginBottom: '8px'
        }}
      >
        {channel.logoUrl && !logoFailed ? (
          <img 
            src={channel.logoUrl} 
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setLogoFailed(true)}
            style={{
              maxHeight: '56px',
              maxWidth: '85%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
            }}
          />
        ) : (
          <div 
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)), rgba(12, 15, 28, 0.52)',
              color: 'var(--accent-primary)',
              fontSize: '20px',
              fontWeight: 800,
              letterSpacing: '1px',
              fontFamily: 'inherit'
            }}
          >
            {channelInitials}
          </div>
        )}

        {/* Hover Play Icon Overlay */}
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(5, 5, 6, 0.55)',
            opacity: isHovered ? 1 : 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'var(--transition-fast)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)'
          }}
        >
          <div 
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(10, 132, 255, 0.4)',
              transform: isHovered ? 'scale(1)' : 'scale(0.85)',
              transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          </div>
        </div>
      </div>

      {/* Info Area */}
      <div 
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'space-between',
          overflow: 'hidden'
        }}
      >
        <div>
          {/* Channel Name */}
          <h3 
            style={{
              fontSize: '13px',
              fontWeight: 600,
              lineHeight: '1.2',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
              marginBottom: '3px',
              fontFamily: 'inherit'
            }}
            title={channel.name}
          >
            {channel.name}
          </h3>
          
          {/* Group Category */}
          <div 
            title={channel.groupTitle}
            style={{
              fontSize: '10.5px',
              color: 'var(--text-tertiary)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: 'inherit'
            }}
          >
            {channel.groupTitle}
          </div>
        </div>

        {/* EPG Program Area */}
        <div style={{ marginTop: 'auto' }}>
          {currentProgram ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div 
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: 'var(--text-secondary)',
                  fontFamily: 'inherit'
                }}
                title={currentProgram.title}
              >
                {currentProgram.title}
              </div>
              
              {/* Progress Bar Container */}
              <div 
                style={{
                  height: '3px',
                  background: 'var(--progress-track)',
                  borderRadius: '1.5px',
                  width: '100%',
                  overflow: 'hidden',
                  margin: '1px 0'
                }}
              >
                <div 
                  style={{
                    height: '100%',
                    width: `${currentProgress}%`,
                    background: 'var(--accent-primary)',
                    borderRadius: '1.5px',
                    transition: 'width 0.5s ease-out'
                  }}
                />
              </div>

              {/* Program Timing */}
              <div 
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '9.5px',
                  color: 'var(--text-tertiary)',
                  fontWeight: 500,
                  fontFamily: 'inherit'
                }}
              >
                <span>{formatTime(currentProgram.startUtc)}</span>
                <span>{formatTime(currentProgram.stopUtc)}</span>
              </div>
            </div>
          ) : (
            <div 
              style={{
                fontSize: '10.5px',
                color: 'var(--text-tertiary)',
                fontStyle: 'italic',
                paddingTop: '4px',
                fontFamily: 'inherit'
              }}
            >
              No guide programme
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

export const ChannelCard = memo(ChannelCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.isFavorite === nextProps.isFavorite &&
    prevProps.activeChannelId === nextProps.activeChannelId &&
    Math.round(prevProps.currentProgress) === Math.round(nextProps.currentProgress) &&
    prevProps.currentProgram === nextProps.currentProgram &&
    prevProps.channel.id === nextProps.channel.id &&
    prevProps.channel.name === nextProps.channel.name &&
    prevProps.channel.logoUrl === nextProps.channel.logoUrl &&
    prevProps.channel.groupTitle === nextProps.channel.groupTitle &&
    prevProps.channel.variants?.length === nextProps.channel.variants?.length &&
    prevProps.qualityMappings === nextProps.qualityMappings
  );
});
