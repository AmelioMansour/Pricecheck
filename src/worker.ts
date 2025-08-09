import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { Client, GatewayIntentBits } from 'discord.js';
import { parseProductFromUrl } from './lib/retailers.js';
import { fetchEbaySoldComps } from './lib/ebay.js';
import { calcNet, ProfitInputs } from './lib/profit.js';
import { postReply } from './lib/discord.js';

const log = pino({ level: 'info' });
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const MIN_PROFIT = Number(process.env.MIN_PROFIT_DOLLARS || 30);
const MIN_SOLD30 = Number(process.env.MIN_SOLD_LAST_30 || 5);

// Create Discord client for worker
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Bind the client to the discord module
import('./lib/discord.js').then(({ bindDiscordClient }) => {
  bindDiscordClient(discordClient);
});

// Login to Discord
discordClient.login(process.env.DISCORD_BOT_TOKEN);

new Worker('priceCheck', async job => {
  const { url, channelId, messageId } = job.data as {
    url: string; channelId: string; messageId: string;
  };

  log.info({ jobId: job.id, url, channelId, messageId }, 'Starting job processing');

  try {
    log.info({ url }, 'Parsing product from URL');
    const product = await parseProductFromUrl(url);
    if (!product) {
      log.warn({ url }, 'Failed to parse product, ending job');
      return;
    }
    log.info({ 
      url, 
      title: product.title, 
      price: product.price, 
      sku: product.sku,
      retailer: product.retailer 
    }, 'Product parsed successfully');

    log.info({ url, title: product.title }, 'Fetching eBay sold comps');
    const comps = await fetchEbaySoldComps(product);
    if (!comps || !comps.median || comps.count30d === 0) {
      log.warn({ url, title: product.title }, 'No eBay comps found or insufficient data, ending job');
      return;
    }
    log.info({ 
      url, 
      median: comps.median, 
      count30d: comps.count30d,
      count90d: comps.count90d 
    }, 'eBay comps fetched successfully');

    const est: ProfitInputs = {
      buyPrice: product.price || null,
      soldMedian: comps.median,
      shipCost: product.shipEstimate ?? 12,
      feePct: 0.13,
      feeFixed: 0.3,
      taxPct: 0,
    };
    log.info({ est }, 'Calculating profit');
    const net = calcNet(est);
    log.info({ 
      buyPrice: est.buyPrice, 
      soldMedian: est.soldMedian, 
      profit: net.profit,
      roi: net.roi 
    }, 'Profit calculated');

    if (net.profit < MIN_PROFIT || comps.count30d < MIN_SOLD30) {
      log.info({ 
        profit: net.profit, 
        minProfit: MIN_PROFIT, 
        count30d: comps.count30d, 
        minSold30: MIN_SOLD30 
      }, 'Below threshold, posting suppressed reply');
      await postReply(channelId, messageId, product, comps, net, {
        suppressed: true,
        reason: 'Below threshold',
      });
      return;
    }

    log.info({ url, profit: net.profit }, 'Posting successful reply');
    await postReply(channelId, messageId, product, comps, net);
    log.info({ url }, 'Job completed successfully');
  } catch (err) {
    log.error(err, 'worker error');
  }
}, { connection: redis, concurrency: Number(process.env.QUEUE_CONCURRENCY || 5) });
