import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Message } from 'discord.js';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { bindDiscordClient } from './lib/discord.js';

const log = pino({ level: 'info' });
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}); 
const priceQueue = new Queue('priceCheck', { connection: redis });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const allowedGuilds = (process.env.ALLOWED_GUILD_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Hardcoded test URL for testing
const TEST_URL = 'https://www.bestbuy.com/site/apple-macbook-air-13-inch-laptop-apple-m2-chip-built-for-apple-intelligence-16gb-memory-256gb-ssd-midnight/6602763.p?skuId=6602763';

client.on('ready', () => {
  bindDiscordClient(client);
  log.info({ user: client.user?.tag }, 'Bot ready');
  
  // Auto-test with hardcoded URL
  setTimeout(async () => {
    log.info({ url: TEST_URL }, 'Running auto-test with hardcoded URL');
    try {
      const jobId = await priceQueue.add('priceCheck', {
        url: TEST_URL,
        channelId: 'test-channel',
        messageId: 'test-message',
      });
      log.info({ jobId: jobId.id, url: TEST_URL }, 'Auto-test job queued successfully');
    } catch (error) {
      log.error({ error, url: TEST_URL }, 'Failed to queue auto-test job');
    }
  }, 2000); // Wait 2 seconds after bot is ready
});

client.on('messageCreate', async (msg: Message) => {
  try {
    log.info({ 
      author: msg.author.tag, 
      content: msg.content.substring(0, 100), 
      guildId: msg.guildId,
      channelId: msg.channel.id 
    }, 'Message received');

    if (msg.author.bot) {
      log.info('Skipping bot message');
      return;
    }
    
    if (allowedGuilds.length && !allowedGuilds.includes(msg.guildId || '')) {
      log.info({ guildId: msg.guildId, allowedGuilds }, 'Guild not allowed');
      return;
    }

    // Extract first URL in the message
    const m = msg.content.match(/https?:\/\/\S+/);
    if (!m) {
      log.info('No URL found in message');
      return;
    }
    const url = m[0];
    log.info({ url }, 'URL detected');

    // Dedup by URL for a short window
    const cacheKey = `seen:${url}`;
    const wasSeen = await redis.get(cacheKey);
    if (wasSeen) {
      log.info({ url }, 'URL already seen recently, skipping');
      return;
    }
    await redis.setex(cacheKey, Number(process.env.CACHE_TTL_SECONDS || 21600), '1');
    log.info({ url }, 'URL cached');

    log.info({ url, channelId: msg.channel.id, messageId: msg.id }, 'Adding reaction and queuing job');
    await msg.react('🧮').catch((e) => { 
      log.error(e, 'Failed to add reaction');
    });
    
    const job = await priceQueue.add('check', {
      url,
      channelId: msg.channel.id,
      messageId: msg.id,
      guildId: msg.guildId,
    });
    log.info({ jobId: job.id, url }, 'Job queued successfully');
  } catch (e) {
    log.error(e, 'message handler error');
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
