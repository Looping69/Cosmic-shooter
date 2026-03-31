/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Encore port of the Cosmic Striker game server.
 *
 * Each browser tab connects to the `gameConnect` streaming endpoint via
 * WebSocket.  Encore's `api.streamInOut` manages the connection lifecycle;
 * we keep in-memory maps of players / force-fields and a 20 Hz broadcast
 * interval — exactly the same logic as the original server.ts.
 *
 * Deploy:  `encore run`  (local, port 4000)
 *          `encore app link && git push encore main`  (Encore Cloud)
 *
 * Set VITE_WS_URL=ws://localhost:4000/connect when running the frontend
 * against the local Encore dev server.
 */

import { api } from 'encore.dev/api';
import { v4 as uuidv4 } from 'uuid';

// --- Types ---

type Vector3 = { x: number; y: number; z: number };

interface Player {
  id: string;
  color: string;
  position: Vector3 | null;
  targetPosition: Vector3 | null;
  health: number;
  score: number;
  isCharging: boolean;
  lastUpdate: number;
}

interface ForceField {
  id: string;
  position: Vector3;
  type: 'attractor' | 'repulsor' | 'accelerator';
  ownerId: string;
  createdAt: number;
  color: string;
}

/**
 * Messages sent from the browser client to the server.
 * All fields are optional so the same interface covers every message variant
 * (discriminated by `type`), preserving wire-format compatibility with the
 * existing React frontend.
 */
interface ClientMessage {
  type: string;
  // cursor
  position?: Vector3;
  targetPosition?: Vector3 | null;
  isCharging?: boolean;
  // damage
  targetId?: string;
  attackerId?: string;
  amount?: number;
  // fire
  direction?: Vector3;
  ownerId?: string;
  color?: string;
  scatterMultiplier?: number;
  // add_force
  forceType?: 'attractor' | 'repulsor' | 'accelerator';
}

/**
 * Messages sent from the server to each browser client.
 * Same flat-optional design to match the wire protocol consumed by useGameStore.ts.
 */
interface ServerMessage {
  type: string;
  // init
  id?: string;
  color?: string;
  players?: Player[];
  forceFields?: ForceField[];
  // player_joined
  player?: Player;
  // fire / force_added
  force?: ForceField;
  position?: Vector3;
  direction?: Vector3;
  ownerId?: string;
  scatterMultiplier?: number;
}

// A minimal interface for a live stream we can write to from the broadcast loop.
interface Sendable {
  send(msg: ServerMessage): Promise<void>;
}

// --- In-memory game state ---
// (In a production multi-instance deployment use Redis instead.)
const players = new Map<string, Player>();
const forceFields = new Map<string, ForceField>();
const streams = new Map<string, Sendable>();

const COLORS = [
  '#FF3366', '#33CCFF', '#FF9933', '#33FF99',
  '#CC33FF', '#FFFF33', '#FF3333', '#3333FF',
];

// --- Broadcast helper ---
function broadcast(data: ServerMessage, excludeId?: string): void {
  for (const [id, stream] of streams.entries()) {
    if (id !== excludeId) {
      stream.send(data).catch(() => {
        // Ignore errors for disconnected clients; they will be cleaned up when
        // the handler's `finally` block runs.
      });
    }
  }
}

// --- 20 Hz game loop ---
// Syncs player positions/health/scores and removes expired force fields.
setInterval(() => {
  const now = Date.now();
  let forcesChanged = false;

  for (const [id, force] of forceFields.entries()) {
    if (now - force.createdAt > 5000) {
      forceFields.delete(id);
      forcesChanged = true;
    }
  }

  broadcast({
    type: 'sync',
    players: Array.from(players.values()).filter(p => p.position !== null),
    ...(forcesChanged ? { forceFields: Array.from(forceFields.values()) } : {}),
  });
}, 50);

// --- WebSocket streaming endpoint ---
/**
 * Primary multiplayer endpoint.  Browsers connect with:
 *   new WebSocket(`${VITE_WS_URL}`)   // e.g. wss://staging-cosmic.encr.app/connect
 *
 * The handshake is empty ({}); all game data flows as JSON over the stream.
 */
export const gameConnect = api.streamInOut<Record<string, never>, ClientMessage, ServerMessage>(
  { path: '/connect', expose: true },
  async (_handshake, stream) => {
    const id = uuidv4();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    const player: Player = {
      id,
      color,
      position: null,
      targetPosition: null,
      health: 100,
      score: 0,
      isCharging: false,
      lastUpdate: Date.now(),
    };

    players.set(id, player);
    streams.set(id, stream);

    // 1. Send initial state to the new client (handshake response)
    await stream.send({
      type: 'init',
      id,
      color,
      players: Array.from(players.values()),
      forceFields: Array.from(forceFields.values()),
    });

    // 2. Announce the new player to everyone else
    broadcast({ type: 'player_joined', player }, id);

    try {
      // 3. Process incoming messages until the client disconnects
      for await (const msg of stream) {
        if (msg.type === 'cursor') {
          const p = players.get(id);
          if (p) {
            p.position = msg.position ?? null;
            p.targetPosition = msg.targetPosition ?? null;
            p.isCharging = msg.isCharging ?? false;
            p.lastUpdate = Date.now();
          }
        } else if (msg.type === 'damage') {
          const target = players.get(msg.targetId ?? '');
          const attacker = players.get(msg.attackerId ?? '');
          if (target) {
            target.health = Math.max(0, target.health - (msg.amount ?? 0));
            if (target.health <= 0 && attacker) {
              attacker.score += 1;
            }
          }
        } else if (msg.type === 'respawn') {
          const p = players.get(id);
          if (p) p.health = 100;
        } else if (msg.type === 'fire') {
          broadcast({
            type: 'fire',
            position: msg.position,
            direction: msg.direction,
            ownerId: msg.ownerId,
            color: msg.color,
            scatterMultiplier: msg.scatterMultiplier,
          });
        } else if (msg.type === 'add_force') {
          if (!msg.position) break;
          const forceId = uuidv4();
          const force: ForceField = {
            id: forceId,
            position: msg.position,
            type: msg.forceType ?? 'attractor',
            ownerId: id,
            createdAt: Date.now(),
            color: msg.color ?? '',
          };
          forceFields.set(forceId, force);
          broadcast({ type: 'force_added', force });
        }
      }
    } finally {
      // 4. Clean up on disconnect
      players.delete(id);
      streams.delete(id);
      broadcast({ type: 'player_left', id });
    }
  },
);

// --- Health check endpoint ---
export const health = api(
  { method: 'GET', path: '/health', expose: true },
  async (): Promise<{ status: string; players: number }> => ({
    status: 'ok',
    players: players.size,
  }),
);
