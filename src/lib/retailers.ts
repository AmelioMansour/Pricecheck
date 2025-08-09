import axios from 'axios';
import * as cheerio from 'cheerio';
import { fetchHtmlWithRotation } from './http.js';

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
  if (domain.includes('walmart.com')) return parseWalmart(url);
  if (domain.includes('bestbuy.com')) return parseBestBuy(url);
  return parseGeneric(url);
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
  try {
    const res = await fetchHtmlWithRotation(url, {}, {
      maxRetries: 4,
      timeoutMs: 12_000,
      validateStatus: (c) => c >= 200 && c < 300,
    });
    return res.data;
  } catch {
    return null;
  }
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
  const html = await getHtml(url);

  if (!html) {
    const slugMatch = url.match(/bestbuy\.com\/site\/([^/]+)\//i);
    const skuMatch = url.match(/(\d+)\.p/i) || url.match(/[?&]skuId=(\d+)/i);
    const titleFromSlug = slugMatch ? decodeURIComponent(slugMatch[1]).replace(/[-+]/g, ' ') : 'Best Buy Product';
    const sku = skuMatch ? skuMatch[1] : undefined;
    return { url, title: titleFromSlug, sku, price: null, retailer: 'bestbuy.com' };
  }

  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('title').first().text().trim();

  const image = $('meta[property="og:image"]').attr('content') || undefined;

  let price: number | null = null;
  let sku: string | undefined;
  let model: string | undefined;

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      if (json['@type'] === 'Product') {
        price = Number(json?.offers?.price) || price;
        sku = json?.sku || sku;
        model = json?.mpn || model;
      }
    } catch {}
  });

  if (!sku) {
    const skuText = $('div:contains("SKU:")').first().text();
    const m = skuText.match(/SKU:\s*(\d+)/i);
    if (m) sku = m[1];
  }

  return { url, title: title || 'Best Buy Product', price, sku, model, image, retailer: 'bestbuy.com' };
}
