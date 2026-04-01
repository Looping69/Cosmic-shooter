/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect } from 'react';
import { CosmicCanvas } from './components/CosmicCanvas';
import { useGameStore } from './store/useGameStore';
import { Users } from 'lucide-react';

export default function App() {
  const connect = useGameStore((state) => state.connect);
  const disconnect = useGameStore((state) => state.disconnect);
  const players = useGameStore((state) => state.players);
  const myColor = useGameStore((state) => state.myColor);
  const connectionStatus = useGameStore((state) => state.connectionStatus);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const playerCount = Object.keys(players).length + 1;
  const maxParticles = useGameStore((state) => state.maxParticles);
  const setMaxParticles = useGameStore((state) => state.setMaxParticles);
  const scatterMultiplier = useGameStore((state) => state.scatterMultiplier);
  const setScatterMultiplier = useGameStore((state) => state.setScatterMultiplier);
  const health = useGameStore((state) => state.health);
  const score = useGameStore((state) => state.score);
  const damageFlash = useGameStore((state) => state.damageFlash);
  const invulnerable = useGameStore((state) => state.invulnerable);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans">
      <CosmicCanvas />
      
      {/* Damage Flash Overlay */}
      {damageFlash && (
        <div className="absolute inset-0 bg-red-600/30 pointer-events-none z-20 animate-pulse" />
      )}

      {/* Invulnerability Indicator */}
      {invulnerable && (
        <div className="absolute inset-0 border-4 border-cyan-400/40 pointer-events-none z-20 rounded-lg animate-pulse" />
      )}
      
      {/* UI Overlay */}
      <div className="absolute top-0 left-0 w-full p-6 pointer-events-none flex justify-between items-start z-10">
        <div className="space-y-2">
          <h1 className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 italic uppercase">
            Cosmic Striker
          </h1>
          <p className="text-sm text-gray-400 max-w-xs leading-relaxed font-medium">
            <span className="text-white">WASD</span> to move your ship.<br/>
            <span className="text-cyan-400 font-bold">Hold Left Click</span> to gather particles.<br/>
            <span className="text-orange-400 font-bold">Release</span> to blast enemies.<br/>
            <span className="text-emerald-400 font-bold">Scroll Wheel</span> to adjust particle scatter.
          </p>
          
          <div className="flex flex-col gap-2 mt-6 pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="px-3 py-1 bg-indigo-600 rounded-md text-xs font-black italic uppercase tracking-widest">
                Score: {score}
              </div>
              <div className="px-3 py-1 bg-emerald-600 rounded-md text-xs font-black italic uppercase tracking-widest">
                Health: {health}%
              </div>
            </div>
            
            <div className="w-48 h-2 bg-gray-900 rounded-full overflow-hidden border border-white/10">
              <div 
                className="h-full bg-cyan-400 transition-all duration-300" 
                style={{ width: `${health}%`, backgroundColor: health < 30 ? '#ef4444' : '#22d3ee' }} 
              />
            </div>

            <div className="mt-4 flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                Particle Scatter: {scatterMultiplier.toFixed(1)}x
              </label>
              <input 
                type="range" 
                min="0.1" 
                max="5.0" 
                step="0.1" 
                value={scatterMultiplier} 
                onChange={(e) => setScatterMultiplier(parseFloat(e.target.value))}
                className="w-48 accent-cyan-400"
              />
            </div>
          </div>
          
          {myColor && (
            <div className="flex items-center gap-2 mt-4">
              <div className="w-3 h-3 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" style={{ backgroundColor: myColor }} />
              <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Ship Signature</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-4 pointer-events-auto">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
            <Users size={16} className="text-cyan-400" />
            <span className="text-sm font-medium">{playerCount} {playerCount === 1 ? 'Player' : 'Players'}</span>
          </div>
          {connectionStatus !== 'connected' && (
            <div className={`flex items-center gap-2 backdrop-blur-md px-4 py-2 rounded-full border shadow-lg ${
              connectionStatus === 'connecting'
                ? 'bg-yellow-500/20 border-yellow-400/30 text-yellow-300'
                : 'bg-red-500/20 border-red-400/30 text-red-300'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
              }`} />
              <span className="text-xs font-bold uppercase tracking-widest">
                {connectionStatus === 'connecting' ? 'Connecting…' : 'Disconnected'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
