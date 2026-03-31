/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, Vector3 } from '../store/useGameStore';
import { computeCurl } from '../utils/curlNoise';

const PARTICLE_LIFETIME = 3.0; // seconds

// --- Particle Interface ---
// Represents a single particle in the system
interface Particle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  baseColor: THREE.Color;
  life: number;
  isBullet: boolean; // True if this is a projectile (not used much in current accelerator logic)
  ownerId: string | null;
}

/**
 * Renders and simulates the entire particle system.
 * Uses InstancedMesh for high performance (rendering thousands of particles in one draw call).
 */
export function Particles({ mousePosRef, playerPosRef }: { mousePosRef: React.MutableRefObject<THREE.Vector3 | null>, playerPosRef: React.MutableRefObject<THREE.Vector3> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const maxParticles = useGameStore((state) => state.maxParticles);
  const myId = useGameStore((state) => state.myId);
  const takeDamage = useGameStore((state) => state.takeDamage);
  const setOnFire = useGameStore((state) => state.setOnFire);
  
  // --- Texture Generation ---
  // Creates a soft radial gradient texture for the particles
  const particleTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  // Initialize instanceColor attribute
  React.useEffect(() => {
    if (meshRef.current) {
      const color = new THREE.Color();
      for (let i = 0; i < maxParticles; i++) {
        meshRef.current.setColorAt(i, color);
      }
      if (meshRef.current.instanceColor) {
        meshRef.current.instanceColor.needsUpdate = true;
      }
    }
  }, [maxParticles]);

  const myColor = useGameStore((state) => state.myColor);

  // --- Particle Pool Initialization ---
  const particles = useMemo(() => {
    const arr: Particle[] = [];
    for (let i = 0; i < maxParticles; i++) {
      arr.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        baseColor: new THREE.Color(),
        life: 0,
        isBullet: false,
        ownerId: null,
      });
    }
    return arr;
  }, [maxParticles]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const spawnIndex = useRef(0);

  // --- Spawning Logic ---
  const spawnParticle = (pos: THREE.Vector3, colorHex: string, isBullet = false, velocity?: THREE.Vector3, ownerId: string | null = null) => {
    const p = particles[spawnIndex.current];
    p.active = true;
    p.position.copy(pos);
    p.isBullet = isBullet;
    p.ownerId = ownerId;
    
    if (isBullet && velocity) {
      p.velocity.copy(velocity);
      p.life = 2.0; // Bullets last less
      p.position.x += (Math.random() - 0.5) * 0.5;
      p.position.y += (Math.random() - 0.5) * 0.5;
      p.position.z += (Math.random() - 0.5) * 0.5;
    } else {
      const scatterMultiplier = useGameStore.getState().scatterMultiplier;
      // Normal ambient particles
      p.position.x += (Math.random() - 0.5) * 1.5 * scatterMultiplier;
      p.position.y += (Math.random() - 0.5) * 1.5 * scatterMultiplier;
      p.position.z += (Math.random() - 0.5) * 1.5 * scatterMultiplier;
      p.velocity.set(
        (Math.random() - 0.5) * 2.0 * scatterMultiplier,
        (Math.random() - 0.5) * 2.0 * scatterMultiplier,
        (Math.random() - 0.5) * 2.0 * scatterMultiplier
      );
      p.life = PARTICLE_LIFETIME;
    }
    
    p.color.set(colorHex);
    p.baseColor.set(colorHex);
    spawnIndex.current = (spawnIndex.current + 1) % maxParticles;
  };

  // Handle fire events from server (spawns bullet bursts)
  React.useEffect(() => {
    setOnFire((data: any) => {
      const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
      const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z).normalize();
      
      // Spawn a burst of bullet particles
      const scatterMultiplier = data.scatterMultiplier ?? useGameStore.getState().scatterMultiplier;
      for (let i = 0; i < 50; i++) {
        const vel = dir.clone().multiplyScalar(20 + Math.random() * 10);
        // Add some spread
        vel.x += (Math.random() - 0.5) * 2 * scatterMultiplier;
        vel.y += (Math.random() - 0.5) * 2 * scatterMultiplier;
        vel.z += (Math.random() - 0.5) * 2 * scatterMultiplier;
        spawnParticle(pos, data.color, true, vel, data.ownerId);
      }
    });
  }, [setOnFire, maxParticles]);

  // --- Main Simulation Loop ---
  useFrame((state, delta) => {
    if (!meshRef.current) return;

    // 1. Spawn my particles (from local player position)
    if (playerPosRef.current && myColor) {
      // Spawn a few per frame
      for (let i = 0; i < 80; i++) {
        spawnParticle(playerPosRef.current, myColor);
      }
    }

    // 2. Spawn other players' particles
    // We access the store directly here to avoid re-rendering the component on every store update
    const currentPlayers = useGameStore.getState().players;
    Object.values(currentPlayers).forEach(player => {
      if (player.position && player.color) {
        const pPos = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
        for (let i = 0; i < 40; i++) {
          spawnParticle(pPos, player.color);
        }
      }
    });

    const currentForces = useGameStore.getState().forceFields;
    const forces = Object.values(currentForces);
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    const emberColor = new THREE.Color('#ff3300');
    const whiteColor = new THREE.Color('#ffffff');
    const myPos = playerPosRef.current || new THREE.Vector3(0, 0, 0);

    // 3. Update every particle
    for (let i = 0; i < maxParticles; i++) {
      const p = particles[i];
      
      // Skip inactive particles
      if (!p.active) {
        dummy.position.set(0, 0, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Life check
      p.life -= delta;
      if (p.life <= 0) {
        p.active = false;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // --- Physics Simulation ---
      
      // Physics variables
      let curlInfluence = 1.0;

      // Apply Force Fields (Attractors, Repulsors, Accelerators)
      for (const force of forces) {
        const fPos = new THREE.Vector3(force.position.x, force.position.y, force.position.z);
        const dir = new THREE.Vector3().subVectors(fPos, p.position);
        const distSq = dir.lengthSq();
        
        if (distSq > 0.1 && distSq < 400) {
          dir.normalize();
          const strength = 100.0 / distSq;
          
          if (force.type === 'attractor') {
            p.velocity.add(dir.multiplyScalar(strength * delta));
            if (distSq < 10) {
               p.baseColor.lerp(whiteColor, 0.05);
            }
          } else if (force.type === 'repulsor') {
            p.velocity.sub(dir.multiplyScalar(strength * delta));
          } else if (force.type === 'accelerator') {
            // Focus: Reduce curl noise when in range of accelerator to keep beam tight
            curlInfluence = 0.2;

            // Accelerator Logic:
            // 1. Strong attraction to pull particles in (Focusing)
            p.velocity.add(dir.multiplyScalar(strength * 2 * delta));
            
            // 2. Scattering (Closer)
            // As they get closer (distSq < 25), add random noise
            if (distSq < 25.0) {
                 const scatterMultiplier = useGameStore.getState().scatterMultiplier;
                 const scatter = 20.0 * delta * (1.0 - (distSq / 25.0)) * scatterMultiplier; 
                 p.velocity.x += (Math.random() - 0.5) * scatter;
                 p.velocity.y += (Math.random() - 0.5) * scatter;
                 p.velocity.z += (Math.random() - 0.5) * scatter;
            }
            
            // 3. Core Slingshot
            if (distSq < 2.0) {
               // Boost speed in current direction
               const speed = p.velocity.length();
               if (speed < 40) {
                 p.velocity.multiplyScalar(1.2); // Accelerate
               }
               // Add some glow to show it was boosted
               p.baseColor.set('#00ffff');
            }
          }
        }
      }

      // Bullets are less affected by noise/damping
      if (!p.isBullet) {
        // Apply Curl Noise for organic movement
        const curl = computeCurl(p.position.x * 0.3, p.position.y * 0.3, p.position.z * 0.3);
        p.velocity.add(curl.multiplyScalar(delta * 5.0 * curlInfluence));
        p.velocity.multiplyScalar(0.96); // Damping/Drag
      } else {
        // Collision detection for bullets
        // Only check if it hits ME
        if (p.ownerId !== myId) {
          const distToMe = p.position.distanceTo(myPos);
          if (distToMe < 1.5) {
            takeDamage(2, p.ownerId || '');
            p.active = false;
            continue;
          }
        }
      }

      // Apply Player Target Attraction (Shooting/Focusing Mechanic)
      // This logic is currently commented out/unused in favor of the Accelerator object mechanic,
      // but kept for reference if we want to re-enable "beam" mode.
      
      /*
      if (!p.isBullet && mousePosRef.current && myColor) {
         const isCharging = useGameStore.getState().isCharging;
         if (isCharging) {
            // ... logic to pull particles to cursor ...
         }
      }
      */
      
      // Real implementation of Target Attraction (if needed):
      const players = useGameStore.getState().players;
      
      // Handle MY target attraction (if I am charging)
      const amICharging = useGameStore.getState().isCharging;
      if (amICharging && mousePosRef.current) {
        const target = mousePosRef.current;
        const dir = new THREE.Vector3().subVectors(target, p.position);
        const dist = dir.length();
        if (dist > 0.1) {
          dir.normalize();
          // Strong pull towards cursor
          const strength = 80.0; 
          p.velocity.add(dir.multiplyScalar(strength * delta));
        }
      }

      // Handle OTHER players target attraction
      Object.values(players).forEach(player => {
        if (player.id !== myId && player.isCharging && player.targetPosition) {
           const target = new THREE.Vector3(player.targetPosition.x, player.targetPosition.y, player.targetPosition.z);
           const dir = new THREE.Vector3().subVectors(target, p.position);
           const dist = dir.length();
           if (dist > 0.1) {
             dir.normalize();
             const strength = 80.0;
             p.velocity.add(dir.multiplyScalar(strength * delta));
           }
        }
      });

      // Move particle
      p.position.addScaledVector(p.velocity, delta);

      // Color shift based on life (fade to ember color)
      const lifeRatio = p.life / (p.isBullet ? 2.0 : PARTICLE_LIFETIME);
      p.color.copy(p.baseColor);
      if (!p.isBullet) {
        p.color.lerp(emberColor, Math.pow(1 - lifeRatio, 2));
      }

      // Update instanced mesh matrix
      dummy.position.copy(p.position);
      const speed = p.velocity.length();
      const scale = lifeRatio * (p.isBullet ? 0.3 : 0.16);
      // Stretch particles based on speed for "motion blur" effect
      const stretch = Math.min(6, Math.max(1, speed * 0.15));
      dummy.scale.set(scale, scale, scale * stretch);

      // Orient along velocity vector
      if (speed > 0.01) {
        const dir = p.velocity.clone().normalize();
        quaternion.setFromUnitVectors(up, dir);
        dummy.quaternion.copy(quaternion);
      }

      dummy.updateMatrix();

      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, p.color);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} key={maxParticles} args={[undefined, undefined, maxParticles]}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial 
        map={particleTexture}
        transparent 
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
