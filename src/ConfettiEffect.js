/**
 * 3D Confetti Effect for celebration animations
 * Triggered when NFT mint is confirmed
 */

import * as THREE from 'three';

export class ConfettiEffect {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.particleGroup = null;
    this.isActive = false;
    this.startTime = 0;
    this.duration = 4000; // 4 seconds
    
    // Solana-themed colors
    this.colors = [
      0x00FFA3, // Solana green
      0xDC1FFF, // Solana purple
      0x03E1FF, // Cyan
      0xFFD700, // Gold
      0xFF6B6B, // Coral
      0xFFFFFF, // White
    ];
  }

  /**
   * Create confetti particles
   * @param {THREE.Vector3} origin - Center point for explosion
   * @param {number} count - Number of particles
   */
  create(origin = new THREE.Vector3(0, 0, 0), count = 200) {
    // Clean up any existing particles
    this.dispose();

    this.particleGroup = new THREE.Group();
    this.particles = [];
    
    // Create particle geometries
    const shapes = [
      new THREE.PlaneGeometry(0.05, 0.05),
      new THREE.PlaneGeometry(0.03, 0.08),
      new THREE.CircleGeometry(0.02, 6),
    ];

    for (let i = 0; i < count; i++) {
      // Random shape and color
      const geometry = shapes[Math.floor(Math.random() * shapes.length)].clone();
      const color = this.colors[Math.floor(Math.random() * this.colors.length)];
      
      const material = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1
      });

      const particle = new THREE.Mesh(geometry, material);
      
      // Start position near origin with slight randomness
      particle.position.copy(origin);
      particle.position.x += (Math.random() - 0.5) * 0.5;
      particle.position.y += (Math.random() - 0.5) * 0.5;
      particle.position.z += (Math.random() - 0.5) * 0.5;

      // Random rotation
      particle.rotation.x = Math.random() * Math.PI * 2;
      particle.rotation.y = Math.random() * Math.PI * 2;
      particle.rotation.z = Math.random() * Math.PI * 2;

      // Store velocity and rotation speed in userData
      particle.userData = {
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.15,
          Math.random() * 0.12 + 0.05, // Mostly upward
          (Math.random() - 0.5) * 0.15
        ),
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2
        ),
        gravity: -0.003,
        drag: 0.98
      };

      this.particles.push(particle);
      this.particleGroup.add(particle);
    }

    this.scene.add(this.particleGroup);
    this.isActive = true;
    this.startTime = Date.now();
  }

  /**
   * Update particle positions (call in animation loop)
   */
  update() {
    if (!this.isActive || !this.particleGroup) return;

    const elapsed = Date.now() - this.startTime;
    const progress = elapsed / this.duration;

    if (progress >= 1) {
      this.dispose();
      return;
    }

    for (const particle of this.particles) {
      const data = particle.userData;

      // Apply velocity
      particle.position.add(data.velocity);

      // Apply gravity
      data.velocity.y += data.gravity;

      // Apply drag
      data.velocity.multiplyScalar(data.drag);

      // Apply rotation
      particle.rotation.x += data.rotationSpeed.x;
      particle.rotation.y += data.rotationSpeed.y;
      particle.rotation.z += data.rotationSpeed.z;

      // Fade out near end
      if (progress > 0.7) {
        const fadeProgress = (progress - 0.7) / 0.3;
        particle.material.opacity = 1 - fadeProgress;
      }
    }
  }

  /**
   * Trigger confetti burst
   * @param {THREE.Vector3} position - Optional center position
   */
  burst(position) {
    this.create(position || new THREE.Vector3(0, 1, 0), 250);
  }

  /**
   * Clean up particles
   */
  dispose() {
    if (this.particleGroup) {
      // Dispose geometries and materials
      for (const particle of this.particles) {
        particle.geometry.dispose();
        particle.material.dispose();
      }
      
      this.scene.remove(this.particleGroup);
      this.particleGroup = null;
    }
    
    this.particles = [];
    this.isActive = false;
  }
}

/**
 * Create "Certified on Solana" badge texture
 * @returns {THREE.Texture} Badge texture
 */
export function createCertifiedBadge() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#00FFA3');
  gradient.addColorStop(1, '#DC1FFF');
  
  // Rounded rectangle
  ctx.fillStyle = gradient;
  roundRect(ctx, 10, 10, canvas.width - 20, canvas.height - 20, 20);
  ctx.fill();

  // Text
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 36px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✓ CERTIFIED ON SOLANA', canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  
  return texture;
}

/**
 * Create a 3D badge mesh
 * @returns {THREE.Mesh} Badge mesh
 */
export function createCertifiedBadgeMesh() {
  const texture = createCertifiedBadge();
  
  const geometry = new THREE.PlaneGeometry(1.5, 0.375);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide
  });

  const badge = new THREE.Mesh(geometry, material);
  badge.name = 'certifiedBadge';
  
  return badge;
}

// Helper for rounded rectangle
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
