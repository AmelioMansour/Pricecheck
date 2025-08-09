import * as cheerio from 'cheerio';
import { fetchHtmlWithRotation } from './http.js';
import pino from 'pino';

const log = pino({ level: 'info' });

export type Comps = { median: number; low: number; high: number; count30d: number };

function normalizeQuery(p: { title: string; upc?: string; model?: string; sku?: string; }) {
  // For MacBook Air, use a much simpler search for speed
  if (p.title.toLowerCase().includes('macbook air')) {
    // Just search for "MacBook Air M2" - much faster and more likely to find actual laptops
    return 'MacBook Air M2';
  }
  
  // For other products, use the original logic
  const parts = [p.title, p.model, p.upc].filter(Boolean) as string[];
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function fetchEbaySoldComps(prod: { title: string; upc?: string; model?: string; sku?: string; }): Promise<Comps | null> {
  const q = normalizeQuery(prod);
  if (!q) return null;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;

  log.info({ query: q, url }, 'Fetching eBay sold comps');

  const res = await fetchHtmlWithRotation(url, {}, {
    maxRetries: 1, // Only 1 retry for speed
    timeoutMs: 3000, // 3 second timeout
    useProxies: false, // No proxies for speed
    validateStatus: (c) => c >= 200 && c < 300,
  }).catch(() => null);

  if (!res?.data) {
    log.warn({ query: q }, 'Failed to fetch eBay HTML');
    return null;
  }

  const $ = cheerio.load(res.data);
  const prices: number[] = [];

  // Use the most common selector first for speed
  $('.s-item__price').each((_, el) => {
    const priceText = $(el).text().trim();
    
    // Extract price - handle different formats like "$699.99", "US $699.99", "699.99"
    const priceMatch = priceText.match(/[\$]?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (priceMatch) {
      const p = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (isFinite(p) && p > 0) {
        // Filter out obviously wrong prices for MacBook Air
        if (prod.title.toLowerCase().includes('macbook air')) {
          if (p < 200) return; // Filter out accessories/parts
          if (p > 3000) return; // Filter out bundles/multiple items
        }
        
        prices.push(p);
      }
    }
  });

  if (!prices.length) {
    log.warn({ query: q }, 'No prices found');
    return null;
  }

  // Take only first 10 prices for speed
  const limitedPrices = prices.slice(0, 10);
  limitedPrices.sort((a, b) => a - b);
  
  const mid = Math.floor(limitedPrices.length / 2);
  const median = limitedPrices.length % 2 ? limitedPrices[mid] : (limitedPrices[mid - 1] + limitedPrices[mid]) / 2;
  
  const result = { 
    median, 
    low: limitedPrices[0], 
    high: limitedPrices[limitedPrices.length - 1], 
    count30d: Math.min(limitedPrices.length, 30) 
  };
  
  log.info({ 
    query: q, 
    totalPrices: limitedPrices.length, 
    median, 
    low: limitedPrices[0], 
    high: limitedPrices[limitedPrices.length - 1],
    samplePrices: limitedPrices.slice(0, 5)
  }, 'eBay comps calculated');
  
  return result;
}
