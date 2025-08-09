import axios from 'axios';
import * as cheerio from 'cheerio';
import { fetchHtmlWithRotation } from './http.js';
import pino from 'pino';

const log = pino({ level: 'info' });

type Product = {
  url: string;
  title: string;
  sku?: string;
  upc?: string;
  model?: string;
  price?: number | null;
  shipEstimate?: number | null;
  image?: string;
  retailer?: string;
};

export async function parseProductFromUrl(url: string): Promise<Product | null> {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  log.info({ url, domain }, 'Parsing product from URL');
  
  if (domain.includes('walmart.com')) {
    log.info({ url }, 'Detected Walmart URL');
    return parseWalmart(url);
  }
  if (domain.includes('bestbuy.com')) {
    log.info({ url }, 'Detected Best Buy URL');
    return parseBestBuy(url);
  }
  if (domain.includes('target.com')) {
    log.info({ url }, 'Detected Target URL');
    return parseTarget(url);
  }
  if (domain.includes('amazon.com')) {
    log.info({ url }, 'Detected Amazon URL');
    return parseAmazon(url);
  }
  
  log.warn({ url, domain }, 'Unsupported retailer');
  return null;
}

function parseLdJson($: cheerio.CheerioAPI) {
  const out: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { const json = JSON.parse($(el).text()); out.push(json); } catch {}
  });
  return out;
}

// --- New helper that prefers proxies if enabled ---
async function getHtml(url: string): Promise<string | null> {
  const res = await fetchHtmlWithRotation(url, {}, {
    maxRetries: 1, // Only 1 retry for speed
    timeoutMs: 3000, // 3 second timeout
    useProxies: false, // No proxies for speed
    validateStatus: (c) => c >= 200 && c < 300,
  });
  
  return res?.data || null;
}

async function parseGeneric(url: string): Promise<Product | null> {
  const html = await getHtml(url);
  if (!html) return { url, title: 'Product', price: null, retailer: new URL(url).hostname };

  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text().trim();
  const image = $('meta[property="og:image"]').attr('content') || undefined;
  const ld = parseLdJson($).find(j => j['@type'] === 'Product');

  const price = Number(ld?.offers?.price) || null;
  const sku = ld?.sku || undefined;
  const upc = ld?.gtin13 || ld?.gtin12 || undefined;
  const model = ld?.mpn || undefined;

  return { url, title, price, sku, upc, model, image, retailer: new URL(url).hostname };
}

async function parseWalmart(url: string): Promise<Product | null> {
  const html = await getHtml(url);
  if (!html) return { url, title: 'Walmart Product', price: null, retailer: 'walmart.com' };

  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text().trim();
  const scripts = $('script').map((_, el) => $(el).html() || '').get();

  let price: number | null = null, sku: string | undefined, upc: string | undefined, model: string | undefined, image: string | undefined;

  for (const s of scripts) {
    if (!s) continue;
    if (s.includes('__NEXT_DATA__') || s.includes('productInfo') || s.includes('product":{"itemId"')) {
      try {
        const json = JSON.parse(s.replace(/^[\s\S]*?\{/, '{'));
        const prod = json?.props?.pageProps?.initialData?.data?.product || json?.productInfo || json?.product;
        if (prod) {
          price = Number(prod?.priceInfo?.currentPrice?.price) || price;
          sku = prod?.usItemId || prod?.itemId || sku;
          upc = prod?.upc || upc;
          model = prod?.model || model;
          image = prod?.imageInfo?.allImages?.[0]?.url || image;
        }
      } catch {}
    }
  }
  return { url, title, price, sku, upc, model, image, retailer: 'walmart.com' };
}

async function parseBestBuy(url: string): Promise<Product | null> {
  log.info({ url }, 'Parsing Best Buy product');
  const html = await getHtml(url);

  if (!html) {
    log.warn({ url }, 'Failed to fetch HTML for Best Buy product');
    const slugMatch = url.match(/bestbuy\.com\/site\/([^/]+)\//i);
    const skuMatch = url.match(/(\d+)\.p/i) || url.match(/[?&]skuId=(\d+)/i);
    const titleFromSlug = slugMatch ? decodeURIComponent(slugMatch[1]).replace(/[-+]/g, ' ') : 'Best Buy Product';
    const sku = skuMatch ? skuMatch[1] : undefined;
    return { url, title: titleFromSlug, sku, price: null, retailer: 'bestbuy.com' };
  }

  const $ = cheerio.load(html);
  const title = $('h1.heading-5').text().trim() || $('h1').first().text().trim();
  const priceText = $('.priceView-customer-price span').first().text().trim();
  const sku = $('[data-sku-id]').attr('data-sku-id') || url.match(/(\d+)\.p/i)?.[1];
  const model = $('.product-data-value[data-testid="product-data-model"]').text().trim();
  const image = $('.shop-media-gallery img').first().attr('src');

  const price = priceText ? parseFloat(priceText.replace(/[^\d.]/g, '')) : null;

  const result = { url, title: title || 'Best Buy Product', price, sku, model, image, retailer: 'bestbuy.com' };
  log.info({ 
    url, 
    title: result.title, 
    price: result.price, 
    sku: result.sku,
    model: result.model 
  }, 'Best Buy product parsed successfully');
  return result;
}

async function parseTarget(url: string): Promise<Product | null> {
  // Placeholder for Target parsing
  return { url, title: 'Target Product', price: null, retailer: 'target.com' };
}

async function parseAmazon(url: string): Promise<Product | null> {
  // Placeholder for Amazon parsing
  return { url, title: 'Amazon Product', price: null, retailer: 'amazon.com' };
}
