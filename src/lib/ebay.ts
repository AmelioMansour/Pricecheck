import * as cheerio from 'cheerio';
import { fetchHtmlWithRotation } from './http.js';

export type Comps = { median: number; low: number; high: number; count30d: number };

function normalizeQuery(p: { title: string; upc?: string; model?: string; sku?: string; }) {
  const parts = [p.title, p.model, p.upc].filter(Boolean) as string[];
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function fetchEbaySoldComps(prod: { title: string; upc?: string; model?: string; sku?: string; }): Promise<Comps | null> {
  const q = normalizeQuery(prod);
  if (!q) return null;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;

  const res = await fetchHtmlWithRotation(url, {}, {
    maxRetries: 4,
    timeoutMs: 12_000,
    validateStatus: (c) => c >= 200 && c < 300,
  }).catch(() => null);

  if (!res?.data) return null;

  const $ = cheerio.load(res.data);
  const prices: number[] = [];

  $('li.s-item').each((_, el) => {
    const priceText = $(el).find('.s-item__price').first().text();
    const p = parseFloat(priceText.replace(/[^\d.]/g, ''));
    if (!isFinite(p)) return;
    prices.push(p);
  });

  if (!prices.length) return null;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return { median, low: prices[0], high: prices[prices.length - 1], count30d: Math.min(prices.length, 30) };
}
