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

// --- Zustand Store Implementation ---
export const useGameStore = create<GameState>((set, get) => ({
  myId: null,
  myColor: null,
  players: {},
  forceFields: {},
  ws: null,
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
    const { ws: currentWs } = get();
    if (currentWs && (currentWs.readyState === WebSocket.CONNECTING || currentWs.readyState === WebSocket.OPEN)) {
      return;
    }

    // Determine the WebSocket URL.
    // VITE_WS_URL can be set at build time to point at a separately-hosted
    // WebSocket server (e.g. when the frontend is deployed to Vercel but the
    // game server runs on Railway/Render/Fly.io).
    // Falls back to same-host connection for local development.
    const wsUrl = import.meta.env.VITE_WS_URL
      ? import.meta.env.VITE_WS_URL
      : (() => {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          return `${protocol}//${window.location.host}`;
        })();
    const ws = new WebSocket(wsUrl);

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

    ws.onclose = () => {
      // Auto-reconnect logic
      const { ws: currentWs } = get();
      if (currentWs === ws) {
        setTimeout(() => get().connect(), 1000);
      }
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
      set({ ws: null, players: {}, forceFields: {} });
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
