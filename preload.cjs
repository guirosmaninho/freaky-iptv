const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  patchSettings: (patch) => ipcRenderer.invoke('patch-settings', patch),
  loadCache: () => ipcRenderer.invoke('load-cache'),
  saveCache: (snapshot) => ipcRenderer.invoke('save-cache', snapshot),
  loadHistory: () => ipcRenderer.invoke('load-history'),
  saveHistory: (sessions) => ipcRenderer.invoke('save-history', sessions),
  appendHistory: (session) => ipcRenderer.invoke('append-history', session),
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  loadReminders: () => ipcRenderer.invoke('load-reminders'),
  saveReminders: (reminders) => ipcRenderer.invoke('save-reminders', reminders),
  onReminderNotification: (callback) => {
    const listener = (_event, reminder) => callback(reminder);
    ipcRenderer.on('reminder-notification', listener);
    return () => ipcRenderer.removeListener('reminder-notification', listener);
  },
  selectRecordingDirectory: () => ipcRenderer.invoke('select-recording-directory'),
  openRecordingDirectory: () => ipcRenderer.invoke('open-recording-directory'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openReleasePage: () => ipcRenderer.invoke('open-release-page'),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app-update-status', listener);
    return () => ipcRenderer.removeListener('app-update-status', listener);
  },
  getDataDirectory: () => ipcRenderer.invoke('get-data-directory'),
  openDataDirectory: () => ipcRenderer.invoke('open-data-directory'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  exportBackup: (password) => ipcRenderer.invoke('export-backup', password),
  importBackup: (password) => ipcRenderer.invoke('import-backup', password),
  capturePlaybackFrame: (request) => ipcRenderer.invoke('capture-playback-frame', request),
  copyStatisticsCard: (request) => ipcRenderer.invoke('copy-statistics-card', request),
  saveStatisticsCard: (request) => ipcRenderer.invoke('save-statistics-card', request),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),
  startSourceRecording: (request) => ipcRenderer.invoke('start-source-recording', request),
  stopSourceRecording: () => ipcRenderer.invoke('stop-source-recording'),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
  listRecordings: () => ipcRenderer.invoke('list-recordings'),
  getRecordingPlaybackUrl: (id) => ipcRenderer.invoke('get-recording-playback-url', id),
  startRecordingPlayback: (id) => ipcRenderer.invoke('start-recording-playback', id),
  renameRecording: (request) => ipcRenderer.invoke('rename-recording', request),
  deleteRecording: (id) => ipcRenderer.invoke('delete-recording', id),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
  onRecordingStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('recording-state-changed', listener);
    return () => ipcRenderer.removeListener('recording-state-changed', listener);
  },
  downloadText: (url) => ipcRenderer.invoke('download-url-text', url),
  startVlcProxy: (url, options) => ipcRenderer.invoke('start-vlc-proxy', url, options),
  stopVlcProxy: () => ipcRenderer.invoke('stop-vlc-proxy'),
  getProxyTraffic: () => ipcRenderer.invoke('get-proxy-traffic'),
  startPlaybackRelay: (url) => ipcRenderer.invoke('start-playback-relay', url),
  stopPlaybackRelay: (relayId) => ipcRenderer.invoke('stop-playback-relay', relayId),
  getPlaybackRelayTraffic: (relayId) => ipcRenderer.invoke('get-playback-relay-traffic', relayId),
  setPlaybackActive: (active) => ipcRenderer.invoke('set-playback-active', active),
  setWindowFullscreen: (active) => ipcRenderer.invoke('set-window-fullscreen', active),
  focusAppWindow: () => ipcRenderer.invoke('focus-app-window'),
  onWindowFullscreenChange: (callback) => {
    const listener = (_event, active) => callback(active);
    ipcRenderer.on('window-fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window-fullscreen-changed', listener);
  },
  setDiscordActivity: (channelName, startTimeIso, logoUrl, programTitle) => ipcRenderer.invoke('set-discord-activity', channelName, startTimeIso, logoUrl, programTitle),
  clearDiscordActivity: () => ipcRenderer.invoke('clear-discord-activity'),
  onAppBeforeClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app-before-close', listener);
    return () => ipcRenderer.removeListener('app-before-close', listener);
  },
  confirmAppClose: () => ipcRenderer.send('app-close-ready'),
});
