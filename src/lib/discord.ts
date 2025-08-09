import { EmbedBuilder, Client, TextChannel } from 'discord.js';

let discordClient: Client | undefined;

export async function postReply(
  channelId: string,
  messageId: string,
  product: any,
  comps: { median: number; low: number; high: number; count30d: number },
  net: { net: number; profit: number; margin: number },
  opts?: { suppressed?: boolean; reason?: string }
) {
  if (!discordClient) {
    console.error('Discord client not available');
    return;
  }
  
  const ch = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!ch || !('send' in ch)) {
    console.error('Channel not found or not a text channel');
    return;
  }

  // Create eBay search URL
  const searchTerm = encodeURIComponent(product.title || 'product');
  const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${searchTerm}&LH_Sold=1&LH_Complete=1`;

  const embed = new EmbedBuilder()
    .setTitle(product.title?.slice(0, 240) || 'Product')
    .setURL(product.url)
    .setThumbnail(product.image || null)
    .setColor(opts?.suppressed ? 0xFFA500 : 0x00FF00) // Orange for suppressed, Green for good
    .addFields(
      { name: 'Retailer', value: String(product.retailer || 'unknown'), inline: true },
      { name: 'Buy Price', value: product.price ? `$${product.price.toFixed(2)}` : '—', inline: true },
      { name: 'eBay SOLD Median', value: `$${comps.median.toFixed(2)}`, inline: true },
      { name: 'Sold Volume (30d)', value: String(comps.count30d), inline: true },
      { name: 'Price Range', value: `$${comps.low.toFixed(0)}–$${comps.high.toFixed(0)}`, inline: true },
      { name: 'Net (est)', value: `$${net.net.toFixed(2)}`, inline: true },
      { name: 'Profit (est)', value: `$${net.profit.toFixed(2)}`, inline: true },
      { name: 'eBay Search', value: `[View Sold Items](${ebayUrl})`, inline: false },
    )
    .setFooter({ text: opts?.suppressed ? `Below threshold: ${opts.reason || ''}` : 'MVP comps · estimates only' });

  try {
    // Try to reply to the original message first
    const originalMessage = await (ch as TextChannel).messages.fetch(messageId).catch(() => null);
    if (originalMessage) {
      await originalMessage.reply({ 
        content: opts?.suppressed ? '⚠️ Below threshold' : '💰 Price analysis complete!', 
        embeds: [embed] 
      });
    } else {
      // Fallback to sending a new message
      await (ch as TextChannel).send({ 
        content: opts?.suppressed ? '⚠️ Below threshold' : '💰 Price analysis complete!', 
        embeds: [embed] 
      });
    }
    console.log('Discord reply sent successfully');
  } catch (error) {
    console.error('Failed to send Discord reply:', error);
  }
}

export function bindDiscordClient(c: Client) {
  discordClient = c;
}
