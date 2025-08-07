# Discord Resale-Check Bot — MVP

This bot watches Discord channels for **product URLs**, parses the product page to pull basic details, checks **eBay SOLD comps**, and replies with an embed that includes median sold price, volume, and **estimated profit**.

> MVP uses lightweight scraping for eBay sold comps. For production, switch to official eBay APIs and add rate limiting/backoff per domain.

## Quick start

1) **Create a Discord Bot**
- https://discord.com/developers → New Application → Bot → enable **Message Content Intent**.
- Copy your **Bot Token**.

2) **Clone & setup**
```bash
npm install
cp .env.example .env
# put your token in .env
```

3) **Run Redis (queue + cache)**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

4) **Start the bot**
```bash
npm run dev
```
Invite the bot with OAuth2 URL (scopes: `bot`, permissions: Read Messages, Send Messages, Add Reactions, Embed Links).

5) **Test**
- Paste a Walmart or Best Buy product URL into a channel the bot can read.
- Bot reacts with 🧮 then replies with comps.

## Env
Copy `.env.example` → `.env` and fill values.
