import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyManager, proxyToUrl } from './proxymanager.js';
import pino from 'pino';

const log = pino({ level: 'info' });

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

/** Initialize proxy manager */
export function initProxyManager() {
  if (process.env.PROXY_LIST) {
    pm = new ProxyManager(process.env.PROXY_LIST.split(',').map(s => s.trim()));
  }
}

/** Fetch HTML with rotation and retries - OPTIMIZED FOR SPEED */
export async function fetchHtmlWithRotation(
  url: string,
  opts: AxiosRequestConfig = {},
  config: {
    maxRetries?: number;
    timeoutMs?: number;
    useProxies?: boolean;
    validateStatus?: (status: number) => boolean;
  } = {}
): Promise<AxiosResponse | null> {
  const {
    maxRetries = 2, // Reduced from 4
    timeoutMs = 5000, // Reduced from 12000
    useProxies = false, // Disabled by default for speed
    validateStatus = (c) => c >= 200 && c < 300,
  } = config;

  log.info({ url, maxRetries, timeoutMs, useProxies }, 'Starting HTTP request');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const proxy = useProxies && pm ? pm.getProxy() : null;
      const proxyUrl = proxy ? proxyToUrl(proxy) : null;
      
      log.info({ attempt, maxRetries, usingProxy: !!proxy }, 'Making HTTP request attempt');

      const config: AxiosRequestConfig = {
        timeout: timeoutMs,
        headers: {
          'User-Agent': ua(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        validateStatus,
        ...opts,
      };

      if (proxyUrl) {
        config.httpsAgent = new HttpsProxyAgent(proxyUrl);
        config.proxy = false;
      }

      const startTime = Date.now();
      const response = await axios.get(url, config);
      const duration = Date.now() - startTime;

      log.info({ 
        url, 
        status: response.status, 
        contentLength: response.data?.length || 0,
        duration,
        attempt 
      }, 'HTTP request completed');

      return response;

    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      const errorMsg = error.code || error.message || 'Unknown error';
      
      log.error({ 
        url, 
        error: errorMsg, 
        attempt, 
        isLastAttempt 
      }, 'HTTP request failed with error');

      if (isLastAttempt) {
        log.error({ url, lastError: errorMsg }, 'All HTTP request attempts failed');
        return null;
      }

      // Shorter delays for speed
      const delay = Math.min(1000 * attempt, 2000); // Max 2 second delay
      log.info({ delay, attempt }, 'Waiting before retry');
      await sleep(delay);
    }
  }

  return null;
}
