/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGameStore } from '../store/useGameStore';
import { Particles } from './Particles';
import { ForceFields } from './ForceFields';
import { OtherPlayers, LocalCursor } from './OtherPlayers';

const ARENA_HALF_SIZE = 25;

/**
 * Handles user input and updates the game state.
 * This component doesn't render anything visible itself.
 */
function SceneInteraction({ mousePosRef, playerPosRef }: { mousePosRef: React.MutableRefObject<THREE.Vector3 | null>, playerPosRef: React.MutableRefObject<THREE.Vector3> }) {
  const sendCursor = useGameStore((state) => state.sendCursor);
  const addForce = useGameStore((state) => state.addForce);
  const fire = useGameStore((state) => state.fire);
  const isCharging = useGameStore((state) => state.isCharging);
  const { camera, gl } = useThree();
  
  const keys = useRef<Record<string, boolean>>({});

  // --- Keyboard Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    // Focus window on mount to ensure keyboard events are captured immediately
    window.focus();
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Game Loop (Input Processing) ---
  useFrame((state, delta) => {
    // Movement speed
    const speed = 20 * delta;
    
    // Update local player position based on WASD keys
    if (keys.current['KeyW']) playerPosRef.current.y += speed;
    if (keys.current['KeyS']) playerPosRef.current.y -= speed;
    if (keys.current['KeyA']) playerPosRef.current.x -= speed;
    if (keys.current['KeyD']) playerPosRef.current.x += speed;

    // Clamp to arena boundaries
    playerPosRef.current.x = Math.max(-ARENA_HALF_SIZE, Math.min(ARENA_HALF_SIZE, playerPosRef.current.x));
    playerPosRef.current.y = Math.max(-ARENA_HALF_SIZE, Math.min(ARENA_HALF_SIZE, playerPosRef.current.y));

    // Update store with player position and charging state
    // We send the mouse position as the "targetPosition" for aiming
    sendCursor(
      { x: playerPosRef.current.x, y: playerPosRef.current.y, z: playerPosRef.current.z }, 
      isCharging,
      mousePosRef.current ? { x: mousePosRef.current.x, y: mousePosRef.current.y, z: mousePosRef.current.z } : null
    );
  });

  // --- Mouse/Pointer Input Handling ---
  useEffect(() => {
    // Create a plane at z=0 to intersect with the mouse ray
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // Converts 2D screen coordinates to 3D world coordinates on the z=0 plane
    const updateMousePos = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      // Normalize mouse coordinates to -1 to +1
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      mousePosRef.current = target;
      return target;
    };

    const handlePointerMove = (e: PointerEvent) => {
      updateMousePos(e.clientX, e.clientY);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        useGameStore.setState({ isCharging: true });
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 0) {
        useGameStore.setState({ isCharging: false });
        // Left click release: Place an accelerator at mouse position to blast enemies
        if (mousePosRef.current) {
          addForce({ x: mousePosRef.current.x, y: mousePosRef.current.y, z: mousePosRef.current.z }, 'accelerator');
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      const currentMultiplier = useGameStore.getState().scatterMultiplier;
      // Scroll up -> decrease scatter (more focused)
      // Scroll down -> increase scatter (more spread)
      const newMultiplier = Math.max(0.1, Math.min(5.0, currentMultiplier + (e.deltaY > 0 ? 0.2 : -0.2)));
      useGameStore.getState().setScatterMultiplier(newMultiplier);
    };

    const handleContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('wheel', handleWheel);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [camera, gl, sendCursor, fire, mousePosRef, isCharging]);

  return null;
}

/**
 * Renders a rotating background field of stars.
 */
function RotatingStars() {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.02;
      groupRef.current.rotation.x += delta * 0.01;
    }
  });

  return (
    <group ref={groupRef}>
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
    </group>
  );
}

/**
 * Renders a visible arena boundary.
 */
function ArenaBoundary() {
  const meshRef = useRef<THREE.LineLoop>(null);

  const geometry = useMemo(() => {
    const s = ARENA_HALF_SIZE;
    const points = [
      new THREE.Vector3(-s, -s, 0),
      new THREE.Vector3(s, -s, 0),
      new THREE.Vector3(s, s, 0),
      new THREE.Vector3(-s, s, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, []);

  return (
    <lineLoop ref={meshRef} geometry={geometry}>
      <lineBasicMaterial color="#1a1a3a" />
    </lineLoop>
  );
}

/**
 * Main Game Scene Component.
 * Sets up the Canvas, Lights, Post-processing, and Game Objects.
 */
export function CosmicCanvas() {
  // Refs to share mutable state between components without re-rendering
  const mousePosRef = useRef<THREE.Vector3 | null>(null);
  const playerPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));

  return (
    <div className="w-full h-full absolute inset-0 bg-black">
      <Canvas camera={{ position: [0, 0, 40], fov: 60 }}>
        <color attach="background" args={['#050510']} />
        
        <ambientLight intensity={0.2} />
        
        <RotatingStars />
        
        {/* Game Objects */}
        <Particles mousePosRef={mousePosRef} playerPosRef={playerPosRef} />
        <ForceFields />
        <OtherPlayers />
        <LocalCursor playerPosRef={playerPosRef} />
        <ArenaBoundary />
        
        {/* Logic Controller */}
        <SceneInteraction mousePosRef={mousePosRef} playerPosRef={playerPosRef} />
        
        {/* Post Processing */}
        <EffectComposer>
          <Bloom luminanceThreshold={0.2} mipmapBlur intensity={1.5} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
