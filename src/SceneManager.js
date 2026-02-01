/**
 * SceneManager - Three.js 3D scene with GLTF/GLB loading
 * Handles model Group rotation/zoom via gesture input with lerp smoothing.
 * Integrates Solana Actions/Blinks for NFT minting.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SolanaBlink } from './SolanaBlink.js';
import { ConfettiEffect, createCertifiedBadgeMesh } from './ConfettiEffect.js';
import { 
  generateRobotMetadata, 
  createActionPayload, 
  generateBlinkUrl, 
  getAssemblyData,
  captureSceneSnapshot,
  MINT_COST_SOL
} from './solanaAction.js';

export class SceneManager {
  constructor(container, options = {}) {
    this.container = container;
    this.smoothingFactor = options.smoothingFactor ?? 0.12;
    this.zoomSensitivity = options.zoomSensitivity ?? 2;
    this.baseCameraZ = options.baseCameraZ ?? 5;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.contentGroup = null; // rotates: grid + model
    this.modelGroup = null;
    this.gridHelper = null;
    this.gltfLoader = null;
    this.dracoLoader = null;

    // Smoothed targets (lerp)
    this.targetRotationX = 0;
    this.targetRotationY = 0;
    this.targetZoom = 1;
    this.currentRotationX = 0;
    this.currentRotationY = 0;
    this.currentZoom = 1;
    this.baseY = null;
    this.baseZoom = null;
    this.baseRotationX = null;
    this.baseRotationY = null;
    this.startRotationX = 0;
    this.startRotationY = 0;
    this.pinchFrames = 0; // frames since pinch started

    // Assembly Mode state
    this.assemblyMode = false;
    this.assemblyItems = []; // sidebar 3D items (Servo, Wheel)
    this.heldItem = null; // currently grabbed item
    this.attachedParts = []; // parts attached to the model
    this.snapDistance = 1.5; // distance threshold for snapping (increased)
    this.rotationSensitivity = 3; // must match HandController
    this.handCursor = null; // 3D cursor showing hand position
    this.assemblyModeEnterTime = 0; // timestamp when assembly mode was entered
    this.grabCooldown = 500; // ms to wait before allowing grab after entering assembly mode
    
    // Fixed screen positions for assembly items (right side)
    this.servoScreenPos = { x: 0.85, y: 0.35 }; // normalized screen coords
    this.wheelScreenPos = { x: 0.85, y: 0.65 };
    
    // Mouse control state
    this.isDragging = false;
    this.previousMouseX = 0;
    this.previousMouseY = 0;
    
    // Part selection state (for moving attached parts with keyboard)
    this.selectedPart = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.moveSpeed = 0.05; // Speed for arrow key movement
    
    // Delete tracking (for pinch-to-delete attached parts)
    this.deleteCandidatePart = null;
    this.deleteHoldFrames = 0;
    
    // Require pinch release before allowing grab (prevents auto-grab on mode entry)
    this.hasPinchReleased = false;

    // Solana Blink / NFT Minting state
    this.solanaBlink = null;
    this.confettiEffect = null;
    this.mintingState = {
      isActive: false,           // Blink card is showing
      isProcessing: false,       // Waiting for transaction
      isCertified: false,        // NFT minted, model locked
      blinkUrl: null,
      metadata: null,
      certifiedBadge: null
    };
    this.currentModelName = 'Robot Assembly';
  }

  lerp(a, b, t) {
    return a + (b - a) * Math.min(1, t);
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd0d0d0); // Light gray
    this.scene.fog = new THREE.Fog(0xd0d0d0, 5, 20);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    this.camera.position.set(0, 0, this.baseCameraZ);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // Environment map (gradient-like reflection)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0xc0c0c0); // Light gray for reflections
    this.scene.environment = pmrem.fromScene(envScene).texture;
    pmrem.dispose();

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 8, 5);
    this.scene.add(dir);

    // Content group: grid + model rotate together
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);

    // Grid helper
    this.gridHelper = new THREE.GridHelper(10, 20, 0x333355, 0x222244);
    this.gridHelper.position.y = -2;
    this.contentGroup.add(this.gridHelper);

    // Model Group - contains loaded model
    this.modelGroup = new THREE.Group();
    this.modelGroup.position.y = 0;
    this.contentGroup.add(this.modelGroup);

    // GLTFLoader with DRACO support
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    // Load default robotic car GLB
    this.loadGLB('/robotic-car.glb');

    window.addEventListener('resize', () => this.onResize());
    
    // Mouse controls
    this.setupMouseControls();
    
    // Initialize Solana Blink and Confetti
    this.solanaBlink = new SolanaBlink(this.scene, this.camera, this.container);
    this.confettiEffect = new ConfettiEffect(this.scene);
    
    return this;
  }

  /**
   * Update from gesture data (call each frame)
   */
  updateFromGesture(gesture, delta = 0.016) {
    if (!this.contentGroup) return;

    const t = this.smoothingFactor;

    if (gesture.isPinching) {
      this.pinchFrames++;
      // Left half: pinch → zoom (up/down). Right half: pinch → rotate
      if (gesture.pinchZone === 'rotate') {
        // Wait a few frames for hand to stabilize before capturing baseline
        if (this.pinchFrames > 5 && this.baseRotationX === null) {
          this.baseRotationX = gesture.rotationX;
          this.baseRotationY = gesture.rotationY;
          this.startRotationX = this.currentRotationX;
          this.startRotationY = this.currentRotationY;
        }
        if (this.baseRotationX !== null) {
          // Rotation based on movement from pinch start position
          const deltaX = gesture.rotationX - this.baseRotationX;
          const deltaY = gesture.rotationY - this.baseRotationY;
          this.targetRotationX = this.startRotationX + deltaX;
          this.targetRotationY = this.startRotationY + deltaY;
        }
      } else if (gesture.pinchZone === 'zoom') {
        // Wait a few frames for hand to stabilize before capturing baseline
        if (this.pinchFrames > 5 && this.baseY === null) {
          this.baseY = gesture.centroidY;
          this.baseZoom = this.currentZoom;
        }
        if (this.baseY !== null) {
          // Move hand up = zoom in, move hand down = zoom out
          const yDelta = this.baseY - gesture.centroidY;
          const zoomFactor = 1 + yDelta * 3;
          this.targetZoom = Math.max(0.3, Math.min(3, this.baseZoom * zoomFactor));
        }
      }
    } else {
      this.baseY = null;
      this.baseZoom = null;
      this.baseRotationX = null;
      this.baseRotationY = null;
      this.pinchFrames = 0;
    }

    // Lerp rotation and zoom
    this.currentRotationX = this.lerp(this.currentRotationX, this.targetRotationX, t);
    this.currentRotationY = this.lerp(this.currentRotationY, this.targetRotationY, t);
    this.currentZoom = this.lerp(this.currentZoom, this.targetZoom, t);

    this.contentGroup.rotation.x = this.currentRotationX;
    this.contentGroup.rotation.y = this.currentRotationY;
    this.contentGroup.scale.setScalar(this.currentZoom);

    // Optional: also move camera for zoom feel
    const targetZ = this.baseCameraZ / this.currentZoom;
    this.camera.position.z = this.lerp(this.camera.position.z, targetZ, t);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Load GLB/GLTF and replace model in modelGroup
   * @param {string|File} urlOrFile - URL string (e.g. '/model.glb') or File from input
   */
  loadGLB(urlOrFile) {
    if (!urlOrFile) return;
    const url = typeof urlOrFile === 'string' ? urlOrFile : URL.createObjectURL(urlOrFile);

    this.gltfLoader.load(
      url,
      (gltf) => {
        if (typeof urlOrFile !== 'string') URL.revokeObjectURL(url);

        while (this.modelGroup.children.length > 0) {
          const child = this.modelGroup.children[0];
          this.modelGroup.remove(child);
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
          if (child.children) {
            child.traverse((c) => {
              if (c.geometry) c.geometry.dispose();
              if (c.material) {
                if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
                else c.material.dispose();
              }
            });
          }
        }

        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        model.position.sub(center);
        model.scale.setScalar(scale);
        this.modelGroup.add(model);
        this.baseY = null;
      },
      undefined,
      (err) => {
        if (typeof urlOrFile !== 'string') URL.revokeObjectURL(url);
        console.error('GLB load error:', err);
      }
    );
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // ========== MOUSE CONTROLS ==========

  /**
   * Setup mouse controls for rotating, zooming, and part selection
   */
  setupMouseControls() {
    const canvas = this.renderer.domElement;
    let mouseDownPos = { x: 0, y: 0 };
    let didDrag = false;

    // Mouse down - start potential drag
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDragging = true;
      didDrag = false;
      this.previousMouseX = e.clientX;
      this.previousMouseY = e.clientY;
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    // Mouse move - rotate if dragging (use window to catch moves outside canvas)
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const deltaX = e.clientX - this.previousMouseX;
      const deltaY = e.clientY - this.previousMouseY;
      
      // Check if we've moved enough to count as a drag
      const totalMove = Math.abs(e.clientX - mouseDownPos.x) + Math.abs(e.clientY - mouseDownPos.y);
      if (totalMove > 5) didDrag = true;
      
      // Update rotation targets
      this.targetRotationY += deltaX * 0.01;
      this.targetRotationX += deltaY * 0.01;
      
      this.previousMouseX = e.clientX;
      this.previousMouseY = e.clientY;
    });

    // Mouse up - stop dragging, check for click
    window.addEventListener('mouseup', (e) => {
      if (this.isDragging && !didDrag && this.assemblyMode) {
        // This was a click, not a drag - try to select a part
        this.trySelectPart(mouseDownPos.x, mouseDownPos.y);
      }
      this.isDragging = false;
    });

    // Scroll - zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      const zoomDelta = e.deltaY * 0.001;
      this.targetZoom = Math.max(0.3, Math.min(3, this.targetZoom - zoomDelta));
    }, { passive: false });

    // Keyboard controls for moving selected part
    window.addEventListener('keydown', (e) => {
      if (!this.assemblyMode || !this.selectedPart) return;
      
      const speed = this.moveSpeed;
      
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this.selectedPart.position.y += speed;
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.selectedPart.position.y -= speed;
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.selectedPart.position.x -= speed;
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.selectedPart.position.x += speed;
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          this.selectedPart.position.z -= speed; // Forward (into screen)
          break;
        case 's':
        case 'S':
          e.preventDefault();
          this.selectedPart.position.z += speed; // Backward (out of screen)
          break;
        case 'Escape':
          this.deselectPart();
          break;
      }
    });
  }

  /**
   * Try to select an attached part at the given screen position
   */
  trySelectPart(screenX, screenY) {
    if (this.attachedParts.length === 0) {
      this.deselectPart();
      return;
    }
    
    // Convert screen coordinates to normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    // Raycast to find clicked objects - check all attached parts and their children
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Get all meshes from attached parts
    const meshes = [];
    for (const part of this.attachedParts) {
      part.traverse((child) => {
        if (child.isMesh) {
          child.userData.parentPart = part; // Store reference to parent part
          meshes.push(child);
        }
      });
    }
    
    const intersects = this.raycaster.intersectObjects(meshes, false);
    
    if (intersects.length > 0) {
      // Get the parent part from the clicked mesh
      const clickedMesh = intersects[0].object;
      const part = clickedMesh.userData.parentPart;
      
      if (part && this.attachedParts.includes(part)) {
        this.selectPart(part);
        return;
      }
    }
    
    // Clicked on nothing - deselect
    this.deselectPart();
  }

  /**
   * Select a part for keyboard movement
   */
  selectPart(part) {
    // Deselect previous
    this.deselectPart();
    
    this.selectedPart = part;
    
    // Add selection highlight (yellow emissive)
    part.traverse((child) => {
      if (child.material) {
        child.userData.originalEmissive = child.material.emissive?.clone();
        if (child.material.emissive) {
          child.material.emissive.setHex(0xffff00);
          child.material.emissiveIntensity = 0.3;
        }
      }
    });
  }

  /**
   * Deselect the currently selected part
   */
  deselectPart() {
    if (!this.selectedPart) return;
    
    // Restore original appearance
    this.selectedPart.traverse((child) => {
      if (child.material && child.userData.originalEmissive) {
        child.material.emissive.copy(child.userData.originalEmissive);
        child.material.emissiveIntensity = 0;
      } else if (child.material && child.material.emissive) {
        child.material.emissive.setHex(0x000000);
        child.material.emissiveIntensity = 0;
      }
    });
    
    this.selectedPart = null;
  }

  // ========== ASSEMBLY MODE ==========

  /**
   * Enter Assembly Mode - freeze model, show sidebar items
   */
  enterAssemblyMode() {
    this.assemblyMode = true;
    this.assemblyModeEnterTime = Date.now(); // Track when we entered for grab cooldown
    
    // Freeze current rotation/zoom values to prevent drift
    this.targetRotationX = this.currentRotationX;
    this.targetRotationY = this.currentRotationY;
    this.targetZoom = this.currentZoom;
    
    // Reset gesture tracking state
    this.baseY = null;
    this.baseZoom = null;
    this.baseRotationX = null;
    this.baseRotationY = null;
    this.pinchFrames = 0;
    
    // Reset assembly state
    this.heldItem = null;
    this.deleteCandidatePart = null;
    this.deleteHoldFrames = 0;
    this.hasPinchReleased = false; // Must release pinch before grabbing
    
    this.createAssemblyItems();
    this.createHandCursor();
    return true;
  }

  /**
   * Exit Assembly Mode - hide sidebar items, unfreeze model
   */
  exitAssemblyMode() {
    this.assemblyMode = false;
    this.removeAssemblyItems();
    this.removeHandCursor();
    this.heldItem = null;
    this.deleteCandidatePart = null;
    this.deleteHoldFrames = 0;
    this.deselectPart(); // Deselect any selected part
    return false;
  }

  /**
   * Create hand cursor - visual indicator of hand position in 3D
   */
  createHandCursor() {
    if (this.handCursor) this.removeHandCursor();

    this.handCursor = new THREE.Group();

    // Outer ring
    const ringGeom = new THREE.RingGeometry(0.12, 0.15, 32);
    const ringMat = new THREE.MeshBasicMaterial({ 
      color: 0xff9900, // Orange for open hand
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    this.handCursor.add(ring);

    // Center dot
    const dotGeom = new THREE.CircleGeometry(0.04, 16);
    const dotMat = new THREE.MeshBasicMaterial({ 
      color: 0xff9900,
      transparent: true,
      opacity: 0.9
    });
    const dot = new THREE.Mesh(dotGeom, dotMat);
    this.handCursor.add(dot);

    // Crosshair lines
    const lineLen = 0.25;
    const positions = [
      [-lineLen, 0, 0, -0.18, 0, 0], // left
      [0.18, 0, 0, lineLen, 0, 0],   // right
      [0, -lineLen, 0, 0, -0.18, 0], // bottom
      [0, 0.18, 0, 0, lineLen, 0],   // top
    ];

    this.handCursor.userData.lines = [];
    positions.forEach((coords) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      const lineMat = new THREE.LineBasicMaterial({ color: 0xff9900, transparent: true, opacity: 0.6 });
      const line = new THREE.Line(geom, lineMat);
      this.handCursor.add(line);
      this.handCursor.userData.lines.push(line);
    });

    this.handCursor.userData.ringMat = ringMat;
    this.handCursor.userData.dotMat = dotMat;

    this.handCursor.position.set(0, 0, 2);
    this.scene.add(this.handCursor);
  }

  /**
   * Remove hand cursor from scene
   */
  removeHandCursor() {
    if (!this.handCursor) return;
    this.scene.remove(this.handCursor);
    this.handCursor.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.handCursor = null;
  }

  /**
   * Update hand cursor position and appearance
   * @param {number} handSize - Size of hand in frame for depth control
   */
  updateHandCursor(centroidX, centroidY, isPinching, hasHand, handSize = 0.3) {
    if (!this.handCursor) return;

    // Show/hide based on hand detection
    this.handCursor.visible = hasHand;
    if (!hasHand) return;

    // Map hand size to depth (same logic as held items)
    // Bigger hand (close to camera) = push cursor farther toward model
    const minHandSize = 0.15;
    const maxHandSize = 0.5;
    const normalizedSize = Math.max(0, Math.min(1, (handSize - minHandSize) / (maxHandSize - minHandSize)));
    const depth = 1.5 + normalizedSize * 4; // Range: 1.5 (far from camera) to 5.5 (toward model)

    // Update position
    const targetPos = this.handToWorld(centroidX, centroidY, depth);
    this.handCursor.position.lerp(targetPos, 0.3);

    // Change color based on pinch state: orange = open, magenta = pinching
    const color = isPinching ? 0xff00ff : 0xff9900;
    const scale = isPinching ? 0.8 : 1.0;
    
    this.handCursor.userData.ringMat.color.setHex(color);
    this.handCursor.userData.dotMat.color.setHex(color);
    this.handCursor.scale.setScalar(scale);

    // Update line colors
    this.handCursor.userData.lines.forEach((line) => {
      line.material.color.setHex(color);
    });
  }

  /**
   * Toggle Assembly Mode
   */
  toggleAssemblyMode() {
    if (this.assemblyMode) {
      return this.exitAssemblyMode();
    } else {
      return this.enterAssemblyMode();
    }
  }

  /**
   * Create the sidebar assembly items (Servo and Wheel)
   * Positioned to align with the white sidebar on the left
   */
  createAssemblyItems() {
    // Remove existing items first
    this.removeAssemblyItems();

    // Create Servo (small)
    const servoGroup = new THREE.Group();
    servoGroup.userData = { type: 'servo', isAssemblyItem: true, screenPos: this.servoScreenPos };
    
    const servoBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6, roughness: 0.4 })
    );
    servoGroup.add(servoBody);
    
    const servoHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 })
    );
    servoHub.position.set(0, 0.13, 0);
    servoGroup.add(servoHub);
    
    // Position will be updated by updateAssemblyItemPositions
    this.scene.add(servoGroup);
    this.assemblyItems.push(servoGroup);

    // Create Wheel (small)
    const wheelGroup = new THREE.Group();
    wheelGroup.userData = { type: 'wheel', isAssemblyItem: true, screenPos: this.wheelScreenPos };
    
    const wheelTire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.1, roughness: 0.9 })
    );
    wheelTire.rotation.x = Math.PI / 2;
    wheelGroup.add(wheelTire);
    
    const wheelHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 })
    );
    wheelHub.rotation.x = Math.PI / 2;
    wheelGroup.add(wheelHub);
    
    // Position will be updated by updateAssemblyItemPositions
    this.scene.add(wheelGroup);
    this.assemblyItems.push(wheelGroup);
    
    // Initialize positions
    this.updateAssemblyItemPositions();
  }

  /**
   * Convert screen coordinates (0-1) to world position at a fixed distance from camera
   */
  screenToWorld(screenX, screenY, distance = 3) {
    const vector = new THREE.Vector3(
      (screenX * 2) - 1,  // Convert 0-1 to -1 to 1
      -(screenY * 2) + 1, // Convert 0-1 to 1 to -1 (flip Y)
      0.5
    );
    vector.unproject(this.camera);
    const dir = vector.sub(this.camera.position).normalize();
    return this.camera.position.clone().add(dir.multiplyScalar(distance));
  }

  /**
   * Update assembly items to stick to fixed screen positions
   */
  updateAssemblyItemPositions() {
    for (const item of this.assemblyItems) {
      if (item.userData.isHeld) continue; // Don't update if being held
      const screenPos = item.userData.screenPos;
      if (screenPos) {
        const worldPos = this.screenToWorld(screenPos.x, screenPos.y, 3);
        item.position.copy(worldPos);
      }
    }
  }

  /**
   * Remove assembly items from scene
   */
  removeAssemblyItems() {
    for (const item of this.assemblyItems) {
      this.scene.remove(item);
      item.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.assemblyItems = [];
  }

  /**
   * Convert normalized hand coordinates (0-1) to 3D world position
   * Note: X is flipped to match the mirrored webcam display
   * @param {number} depth - Distance from camera (default 3, range ~1.5 to 5)
   */
  handToWorld(centroidX, centroidY, depth = 3) {
    // Flip X to match mirrored webcam (hand right = cursor right)
    const flippedX = 1 - centroidX;
    return this.screenToWorld(flippedX, centroidY, depth);
  }

  /**
   * Try to grab an assembly item at the given hand position
   * Grabs the closest item within range
   */
  tryGrabItem(centroidX, centroidY) {
    if (!this.assemblyMode || this.heldItem) return null;
    
    // Don't allow grabbing immediately after entering assembly mode
    if (Date.now() - this.assemblyModeEnterTime < this.grabCooldown) return null;

    const handPos = this.handToWorld(centroidX, centroidY);
    const grabRadius = 0.4; // Smaller grab area - must be closer to item
    
    // Find the closest item within grab range
    let closestItem = null;
    let closestDistance = Infinity;
    
    for (const item of this.assemblyItems) {
      const distance = item.position.distanceTo(handPos);
      if (distance < grabRadius && distance < closestDistance) {
        closestDistance = distance;
        closestItem = item;
      }
    }
    
    if (closestItem) {
      this.heldItem = closestItem;
      this.heldItem.userData.isHeld = true;
      return closestItem;
    }
    return null;
  }

  /**
   * Update held item position to follow hand
   * @param {number} handSize - Size of hand in frame (larger = closer to camera)
   */
  updateHeldItem(centroidX, centroidY, handSize = 0.3) {
    if (!this.heldItem) return;
    
    // Map hand size to depth
    // Hand size typically ranges from ~0.2 (far) to ~0.5 (close)
    // Larger hand (closer to camera) = object farther (toward model)
    // Smaller hand (farther from camera) = object closer (toward you)
    const minHandSize = 0.15;
    const maxHandSize = 0.5;
    const normalizedSize = Math.max(0, Math.min(1, (handSize - minHandSize) / (maxHandSize - minHandSize)));
    
    // Bigger hand (close to camera) = push object farther toward model
    const depth = 1.5 + normalizedSize * 4; // Range: 1.5 (far from camera) to 5.5 (toward model)
    
    const targetPos = this.handToWorld(centroidX, centroidY, depth);
    // Smooth follow
    this.heldItem.position.lerp(targetPos, 0.3);
  }

  /**
   * Get the bounding box of the model in world space
   */
  getModelBoundingBox() {
    const box = new THREE.Box3();
    if (this.modelGroup.children.length > 0) {
      box.setFromObject(this.modelGroup);
    }
    return box;
  }

  /**
   * Find the closest point on the model's bounding box to a given point
   */
  getClosestPointOnModel(point) {
    const box = this.getModelBoundingBox();
    if (box.isEmpty()) {
      // Fallback to model center
      const center = new THREE.Vector3();
      this.modelGroup.getWorldPosition(center);
      return center;
    }
    
    // Clamp point to bounding box
    const closest = new THREE.Vector3();
    closest.copy(point).clamp(box.min, box.max);
    return closest;
  }

  /**
   * Release held item - snap to model if close, otherwise return to sidebar
   */
  releaseItem() {
    if (!this.heldItem) return null;

    const item = this.heldItem;
    item.userData.isHeld = false;
    
    // Get model bounding box and check distance
    const box = this.getModelBoundingBox();
    const itemPos = item.position.clone();
    
    // Find closest point on model
    const closestPoint = this.getClosestPointOnModel(itemPos);
    const distance = itemPos.distanceTo(closestPoint);
    
    // More forgiving snap distance
    const maxSnapDistance = 3.0;
    
    if (distance < maxSnapDistance || !box.isEmpty()) {
      // Snap to model - attach at closest point
      const attachResult = this.attachToModel(item, closestPoint);
      this.heldItem = null;
      return attachResult;
    } else {
      // Return to original position
      this.returnToSidebar(item);
      this.heldItem = null;
      return null;
    }
  }

  /**
   * Attach item to the model group at a specific position
   */
  attachToModel(item, snapPoint = null) {
    // Remove from assembly items
    const idx = this.assemblyItems.indexOf(item);
    if (idx > -1) this.assemblyItems.splice(idx, 1);
    
    // Remove from scene
    this.scene.remove(item);
    
    // Determine final position
    let finalWorldPos;
    if (snapPoint) {
      finalWorldPos = snapPoint.clone();
    } else {
      finalWorldPos = item.position.clone();
    }
    
    // Convert world position to local model position
    const localPos = finalWorldPos.clone();
    this.modelGroup.worldToLocal(localPos);
    item.position.copy(localPos);
    
    // Add to model group so it rotates with the model
    this.modelGroup.add(item);
    item.userData.isAttached = true;
    this.attachedParts.push(item);
    
    // Create a new item of the same type in sidebar
    this.respawnSidebarItem(item.userData.type);
    
    return { type: item.userData.type, position: localPos };
  }

  /**
   * Return item to sidebar position (will be updated by updateAssemblyItemPositions)
   */
  returnToSidebar(item) {
    const type = item.userData.type;
    if (type === 'servo') {
      item.userData.screenPos = this.servoScreenPos;
    } else if (type === 'wheel') {
      item.userData.screenPos = this.wheelScreenPos;
    }
    item.userData.isHeld = false;
  }

  /**
   * Respawn a sidebar item after one is attached
   */
  respawnSidebarItem(type) {
    if (type === 'servo') {
      const servoGroup = new THREE.Group();
      servoGroup.userData = { type: 'servo', isAssemblyItem: true, screenPos: this.servoScreenPos };
      
      const servoBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.18, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6, roughness: 0.4 })
      );
      servoGroup.add(servoBody);
      
      const servoHub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16),
        new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 })
      );
      servoHub.position.set(0, 0.13, 0);
      servoGroup.add(servoHub);
      
      this.scene.add(servoGroup);
      this.assemblyItems.push(servoGroup);
    } else if (type === 'wheel') {
      const wheelGroup = new THREE.Group();
      wheelGroup.userData = { type: 'wheel', isAssemblyItem: true, screenPos: this.wheelScreenPos };
      
      const wheelTire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.1, roughness: 0.9 })
      );
      wheelTire.rotation.x = Math.PI / 2;
      wheelGroup.add(wheelTire);
      
      const wheelHub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 })
      );
      wheelHub.rotation.x = Math.PI / 2;
      wheelGroup.add(wheelHub);
      
      this.scene.add(wheelGroup);
      this.assemblyItems.push(wheelGroup);
    }
  }

  /**
   * Update from gesture - with assembly mode handling
   */
  updateAssemblyMode(gesture) {
    if (!this.assemblyMode) return;

    // Keep assembly items stuck to screen positions
    this.updateAssemblyItemPositions();

    const centroidX = (gesture.rotationY / this.rotationSensitivity) + 0.5; // Convert back to 0-1
    const centroidY = (gesture.rotationX / this.rotationSensitivity) + 0.5;
    
    // Use raw centroid from gesture if available
    const rawX = gesture.centroidX ?? centroidX;
    const rawY = gesture.centroidY ?? centroidY;

    // Update hand cursor position with depth control based on hand size
    this.updateHandCursor(rawX, rawY, gesture.isPinching, gesture.hasHand, gesture.handSize);

    if (gesture.isPinching) {
      // Only allow grabbing/deleting if pinch was released first
      if (this.hasPinchReleased) {
        if (!this.heldItem) {
          // First: always try to delete attached parts (priority)
          const deleted = this.tryDeleteAttachedPart(rawX, rawY, gesture.handSize);
          
          // If nothing was deleted, try to grab a sidebar item
          if (!deleted) {
            this.tryGrabItem(rawX, rawY);
          }
        } else {
          // Update held item position with depth control via hand size (distance from camera)
          this.updateHeldItem(rawX, rawY, gesture.handSize);
        }
      }
    } else {
      // Released pinch - now grabbing is allowed
      this.hasPinchReleased = true;
      
      if (this.heldItem) {
        this.releaseItem();
      }
      // Reset delete tracking when not pinching
      this.deleteCandidatePart = null;
    }
  }

  /**
   * Try to delete an attached part if hand is pinching directly on it
   * Uses screen-space comparison for better accuracy
   * @returns {boolean} true if a part was deleted
   */
  tryDeleteAttachedPart(centroidX, centroidY, handSize) {
    if (this.attachedParts.length === 0) return false;
    
    // Don't allow deleting immediately after entering assembly mode
    if (Date.now() - this.assemblyModeEnterTime < this.grabCooldown) return false;

    // Flip X to match mirrored display
    const flippedX = 1 - centroidX;
    
    // Find closest attached part using SCREEN position (2D comparison)
    let closestPart = null;
    let closestScreenDist = Infinity;
    const deleteScreenRadius = 0.15; // Screen-space radius (0-1 normalized)
    
    for (const part of this.attachedParts) {
      // Get world position of attached part
      const partWorldPos = new THREE.Vector3();
      part.getWorldPosition(partWorldPos);
      
      // Project to screen coordinates
      const screenPos = partWorldPos.clone().project(this.camera);
      // Convert from NDC (-1 to 1) to normalized (0 to 1)
      const partScreenX = (screenPos.x + 1) / 2;
      const partScreenY = 1 - (screenPos.y + 1) / 2; // Flip Y
      
      // Calculate 2D screen distance
      const dx = flippedX - partScreenX;
      const dy = centroidY - partScreenY;
      const screenDist = Math.sqrt(dx * dx + dy * dy);
      
      if (screenDist < deleteScreenRadius && screenDist < closestScreenDist) {
        closestScreenDist = screenDist;
        closestPart = part;
      }
    }
    
    if (closestPart) {
      // Immediately delete the part on pinch
      this.deleteAttachedPart(closestPart);
      return true;
    }
    return false;
  }

  /**
   * Delete an attached part from the model
   */
  deleteAttachedPart(part) {
    // Remove from attached parts array
    const idx = this.attachedParts.indexOf(part);
    if (idx > -1) this.attachedParts.splice(idx, 1);
    
    // If this was selected, deselect it
    if (this.selectedPart === part) {
      this.selectedPart = null;
    }
    
    // Remove from model group
    this.modelGroup.remove(part);
    
    // Dispose of geometry and materials
    part.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
  }

  // ============================================
  // SOLANA BLINK / NFT MINTING METHODS
  // ============================================

  /**
   * Trigger Solana mint flow (called on double-pinch hold)
   * @param {Object} handData - Hand position data
   */
  async triggerMintFlow(handData) {
    if (this.mintingState.isActive || this.mintingState.isCertified) {
      console.log('Mint flow already active or model already certified');
      return;
    }

    console.log('🚀 Triggering Solana mint flow...');
    this.mintingState.isActive = true;

    try {
      // Capture current assembly state
      const assemblyData = getAssemblyData(this);
      assemblyData.thumbnailBase64 = captureSceneSnapshot(this.renderer, this.scene, this.camera);

      // Generate metadata
      const metadata = generateRobotMetadata(assemblyData);
      this.mintingState.metadata = metadata;

      // Create Action payload
      const actionPayload = createActionPayload(metadata);
      
      // Generate Blink URL (for real use, this would point to your action server)
      // For demo, we'll create a local-style URL
      const actionUrl = `${window.location.origin}/api/actions/mint`;
      const blinkUrl = generateBlinkUrl(actionUrl);
      this.mintingState.blinkUrl = blinkUrl;

      console.log('📱 Blink URL:', blinkUrl);
      console.log('📦 Metadata:', metadata);

      // Create and show the 3D Blink card
      await this.solanaBlink.createBlinkCard(blinkUrl, metadata);
      
      // Position near hand
      const handWorldPos = this.handToWorld(handData.centroidX, handData.centroidY, 2);
      this.solanaBlink.updatePosition(handWorldPos);
      this.solanaBlink.show();

    } catch (error) {
      console.error('Failed to trigger mint flow:', error);
      this.mintingState.isActive = false;
    }
  }

  /**
   * Update Blink card position (call in render loop when minting)
   * @param {Object} gesture - Current gesture data
   */
  updateMintingFlow(gesture) {
    if (!this.mintingState.isActive) return;

    // Update blink card position to follow hand
    if (gesture.hasHand) {
      const handWorldPos = this.handToWorld(gesture.centroidX, gesture.centroidY, 2);
      this.solanaBlink.updatePosition(handWorldPos);
    }

    // Update the CSS3D renderer
    this.solanaBlink.update();

    // Update confetti if active
    if (this.confettiEffect) {
      this.confettiEffect.update();
    }
  }

  /**
   * Cancel the mint flow (e.g., on gesture to dismiss)
   */
  cancelMintFlow() {
    if (!this.mintingState.isActive) return;

    console.log('❌ Mint flow cancelled');
    this.mintingState.isActive = false;
    this.mintingState.blinkUrl = null;
    this.mintingState.metadata = null;
    this.solanaBlink.hide();
    this.solanaBlink.removeBlinkCard();
  }

  /**
   * Simulate transaction confirmation (for demo purposes)
   * In production, this would be called by webhook/websocket
   * @param {string} signature - Transaction signature
   */
  onMintConfirmed(signature = 'demo_signature') {
    if (!this.mintingState.isActive) return;

    console.log('✅ Mint confirmed! Signature:', signature);
    this.mintingState.isProcessing = false;
    this.mintingState.isCertified = true;

    // Hide blink card
    this.solanaBlink.hide();
    this.solanaBlink.removeBlinkCard();
    this.mintingState.isActive = false;

    // Trigger confetti celebration
    this.confettiEffect.burst(new THREE.Vector3(0, 1, 0));

    // Add "Certified on Solana" badge
    this.addCertifiedBadge();

    // Lock the model (disable further edits)
    this.lockModel();
  }

  /**
   * Add the "Certified on Solana" badge to the model
   */
  addCertifiedBadge() {
    const badge = createCertifiedBadgeMesh();
    
    // Position above the model
    badge.position.set(0, 2.5, 0);
    
    // Add floating animation
    badge.userData.floatOffset = 0;
    badge.userData.floatSpeed = 2;
    
    this.mintingState.certifiedBadge = badge;
    this.contentGroup.add(badge);
  }

  /**
   * Lock the model after certification (disable assembly mode)
   */
  lockModel() {
    // Exit assembly mode if active
    if (this.assemblyMode) {
      this.exitAssemblyMode();
    }

    // Apply certified material effect to all parts
    this.modelGroup.traverse((child) => {
      if (child.material) {
        // Add subtle golden tint to indicate certification
        if (child.material.emissive) {
          child.material.emissive.setHex(0x332200);
          child.material.emissiveIntensity = 0.1;
        }
      }
    });

    console.log('🔒 Model locked - Certified on Solana');
  }

  /**
   * Update certified badge animation (call in render loop)
   */
  updateCertifiedBadge(delta) {
    const badge = this.mintingState.certifiedBadge;
    if (!badge) return;

    // Floating animation
    badge.userData.floatOffset += delta * badge.userData.floatSpeed;
    badge.position.y = 2.5 + Math.sin(badge.userData.floatOffset) * 0.1;

    // Always face camera
    badge.lookAt(this.camera.position);
  }

  /**
   * Check if double-pinch hold should trigger mint
   * @param {Object} gesture - Gesture data with doublePinchTriggered
   */
  checkMintTrigger(gesture) {
    if (gesture.doublePinchTriggered && !this.mintingState.isActive && !this.mintingState.isCertified) {
      this.triggerMintFlow({
        centroidX: gesture.centroidX,
        centroidY: gesture.centroidY,
        handSize: gesture.handSize
      });
    }
  }

  /**
   * Render method - call in animation loop
   */
  render(delta = 0.016) {
    // Update confetti
    if (this.confettiEffect) {
      this.confettiEffect.update();
    }

    // Update certified badge
    if (this.mintingState.isCertified) {
      this.updateCertifiedBadge(delta);
    }

    // Update Solana Blink (CSS3D renderer)
    if (this.solanaBlink && this.mintingState.isActive) {
      this.solanaBlink.update();
    }

    // Main render
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Get minting state for UI
   */
  getMintingState() {
    return {
      isActive: this.mintingState.isActive,
      isProcessing: this.mintingState.isProcessing,
      isCertified: this.mintingState.isCertified,
      blinkUrl: this.mintingState.blinkUrl
    };
  }
}
