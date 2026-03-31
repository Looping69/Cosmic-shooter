# Cosmic Striker

A fast-paced multiplayer particle-based shooter built with React, Three.js, and WebSockets.

Weaponize swirling particles to blast your enemies in a glowing cosmic arena. Charge your shots, deploy force fields, and dominate the leaderboard.

## Controls

| Input | Action |
|---|---|
| **WASD** | Move your ship |
| **Hold Left Click** | Charge — gather particles toward your cursor |
| **Release Left Click** | Fire — deploy an accelerator that blasts particles at enemies |
| **Scroll Wheel** | Adjust particle scatter (focused beam ↔ wide spread) |

## Features

- **Real-time multiplayer** via WebSockets — see other players, their particles, and force fields
- **25,000 particle system** rendered with instanced meshes and curl noise for organic motion
- **Force fields** — Attractors pull, Repulsors push, Accelerators weaponize particles into beams
- **Post-processing bloom** for that neon glow aesthetic
- **Synthesized audio** — all sound effects generated with the Web Audio API, no files needed
- **Respawn invulnerability** — 2-second grace period after death
- **Accelerator cooldown** — 1-second cooldown prevents spam
- **Damage flash** — screen flashes red when you take a hit
- **Arena boundaries** — keeps the action contained in a 50×50 arena

## Getting Started

**Prerequisites:** Node.js

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

The project has two parts: a static **frontend** (React/Vite) and a persistent **WebSocket game server** (Express + `ws`). They can be hosted separately.

### Frontend — Vercel (or any static host)

1. Deploy this repository to [Vercel](https://vercel.com). The included `vercel.json` handles SPA routing automatically.
2. In your Vercel project settings → **Environment Variables**, add:
   ```
   VITE_WS_URL = wss://<your-game-server-domain>
   ```
3. Redeploy so the frontend is built with the new variable.

### Game Server — Railway / Render / Fly.io

The game server must run as a **persistent Node.js process** (not a serverless function). Platforms that work out of the box:

- [Railway](https://railway.app) — connect your repo, set the start command to `npm run dev` (or `npx tsx server.ts`), expose port 3000.
- [Render](https://render.com) — create a *Web Service*, set the start command to `npx tsx server.ts`.
- [Fly.io](https://fly.io) — `fly launch` and deploy with port 3000.

> **Why separate?** Vercel is a serverless edge platform; it cannot keep a WebSocket server alive between requests. The game server needs a permanent process to maintain player state and broadcast at 20 Hz.

## Tech Stack

- **React 19** + **TypeScript**
- **Three.js** via React Three Fiber
- **Zustand** for state management
- **Express** + **WebSocket** server
- **Vite** for bundling
- **Tailwind CSS** for UI styling
