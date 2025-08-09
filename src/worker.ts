import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
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

new Worker('priceCheck', async job => {
  const { url, channelId, messageId } = job.data as {
    url: string; channelId: string; messageId: string;
  };

  try {
    const product = await parseProductFromUrl(url);
    if (!product) return;

    const comps = await fetchEbaySoldComps(product);
    if (!comps || !comps.median || comps.count30d === 0) return;

    const est: ProfitInputs = {
      buyPrice: product.price || null,
      soldMedian: comps.median,
      shipCost: product.shipEstimate ?? 12,
      feePct: 0.13,
      feeFixed: 0.3,
      taxPct: 0,
    };
    const net = calcNet(est);

    if (net.profit < MIN_PROFIT || comps.count30d < MIN_SOLD30) {
      await postReply(channelId, messageId, product, comps, net, {
        suppressed: true,
        reason: 'Below threshold',
      });
      return;
    }

    await postReply(channelId, messageId, product, comps, net);
  } catch (err) {
    log.error(err, 'worker error');
  }
}, { connection: redis, concurrency: Number(process.env.QUEUE_CONCURRENCY || 5) });
