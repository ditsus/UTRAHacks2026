/**
 * 3D Blink Card with QR Code for Solana Actions
 * Uses CSS3DRenderer for floating UI in Three.js
 */

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import QRCode from 'qrcode';

export class SolanaBlink {
  constructor(scene, camera, container) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    
    this.css3DRenderer = null;
    this.blinkCard = null;
    this.qrCodeObject = null;
    this.isVisible = false;
    this.targetPosition = new THREE.Vector3();
    this.currentPosition = new THREE.Vector3();
    
    this.init();
  }

  init() {
    // Create CSS3D renderer
    this.css3DRenderer = new CSS3DRenderer();
    this.css3DRenderer.setSize(window.innerWidth, window.innerHeight);
    this.css3DRenderer.domElement.style.position = 'absolute';
    this.css3DRenderer.domElement.style.top = '0';
    this.css3DRenderer.domElement.style.left = '0';
    this.css3DRenderer.domElement.style.pointerEvents = 'none';
    this.css3DRenderer.domElement.style.zIndex = '100';
    this.container.appendChild(this.css3DRenderer.domElement);

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.css3DRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Generate QR code as data URL
   * @param {string} url - URL to encode
   * @returns {Promise<string>} Data URL of QR code
   */
  async generateQRCode(url) {
    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'H'
      });
      return qrDataUrl;
    } catch (error) {
      console.error('QR Code generation failed:', error);
      return null;
    }
  }

  /**
   * Create the floating Blink card
   * @param {string} blinkUrl - The Blink URL
   * @param {Object} metadata - Robot metadata
   */
  async createBlinkCard(blinkUrl, metadata) {
    // Remove existing card
    this.removeBlinkCard();

    // Generate QR code
    const qrCodeDataUrl = await this.generateQRCode(blinkUrl);

    // Create card HTML element
    const cardElement = document.createElement('div');
    cardElement.className = 'blink-card';
    cardElement.innerHTML = `
      <div class="blink-card-inner">
        <div class="blink-header">
          <div class="solana-logo">
            <svg viewBox="0 0 128 128" width="24" height="24">
              <defs>
                <linearGradient id="solanaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#00FFA3"/>
                  <stop offset="100%" style="stop-color:#DC1FFF"/>
                </linearGradient>
              </defs>
              <path fill="url(#solanaGrad)" d="M93.94 42.63H41.78c-1.37 0-2.67.54-3.64 1.51l-13.2 13.2c-.47.47-.47 1.23 0 1.7l13.2 13.2c.97.97 2.27 1.51 3.64 1.51h52.16c1.37 0 2.67-.54 3.64-1.51l13.2-13.2c.47-.47.47-1.23 0-1.7l-13.2-13.2c-.97-.97-2.27-1.51-3.64-1.51z"/>
            </svg>
          </div>
          <span class="blink-title">MINT ROBOT</span>
        </div>
        
        <div class="blink-qr">
          <img src="${qrCodeDataUrl}" alt="Scan to mint" />
        </div>
        
        <div class="blink-info">
          <div class="blink-name">${metadata.name}</div>
          <div class="blink-parts">${metadata.attributes?.find(a => a.trait_type === 'Total Parts')?.value || 0} Parts</div>
          <div class="blink-cost">
            <span class="sol-icon">◎</span>
            <span>0.01 SOL</span>
          </div>
        </div>
        
        <div class="blink-footer">
          <div class="scan-text">Scan with Solana Wallet</div>
          <div class="powered-by">Powered by Solana Actions</div>
        </div>
        
        <div class="blink-glow"></div>
      </div>
    `;

    // Add styles
    this.injectStyles();

    // Create CSS3D object
    this.blinkCard = new CSS3DObject(cardElement);
    this.blinkCard.scale.set(0.003, 0.003, 0.003); // Smaller scale for 3D world
    
    this.scene.add(this.blinkCard);
    this.isVisible = true;

    return this.blinkCard;
  }

  /**
   * Inject CSS styles for the blink card
   */
  injectStyles() {
    if (document.getElementById('blink-card-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'blink-card-styles';
    styles.textContent = `
      .blink-card {
        width: 180px;
        perspective: 1000px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      
      .blink-card-inner {
        position: relative;
        background: linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        border-radius: 12px;
        padding: 12px;
        box-shadow: 
          0 0 20px rgba(0, 255, 163, 0.3),
          0 0 40px rgba(220, 31, 255, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }
      
      .blink-glow {
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: conic-gradient(
          from 0deg,
          transparent,
          rgba(0, 255, 163, 0.1),
          transparent,
          rgba(220, 31, 255, 0.1),
          transparent
        );
        animation: rotate 4s linear infinite;
        pointer-events: none;
      }
      
      @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .blink-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
      }
      
      .solana-logo {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .blink-title {
        font-size: 10px;
        font-weight: 700;
        color: #00FFA3;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      
      .blink-qr {
        background: white;
        border-radius: 8px;
        padding: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 8px;
      }
      
      .blink-qr img {
        width: 120px;
        height: 120px;
        display: block;
      }
      
      .blink-info {
        text-align: center;
        margin-bottom: 8px;
      }
      
      .blink-name {
        font-size: 11px;
        font-weight: 600;
        color: #ffffff;
        margin-bottom: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .blink-parts {
        font-size: 9px;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 6px;
      }
      
      .blink-cost {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: linear-gradient(135deg, #00FFA3, #DC1FFF);
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 700;
        color: #000;
      }
      
      .sol-icon {
        font-size: 12px;
      }
      
      .blink-footer {
        text-align: center;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .scan-text {
        font-size: 8px;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 2px;
      }
      
      .powered-by {
        font-size: 7px;
        color: rgba(255, 255, 255, 0.4);
        letter-spacing: 0.5px;
      }
      
      .blink-card-inner::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(0, 255, 163, 0.5), rgba(220, 31, 255, 0.5), transparent);
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Update card position - fixed on right side of screen
   * @param {THREE.Vector3} worldPosition - Ignored, card is fixed position
   */
  updatePosition(worldPosition) {
    if (!this.blinkCard || !this.isVisible) return;

    // Fixed position on right side of screen
    // Convert screen coords (right side, center height) to world space
    const rightSideX = 0.75; // 75% from left = right side
    const centerY = 0.5;     // Center vertically
    
    // Project to world coordinates at a fixed distance from camera
    const vector = new THREE.Vector3(
      (rightSideX * 2) - 1,  // Convert 0-1 to -1 to 1 (NDC)
      -(centerY * 2) + 1,    // Convert 0-1 to 1 to -1 (NDC, Y is flipped)
      0.5                     // Middle of frustum
    );
    vector.unproject(this.camera);
    
    // Get direction from camera and place at fixed distance
    const dir = vector.sub(this.camera.position).normalize();
    const distance = 3; // Fixed distance from camera
    
    this.targetPosition.copy(this.camera.position).add(dir.multiplyScalar(distance));
  }

  /**
   * Animate the card (call in render loop)
   */
  update() {
    if (!this.blinkCard || !this.isVisible) return;

    // Smooth follow to target
    this.currentPosition.lerp(this.targetPosition, 0.15);
    this.blinkCard.position.copy(this.currentPosition);

    // Always face camera
    this.blinkCard.lookAt(this.camera.position);

    // Render CSS3D
    this.css3DRenderer.render(this.scene, this.camera);
  }

  /**
   * Show the blink card with animation
   */
  show() {
    if (this.blinkCard) {
      this.isVisible = true;
      this.blinkCard.visible = true;
    }
  }

  /**
   * Hide the blink card
   */
  hide() {
    if (this.blinkCard) {
      this.isVisible = false;
      this.blinkCard.visible = false;
    }
  }

  /**
   * Remove the blink card from scene
   */
  removeBlinkCard() {
    if (this.blinkCard) {
      this.scene.remove(this.blinkCard);
      this.blinkCard = null;
    }
    this.isVisible = false;
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.removeBlinkCard();
    if (this.css3DRenderer && this.css3DRenderer.domElement) {
      this.css3DRenderer.domElement.remove();
    }
  }
}
