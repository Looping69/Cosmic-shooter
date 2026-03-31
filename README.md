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

## Tech Stack

- **React 19** + **TypeScript**
- **Three.js** via React Three Fiber
- **Zustand** for state management
- **Express** + **WebSocket** server
- **Vite** for bundling
- **Tailwind CSS** for UI styling
