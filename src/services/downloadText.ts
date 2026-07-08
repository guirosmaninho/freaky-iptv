type ElectronDownloadWindow = Window & {
  electron?: {
    downloadText?: (url: string) => Promise<string>;
  };
};

export async function downloadText(url: string, failureLabel: string): Promise<string> {
  const electronApi = typeof window !== 'undefined'
    ? (window as ElectronDownloadWindow).electron
    : undefined;

  if (electronApi?.downloadText) {
    return electronApi.downloadText(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${failureLabel}. HTTP status: ${response.status}`);
  }

  return response.text();
}
