interface CompactPlaybackStateTextInput {
  isPlaying: boolean;
  bufferingText: string;
}

export const compactPlaybackStateText = ({
  isPlaying,
  bufferingText
}: CompactPlaybackStateTextInput) => {
  const text = bufferingText.trim();
  if (!isPlaying) return text;
  if (text === 'Playing' || text === 'Buffering 0%') return 'Connected';
  return text;
};
