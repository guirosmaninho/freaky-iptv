export type ProxyStartResult = {
  ok: boolean;
  url?: string;
  errorCode?: string;
  error?: string;
};

export function normalizeProxyStartResult(value: unknown): ProxyStartResult {
  if (typeof value === 'string') {
    try {
      const parsed = new URL(value);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
        return { ok: true, url: value };
      }
    } catch {
      // Fall through to the safe failure below.
    }
    return { ok: false, errorCode: 'proxy', error: 'The compatibility video engine returned an invalid address.' };
  }

  if (value && typeof value === 'object') {
    const result = value as ProxyStartResult;
    if (result.ok && typeof result.url === 'string') return { ok: true, url: result.url };
    if (!result.ok) return {
      ok: false,
      errorCode: typeof result.errorCode === 'string' ? result.errorCode : undefined,
      error: typeof result.error === 'string' ? result.error : undefined
    };
  }

  return { ok: false, errorCode: 'proxy', error: 'The compatibility video engine did not return a stream.' };
}
