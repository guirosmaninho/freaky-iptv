function historyValue(item, camelCaseKey, pascalCaseKey, fallback) {
  const camelCaseValue = item[camelCaseKey];
  const pascalCaseValue = item[pascalCaseKey];

  if (typeof camelCaseValue === 'string' && camelCaseValue.length > 0) return camelCaseValue;
  if (typeof pascalCaseValue === 'string' && pascalCaseValue.length > 0) return pascalCaseValue;
  if (typeof camelCaseValue === 'string') return camelCaseValue;
  if (typeof pascalCaseValue === 'string') return pascalCaseValue;
  return fallback;
}

function historyNumber(item, camelCaseKey, pascalCaseKey) {
  for (const value of [item[camelCaseKey], item[pascalCaseKey]]) {
    if (value === '' || value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function normalizeHistoryItem(item) {
  return {
    sessionId: historyValue(item, 'sessionId', 'SessionId', ''),
    channelId: historyValue(item, 'channelId', 'ChannelId', ''),
    canonicalChannelId: historyValue(item, 'canonicalChannelId', 'CanonicalChannelId', ''),
    channelName: historyValue(item, 'channelName', 'ChannelName', ''),
    baseChannelName: historyValue(item, 'baseChannelName', 'BaseChannelName', ''),
    channelGroup: historyValue(item, 'channelGroup', 'ChannelGroup', ''),
    selectedAtUtc: historyValue(item, 'selectedAtUtc', 'SelectedAtUtc', ''),
    playbackStartedAtUtc: historyValue(item, 'playbackStartedAtUtc', 'PlaybackStartedAtUtc', ''),
    startTimeUtc: historyValue(item, 'startTimeUtc', 'StartTimeUtc', ''),
    endTimeUtc: historyValue(item, 'endTimeUtc', 'EndTimeUtc', ''),
    bytesConsumed: historyNumber(item, 'bytesConsumed', 'BytesConsumed'),
    bytesSource: historyValue(item, 'bytesSource', 'BytesSource', ''),
    playingDurationMs: historyNumber(item, 'playingDurationMs', 'PlayingDurationMs'),
    bufferingDurationMs: historyNumber(item, 'bufferingDurationMs', 'BufferingDurationMs'),
    startupLatencyMs: historyNumber(item, 'startupLatencyMs', 'StartupLatencyMs'),
    stallCount: historyNumber(item, 'stallCount', 'StallCount'),
    stallDurationMs: historyNumber(item, 'stallDurationMs', 'StallDurationMs'),
    failureReason: historyValue(item, 'failureReason', 'FailureReason', ''),
    streamMode: historyValue(item, 'streamMode', 'StreamMode', ''),
    qualityLabel: historyValue(item, 'qualityLabel', 'QualityLabel', '')
  };
}

function normalizeHistoryList(list) {
  const cleaned = [];
  let dirty = false;

  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dirty = true;
      continue;
    }

    const normalizedItem = normalizeHistoryItem(item);
    if (!normalizedItem.channelId
      || !normalizedItem.startTimeUtc
      || normalizedItem.startTimeUtc.startsWith('0001-01-01')) {
      dirty = true;
      continue;
    }

    const originalKeys = Object.keys(item);
    const isOriginalCamelCase = originalKeys.includes('channelId') && originalKeys.includes('startTimeUtc');
    const hasLegacyKeys = originalKeys.some(key => /^[A-Z]/.test(key));
    if (!isOriginalCamelCase || hasLegacyKeys) dirty = true;

    cleaned.push(normalizedItem);
  }

  return { cleaned, dirty };
}

module.exports = { normalizeHistoryItem, normalizeHistoryList };
