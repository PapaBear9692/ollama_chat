# Ollama Chat

A modern, mobile-friendly chat UI for [Ollama](https://ollama.com) — your local LLMs in a Claude-style interface. 100% offline, no accounts, no telemetry.

Built with Next.js (App Router) + React, styled with plain CSS. No UI framework, no state library, nothing to configure beyond having Ollama running.

## Features

- **Streaming chat** with any locally installed Ollama model, token by token
- **Model picker** with sizes (e.g. `qwen2.5 · 398 MB`) in a styled popover
- **Chat history sidebar** — conversations persisted in a browser cookie (survives reloads), with delete support
- **Live server stats** — model count, total disk usage, Ollama version
- **Responsive** — desktop sidebar, mobile slide-in drawer with backdrop
- **Claude-inspired design** — warm cream palette, clay accents, serif greeting, custom caret color

## Prerequisites

1. **Node.js 18.18+** (or 20+) — check with `node --version`
2. **Ollama** installed and running — [ollama.com/download](https://ollama.com/download)
3. At least one model pulled:
   ```bash
   ollama pull qwen2.5:0.5b     # small & fast, ~400 MB
   # or something bigger:
   ollama pull llama3.2:3b
   ```

## Getting started

```bash
# 1. install dependencies
npm install

# 2. start the dev server
npm run dev

# 3. open the app
#    local:    http://localhost:3000
#    on LAN:   http://<your-lan-ip>:3000   (for phone testing)
```

For a specific port: `npm run dev -- --port 3100`

### Phone / LAN access

If you open the app from another device via your machine's LAN IP, add that hostname to `allowedDevOrigins` in `next.config.mjs` — otherwise Next.js blocks its dev assets from cross-origin loads:

```js
// next.config.mjs
const nextConfig = {
  allowedDevOrigins: ["192.168.x.x"],  // bare hostname, no http://, no port
};
export default nextConfig;
```

> Tip: entries must be **bare hostnames**. Full URLs like `http://192.168.x.x:3000` are silently ignored.

### Production build

```bash
npm run build
npm start        # serves on port 3000 by default
```

## Configuration

| Env variable | Default | Purpose |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Where your Ollama daemon listens |

Set it in `.env.local` if Ollama runs elsewhere (e.g. a different machine on your network).

## How chat history works

Conversations are stored in the `ollama_chats` browser cookie (1-year expiry). Since cookies cap at ~4 KB, the saver degrades gracefully: message text is truncated to 1500 chars, oldest chats are dropped first, then messages are trimmed. For heavier use, swap the cookie layer in `src/app/page.tsx` (`readChats` / `writeChats`) for localStorage or a database.

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts      # streaming proxy → Ollama /api/chat
│   │   └── models/route.ts    # model list + version → Ollama /api/tags
│   ├── layout.tsx             # fonts, metadata, viewport
│   ├── page.tsx               # the whole UI (client component)
│   └── globals.css            # all styling
├── next.config.mjs            # allowedDevOrigins for LAN access
└── package.json
```

## Troubleshooting

- **"Cannot reach Ollama"** — make sure the daemon is up: `curl http://localhost:11434/api/version`
- **Buttons dead on phone / LAN IP** — see *Phone / LAN access* above (`allowedDevOrigins`)
- **No models in the picker** — run `ollama list`; pull one if empty
- **npm install fails with EALLOWSCRIPTS** — your global `~/.npmrc` restricts install scripts; the project ships a local `.npmrc` that allowlists Next's native packages, so install inside the project as usual
