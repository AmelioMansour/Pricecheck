import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyManager, proxyToUrl } from './proxymanager.js';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function ua() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

let pm: ProxyManager | undefined;

/** Initialize global proxy manager lazily to avoid startup cost if unused. */
function ensurePM(): ProxyManager | undefined {
  if (process.env.USE_PROXIES !== '1') return undefined;
  if (!pm) {
    const file = process.env.PROXY_FILE || 'proxies.txt';
    pm = new ProxyManager(file);
  }
  return pm;
}

export type FetchOpts = {
  maxRetries?: number;        // default 4 (=> 5 attempts)
  timeoutMs?: number;         // default 12s
  validateStatus?: (code: number) => boolean; // default 2xx
  headers?: Record<string, string>;
};

export async function fetchHtmlWithRotation(
  url: string,
  axiosConfig: AxiosRequestConfig = {},
  opts: FetchOpts = {}
): Promise<AxiosResponse<string>> {
  const manager = ensurePM();

  const maxRetries = opts.maxRetries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const validate = opts.validateStatus ?? ((c: number) => c >= 200 && c < 300);

  let lastErr: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const state = manager?.nextHealthy() || null;
    const agent = state ? new HttpsProxyAgent(proxyToUrl(state.proxy)) : undefined;

    try {
      const res = await axios.request<string>({
        url,
        method: 'GET',
        timeout: timeoutMs,
        maxRedirects: 5,
        decompress: true,
        headers: {
          'user-agent': ua(),
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          ...opts.headers,
          ...axiosConfig.headers,
        },
        ...axiosConfig,
        httpAgent: (axiosConfig as any).httpAgent ?? agent,
        httpsAgent: (axiosConfig as any).httpsAgent ?? agent,
        validateStatus: () => true, // manual check below
      });

      if (validate(res.status)) {
        state && manager?.markSuccess(state);
        return res;
      }

      // Treat 403/412/429 as hard-ish failures to rotate/quarantine
      if (state && [403, 412, 429, 503, 520, 521].includes(res.status)) {
        manager?.markFailure(state, attempt);
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      if (state) manager?.markFailure(state, attempt);
      lastErr = e;
    }

    // backoff with jitter
    const delay = Math.min(2000 * 2 ** attempt, 12_000) + Math.floor(Math.random() * 400);
    await sleep(delay);
  }

  throw lastErr ?? new Error('fetchHtmlWithRotation failed');
}
