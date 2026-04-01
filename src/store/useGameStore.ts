/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { soundManager } from '../systems/SoundManager';

// --- Gameplay Constants ---
const ACCELERATOR_COOLDOWN_MS = 1000;
const DAMAGE_FLASH_DURATION_MS = 150;
const INVULNERABILITY_DURATION_MS = 2000;
const RESPAWN_DELAY_MS = 2000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 5;

// Colors assigned to the local player when entering offline mode
const OFFLINE_COLORS = [
  '#FF3366', '#33CCFF', '#FF9933', '#33FF99',
  '#CC33FF', '#FFFF33', '#FF3333', '#3333FF'
];

// --- Types ---
export type Vector3 = { x: number; y: number; z: number };

// Represents a connected player
export interface Player {
  id: string;
  color: string;
  position: Vector3 | null;
  targetPosition: Vector3 | null; // Where the player is aiming/looking
  health: number;
  score: number;
  isCharging: boolean; // Visual state for charging/firing
}

// Represents a physics object in the world
export interface ForceField {
  id: string;
  position: Vector3;
  type: 'attractor' | 'repulsor' | 'accelerator';
  ownerId: string;
  createdAt: number;
  color: string;
}

// --- Store State Interface ---
interface GameState {
  // Local player state
  myId: string | null;
  myColor: string | null;
  health: number;
  score: number;
  isCharging: boolean;
  invulnerable: boolean;
  lastAcceleratorTime: number;
  damageFlash: boolean;
  
  // World state
  players: Record<string, Player>;
  forceFields: Record<string, ForceField>;
  
  // System state
  ws: WebSocket | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'offline';
  maxParticles: number;
  scatterMultiplier: number;
  
  // Event callbacks
  onFire: ((data: { position: Vector3; direction: Vector3; ownerId: string; color: string; scatterMultiplier?: number }) => void) | null;
  
  // Actions
  connect: () => void;
  disconnect: () => void;
  sendCursor: (position: Vector3, isCharging: boolean, targetPosition: Vector3 | null) => void;
  addForce: (position: Vector3, type: 'attractor' | 'repulsor' | 'accelerator') => void;
  setMaxParticles: (count: number) => void;
  setScatterMultiplier: (multiplier: number) => void;
  takeDamage: (amount: number, attackerId: string) => void;
  fire: (position: Vector3, direction: Vector3) => void; // Legacy firing (bullets)
  setOnFire: (cb: (data: any) => void) => void;
}

// Tracks reconnection attempts for exponential backoff
let reconnectAttempts = 0;

// --- Zustand Store Implementation ---
export const useGameStore = create<GameState>((set, get) => ({
  myId: null,
  myColor: null,
  players: {},
  forceFields: {},
  ws: null,
  connectionStatus: 'disconnected',
  maxParticles: 25000,
  scatterMultiplier: 1.0,
  health: 100,
  score: 0,
  isCharging: false,
  invulnerable: false,
  lastAcceleratorTime: 0,
  damageFlash: false,
  onFire: null,

  // Connects to the WebSocket server
  connect: () => {
    const { ws: currentWs, connectionStatus } = get();
    if (currentWs && (currentWs.readyState === WebSocket.CONNECTING || currentWs.readyState === WebSocket.OPEN)) {
      return;
    }
    // Don't auto-reconnect once we've entered offline mode
    if (connectionStatus === 'offline') {
      return;
    }

    // Determine the WebSocket URL.
    // VITE_WS_URL can be set at build time to point at a separately-hosted
    // WebSocket server (e.g. when the frontend is deployed to Vercel but the
    // game server runs on Encore Cloud / Railway / Render / Fly.io).
    // Falls back to same-host /ws endpoint for local development.
    //
    // In production builds (e.g. on Vercel), if VITE_WS_URL is not set there
    // is no WebSocket server to connect to — Vercel is serverless and cannot
    // serve WebSockets.  Enter offline mode immediately instead of retrying.
    const explicitWsUrl = import.meta.env.VITE_WS_URL;
    if (!explicitWsUrl && import.meta.env.PROD) {
      const offlineId = 'local-' + crypto.randomUUID();
      const offlineColor = OFFLINE_COLORS[Math.floor(Math.random() * OFFLINE_COLORS.length)];
      set({
        ws: null,
        connectionStatus: 'offline',
        myId: offlineId,
        myColor: offlineColor,
        health: 100,
        score: 0,
      });
      return;
    }

    const wsUrl = explicitWsUrl || (() => {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          return `${protocol}//${window.location.host}/ws`;
        })();
    const ws = new WebSocket(wsUrl);

    set({ connectionStatus: 'connecting' });

    ws.onopen = () => {
      set({ connectionStatus: 'connected' });
      // Reset reconnect delay on successful connection
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Handle initial handshake
      if (data.type === 'init') {
        set({ myId: data.id, myColor: data.color, health: 100, score: 0 });
        const playersMap: Record<string, Player> = {};
        data.players.forEach((p: Player) => {
          if (p.id !== data.id) playersMap[p.id] = p;
        });
        
        const forcesMap: Record<string, ForceField> = {};
        data.forceFields.forEach((f: ForceField) => {
          forcesMap[f.id] = f;
        });
        
        set({ players: playersMap, forceFields: forcesMap });
      } 
      // Handle new player joining
      else if (data.type === 'player_joined') {
        set((state) => ({
          players: { ...state.players, [data.player.id]: data.player }
        }));
      } 
      // Handle player leaving
      else if (data.type === 'player_left') {
        set((state) => {
          const newPlayers = { ...state.players };
          delete newPlayers[data.id];
          return { players: newPlayers };
        });
      } 
      // Handle world state sync (20Hz)
      else if (data.type === 'sync') {
        set((state) => {
          const newPlayers = { ...state.players };
          // Update other players
          data.players.forEach((p: Player) => {
            if (p.id !== state.myId) {
              newPlayers[p.id] = { 
                ...newPlayers[p.id], 
                position: p.position,
                targetPosition: p.targetPosition,
                health: p.health,
                score: p.score,
                isCharging: p.isCharging
              };
            } else {
              // Sync my own health/score from server if needed
              if (p.health !== undefined) set({ health: p.health, score: p.score });
            }
          });
          
          // Update force fields if provided in sync packet
          let newForces = state.forceFields;
          if (data.forceFields) {
            newForces = {};
            data.forceFields.forEach((f: ForceField) => {
              newForces[f.id] = f;
            });
          }
          
          return { players: newPlayers, forceFields: newForces };
        });
      } 
      // Handle fire events (for bullet particles)
      else if (data.type === 'fire') {
        const { onFire } = get();
        if (onFire) onFire(data);
        soundManager.playShoot();
      } 
      // Handle new force field creation
      else if (data.type === 'force_added') {
        set((state) => ({
          forceFields: { ...state.forceFields, [data.force.id]: data.force }
        }));
        soundManager.playForceField();
      }
    };

    ws.onerror = () => {
      // Error details are intentionally limited in browser WebSocket API.
      // The onclose handler will fire next and handle reconnection.
    };

    ws.onclose = () => {
      // Auto-reconnect with exponential backoff, up to MAX_RECONNECT_ATTEMPTS
      const { ws: currentWs } = get();
      if (currentWs === ws) {
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          // Give up and enter offline / single-player mode
          const offlineId = 'local-' + crypto.randomUUID();
          const offlineColor = OFFLINE_COLORS[Math.floor(Math.random() * OFFLINE_COLORS.length)];
          set({
            ws: null,
            connectionStatus: 'offline',
            myId: offlineId,
            myColor: offlineColor,
            health: 100,
            score: 0,
          });
          return;
        }
        set({ connectionStatus: 'disconnected' });
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
          RECONNECT_MAX_DELAY_MS
        );
        setTimeout(() => get().connect(), delay);
      }
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
      set({ ws: null, connectionStatus: 'disconnected', players: {}, forceFields: {} });
    }
  },

  // Sends player position and state to server
  sendCursor: (position: Vector3, isCharging: boolean, targetPosition: Vector3 | null) => {
    const { ws, isCharging: currentIsCharging } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cursor', position, isCharging, targetPosition }));
    }
    // Optimistic local update
    if (isCharging !== currentIsCharging) {
      set({ isCharging });
    }
  },

  // Requests creation of a force field
  addForce: (position: Vector3, type: 'attractor' | 'repulsor' | 'accelerator') => {
    const { ws, myColor, lastAcceleratorTime } = get();
    // 1-second cooldown on accelerators
    if (type === 'accelerator' && Date.now() - lastAcceleratorTime < ACCELERATOR_COOLDOWN_MS) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'add_force', position, forceType: type, color: myColor }));
    }
    if (type === 'accelerator') set({ lastAcceleratorTime: Date.now() });
    soundManager.playForceField();
  },

  setMaxParticles: (maxParticles: number) => set({ maxParticles }),
  setScatterMultiplier: (scatterMultiplier: number) => set({ scatterMultiplier }),

  // Handles taking damage locally and notifying server
  takeDamage: (amount: number, attackerId: string) => {
    const { health, ws, myId, invulnerable } = get();
    if (invulnerable) return;
    const newHealth = Math.max(0, health - amount);
    set({ health: newHealth, damageFlash: true });
    setTimeout(() => set({ damageFlash: false }), DAMAGE_FLASH_DURATION_MS);
    
    soundManager.playHit();
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'damage', amount, attackerId, targetId: myId }));
    }
    
    // Handle death and respawn
    if (newHealth <= 0) {
      soundManager.playDeath();
      setTimeout(() => {
        set({ health: 100, invulnerable: true });
        soundManager.playSpawn();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'respawn' }));
        }
        setTimeout(() => set({ invulnerable: false }), INVULNERABILITY_DURATION_MS);
      }, RESPAWN_DELAY_MS);
    }
  },

  // Sends fire event (for bullets)
  fire: (position: Vector3, direction: Vector3) => {
    const { ws, myId, myColor, scatterMultiplier } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'fire', position, direction, ownerId: myId, color: myColor, scatterMultiplier }));
    }
    soundManager.playShoot();
  },

  setOnFire: (onFire: (data: any) => void) => set({ onFire })
}));
