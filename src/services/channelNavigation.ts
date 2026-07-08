export const getRelativeChannelIndex = (currentIndex: number, offset: number, channelCount: number) => {
  if (channelCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= channelCount) return 0;
  return (currentIndex + offset + channelCount) % channelCount;
};

export const nextVolume = (volume: number, direction: -1 | 1) => {
  return Math.max(0, Math.min(100, volume + direction * 5));
};

type ShortcutTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  role?: string | null;
  getAttribute?: (name: string) => string | null;
};

export const isEditableShortcutTarget = (target: ShortcutTarget | null) => {
  if (!target) return false;
  const tagName = target.tagName?.toUpperCase();
  const role = target.role || target.getAttribute?.('role');
  return Boolean(
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'SELECT' ||
    tagName === 'TEXTAREA' ||
    role === 'slider' ||
    role === 'textbox'
  );
};
