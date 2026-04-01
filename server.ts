/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

const PORT = 3000;

// --- Types ---
// Basic vector type for 3D positions
type Vector3 = { x: number; y: number; z: number };

// Player state interface
interface Player {
  id: string;
  color: string;
  position: Vector3 | null;
  targetPosition: Vector3 | null; // Where the player is aiming/looking
  health: number;
  score: number;
  isCharging: boolean; // True if the player is holding down the mouse button
  lastUpdate: number;  // Timestamp of the last update from this player
}

// ForceField interface (Attractors, Repulsors, Accelerators)
interface ForceField {
  id: string;
  position: Vector3;
  type: 'attractor' | 'repulsor' | 'accelerator';
  ownerId: string;
  createdAt: number;
  color: string;
}

// --- State Management ---
// In-memory storage for game state.
// Note: In a production app, this should be in a database (e.g., Redis) to support scaling.
const players = new Map<string, Player>();
const forceFields = new Map<string, ForceField>();
const clients = new Map<string, WebSocket>();

// Predefined colors for players to choose from randomly
const COLORS = [
  '#FF3366', '#33CCFF', '#FF9933', '#33FF99', 
  '#CC33FF', '#FFFF33', '#FF3333', '#3333FF'
];

/**
 * Broadcasts a message to all connected clients.
 * @param data The data to send (will be JSON stringified).
 * @param excludeId Optional client ID to exclude from the broadcast (e.g., the sender).
 */
function broadcast(data: any, excludeId?: string) {
  const message = JSON.stringify(data);
  for (const [id, ws] of clients.entries()) {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  // --- WebSocket Server Setup ---
  // Use noServer mode so the game WebSocket only handles upgrades to /ws,
  // leaving other upgrade requests (e.g. Vite HMR) untouched.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '/', `http://${request.headers.host}`);
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Other upgrade requests (e.g. Vite HMR) are left for their own handlers.
  });

  wss.on('connection', (ws) => {
    // Initialize new player
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
      lastUpdate: Date.now()
    };
    
    players.set(id, player);
    clients.set(id, ws);

    // 1. Send initial state to the new client (handshake)
    ws.send(JSON.stringify({
      type: 'init',
      id,
      color,
      players: Array.from(players.values()),
      forceFields: Array.from(forceFields.values())
    }));

    // 2. Broadcast new player presence to all other connected clients
    broadcast({
      type: 'player_joined',
      player
    }, id);

    // --- Message Handling ---
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle player movement and state updates
        if (data.type === 'cursor') {
          const p = players.get(id);
          if (p) {
            p.position = data.position;
            p.targetPosition = data.targetPosition;
            p.isCharging = data.isCharging;
            p.lastUpdate = Date.now();
          }
        } 
        // Handle damage events (client-authoritative for now, but verified by ID existence)
        else if (data.type === 'damage') {
          const target = players.get(data.targetId);
          const attacker = players.get(data.attackerId);
          if (target) {
            target.health = Math.max(0, target.health - data.amount);
            if (target.health <= 0 && attacker) {
              attacker.score += 1;
            }
          }
        } 
        // Handle respawn requests
        else if (data.type === 'respawn') {
          const p = players.get(id);
          if (p) {
            p.health = 100;
          }
        } 
        // Handle "fire" events (spawning projectiles/particles)
        else if (data.type === 'fire') {
          // Broadcast fire event to all clients so they can spawn "bullet" particles locally
          broadcast({
            type: 'fire',
            position: data.position,
            direction: data.direction,
            ownerId: data.ownerId,
            color: data.color,
            scatterMultiplier: data.scatterMultiplier
          });
        } 
        // Handle creation of force fields (Attractors/Accelerators)
        else if (data.type === 'add_force') {
          const forceId = uuidv4();
          const force: ForceField = {
            id: forceId,
            position: data.position,
            type: data.forceType,
            ownerId: id,
            createdAt: Date.now(),
            color: data.color
          };
          forceFields.set(forceId, force);
          
          // Broadcast new force field immediately so it appears instantly for everyone
          broadcast({
            type: 'force_added',
            force
          });
        }
      } catch (e) {
        console.error('Invalid message', e);
      }
    });

    // --- Disconnect Handling ---
    ws.on('close', () => {
      players.delete(id);
      clients.delete(id);
      
      // Remove any force fields owned by this player
      // (Optional: keep them persistent? For now, we remove them on disconnect)
      // Actually, let's keep them until they expire naturally.
      // But if we wanted to remove them:
      /*
      for (const [forceId, force] of forceFields.entries()) {
        if (force.ownerId === id) {
          forceFields.delete(forceId);
        }
      }
      */

      broadcast({
        type: 'player_left',
        id
      });
    });
  });

  // --- Game Loop / Broadcast Loop ---
  // Runs at 20Hz (every 50ms) to sync state to clients.
  // This reduces network traffic compared to sending updates on every frame.
  setInterval(() => {
    const now = Date.now();
    
    // Clean up old force fields
    // Accelerators/Attractors last for 5 seconds (5000ms)
    let forcesChanged = false;
    for (const [id, force] of forceFields.entries()) {
      if (now - force.createdAt > 5000) {
        forceFields.delete(id);
        forcesChanged = true;
      }
    }

    // Prepare sync payload
    const updateData = {
      type: 'sync',
      // Only send players who have reported a position
      players: Array.from(players.values()).filter(p => p.position !== null),
      // Only send force fields if something changed (optimization)
      // Actually, for simplicity in this demo, we might want to send them always or handle diffs better.
      // But the client replaces the list, so we should send the full list if we send it.
      // Here we send it only if we deleted something, OR if we just want to ensure sync.
      // Let's send it if changed, but 'force_added' handles additions.
      // This is mainly for deletions.
      ...(forcesChanged ? { forceFields: Array.from(forceFields.values()) } : {})
    };

    broadcast(updateData);
  }, 50);

  // --- API Routes ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', players: players.size });
  });

  // --- Vite Middleware (Dev Mode) ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
