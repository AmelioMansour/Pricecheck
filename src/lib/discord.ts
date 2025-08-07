import { EmbedBuilder, Client, TextChannel } from 'discord.js';

export async function postReply(
  channelId: string,
  messageId: string,
  product: any,
  comps: { median: number; low: number; high: number; count30d: number },
  net: { net: number; profit: number; margin: number },
  opts?: { suppressed?: boolean; reason?: string }
) {
  const client = (globalThis as any).__discordClient as Client | undefined;
  if (!client) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !('send' in ch)) return;

  const embed = new EmbedBuilder()
    .setTitle(product.title?.slice(0, 240) || 'Product')
    .setURL(product.url)
    .setThumbnail(product.image || null)
    .addFields(
      { name: 'Retailer', value: String(product.retailer || 'unknown'), inline: true },
      { name: 'Buy Price', value: product.price ? `$${product.price.toFixed(2)}` : '—', inline: true },
      { name: 'eBay SOLD Median', value: `$${comps.median.toFixed(2)}`, inline: true },
      { name: 'Sold Volume (est 30d)', value: String(comps.count30d), inline: true },
      { name: 'Range', value: `$${comps.low.toFixed(0)}–$${comps.high.toFixed(0)}`, inline: true },
      { name: 'Net (est)', value: `$${net.net.toFixed(2)}`, inline: true },
      { name: 'Profit (est)', value: `$${net.profit.toFixed(2)}`, inline: true },
    )
    .setFooter({ text: opts?.suppressed ? `Below threshold: ${opts.reason || ''}` : 'MVP comps · estimates only' });

  await (ch as TextChannel).send({ content: opts?.suppressed ? '⚠️ Below threshold' : undefined, embeds: [embed] });
}

export function bindDiscordClient(c: Client) {
  (globalThis as any).__discordClient = c;
}
