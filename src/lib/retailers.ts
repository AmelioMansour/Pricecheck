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

async function fetchHtml(url: string) {
  const { data } = await axios.get(url, {
    headers: { 'user-agent': UA }
  });
  return data as string;
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
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text().trim();
  const image = $('meta[property="og:image"]').attr('content') || undefined;
  let sku: string | undefined, model: string | undefined, price: number | null = null;

  const ld = parseLdJson($).find(j => j['@type'] === 'Product');
  if (ld) {
    price = Number(ld?.offers?.price) || null;
    sku = ld?.sku || sku;
    model = ld?.mpn || model;
  }

  const skuText = $('div:contains("SKU:")').first().text();
  const m = skuText.match(/SKU:\s*(\d+)/i);
  if (m) sku = m[1];

  return { url, title, price, sku, model, image, retailer: 'bestbuy.com' };
}
