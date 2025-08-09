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

client.on('ready', () => {
  bindDiscordClient(client);
  log.info({ user: client.user?.tag }, 'Bot ready');
});

client.on('messageCreate', async (msg: Message) => {
  try {
    if (msg.author.bot) return;
    if (allowedGuilds.length && !allowedGuilds.includes(msg.guildId || '')) return;

    // Extract first URL in the message
    const m = msg.content.match(/https?:\/\/\S+/);
    if (!m) return;
    const url = m[0];

    // Dedup by URL for a short window
    const cacheKey = `seen:${url}`;
    const wasSeen = await redis.get(cacheKey);
    if (wasSeen) return;
    await redis.setex(cacheKey, Number(process.env.CACHE_TTL_SECONDS || 21600), '1');

    await msg.react('🧮').catch(() => { });
    await priceQueue.add('check', {
      url,
      channelId: msg.channel.id,
      messageId: msg.id,
      guildId: msg.guildId,
    });
  } catch (e) {
    log.error(e, 'message handler error');
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
