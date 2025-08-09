import axios from 'axios';
import * as cheerio from 'cheerio';

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

const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'upgrade-insecure-requests': '1'
};

async function fetchHtml(url: string, retries = 2): Promise<string | null> {
  try {
    const { data, status } = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      timeout: 10000,
      validateStatus: () => true,   // we'll handle non-2xx ourselves
      decompress: true,
      maxRedirects: 5,
    });
    if (status >= 200 && status < 300) return String(data);
    if (status === 403 || status === 412) return null; // soft-blocks
    if (status >= 500 && retries > 0) {
      await new Promise(r => setTimeout(r, 400));
      return fetchHtml(url, retries - 1);
    }
    return null;
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 400));
      return fetchHtml(url, retries - 1);
    }
    return null;
  }
}


const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseLdJson($: cheerio.CheerioAPI) {
  const out: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { const json = JSON.parse($(el).text()); out.push(json); } catch {}
  });
  return out;
}

async function parseGeneric(url: string): Promise<Product | null> {
  const html = await fetchHtml(url);
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
  const html = await fetchHtml(url);
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
  const html = await fetchHtml(url);
  // If blocked or socket hangup => build minimal product from URL so we can still comp
  if (!html) {
    const slugMatch = url.match(/bestbuy\\.com\\/site\\/([^/]+)\\//i);
    const skuMatch = url.match(/(\\d+)\\.p/i) || url.match(/[?&]skuId=(\\d+)/i);
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

  // LD+JSON
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

  // Visible fallback
  if (!sku) {
    const skuText = $('div:contains("SKU:")').first().text();
    const m = skuText.match(/SKU:\\s*(\\d+)/i);
    if (m) sku = m[1];
  }

  return { url, title: title || 'Best Buy Product', price, sku, model, image, retailer: 'bestbuy.com' };
}

