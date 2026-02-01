/**
 * SceneManager - Three.js 3D scene with GLTF/GLB loading
 * Handles model Group rotation/zoom via gesture input with lerp smoothing.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

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
    this.snapDistance = 0.5; // distance threshold for snapping
    this.rotationSensitivity = 3; // must match HandController
    this.handCursor = null; // 3D cursor showing hand position

  }

  lerp(a, b, t) {
    return a + (b - a) * Math.min(1, t);
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 5, 20);

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
    envScene.background = new THREE.Color(0x2d2d44);
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

  // ========== ASSEMBLY MODE ==========

  /**
   * Enter Assembly Mode - freeze model, show sidebar items
   */
  enterAssemblyMode() {
    this.assemblyMode = true;
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
      color: 0x00ffff, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    this.handCursor.add(ring);

    // Center dot
    const dotGeom = new THREE.CircleGeometry(0.04, 16);
    const dotMat = new THREE.MeshBasicMaterial({ 
      color: 0x00ffff,
      transparent: true,
      opacity: 0.9
    });
    const dot = new THREE.Mesh(dotGeom, dotMat);
    this.handCursor.add(dot);

    // Crosshair lines
    const lineMatPinch = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 });
    const lineMatOpen = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 });
    
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
      const line = new THREE.Line(geom, lineMatOpen.clone());
      this.handCursor.add(line);
      this.handCursor.userData.lines.push(line);
    });

    this.handCursor.userData.ringMat = ringMat;
    this.handCursor.userData.dotMat = dotMat;
    this.handCursor.userData.lineMatPinch = lineMatPinch;
    this.handCursor.userData.lineMatOpen = lineMatOpen;

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
   */
  updateHandCursor(centroidX, centroidY, isPinching, hasHand) {
    if (!this.handCursor) return;

    // Show/hide based on hand detection
    this.handCursor.visible = hasHand;
    if (!hasHand) return;

    // Update position
    const targetPos = this.handToWorld(centroidX, centroidY);
    this.handCursor.position.lerp(targetPos, 0.3);

    // Change color based on pinch state
    const color = isPinching ? 0x00ff00 : 0x00ffff;
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
    servoGroup.userData = { type: 'servo', isAssemblyItem: true };
    
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
    
    // Add a glowing outline ring to make it easier to see
    const servoRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.02, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
    );
    servoRing.rotation.x = Math.PI / 2;
    servoGroup.add(servoRing);
    
    servoGroup.position.set(-2.5, 0.5, 1);
    this.scene.add(servoGroup);
    this.assemblyItems.push(servoGroup);

    // Create Wheel (small)
    const wheelGroup = new THREE.Group();
    wheelGroup.userData = { type: 'wheel', isAssemblyItem: true };
    
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
    
    // Add a glowing outline ring
    const wheelRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.02, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
    );
    wheelRing.rotation.x = Math.PI / 2;
    wheelGroup.add(wheelRing);
    
    wheelGroup.position.set(-2.5, -0.5, 1);
    this.scene.add(wheelGroup);
    this.assemblyItems.push(wheelGroup);
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
   */
  handToWorld(centroidX, centroidY) {
    // Map hand position to 3D space
    // X: flipped to match mirrored webcam (hand right = cursor right)
    // Y: 0 (top) to 1 (bottom) -> 2 to -2 in world
    const x = (0.5 - centroidX) * 6; // Flipped for mirrored webcam
    const y = (0.5 - centroidY) * 4;
    const z = 1; // Keep items in front of model
    return new THREE.Vector3(x, y, z);
  }

  /**
   * Try to grab an assembly item at the given hand position
   */
  tryGrabItem(centroidX, centroidY) {
    if (!this.assemblyMode || this.heldItem) return null;

    const handPos = this.handToWorld(centroidX, centroidY);
    
    for (const item of this.assemblyItems) {
      const distance = item.position.distanceTo(handPos);
      if (distance < 0.8) {
        this.heldItem = item;
        this.heldItem.userData.isHeld = true;
        return item;
      }
    }
    return null;
  }

  /**
   * Update held item position to follow hand
   */
  updateHeldItem(centroidX, centroidY) {
    if (!this.heldItem) return;
    
    const targetPos = this.handToWorld(centroidX, centroidY);
    // Smooth follow
    this.heldItem.position.lerp(targetPos, 0.3);
  }

  /**
   * Release held item - snap to model if close, otherwise return to sidebar
   */
  releaseItem() {
    if (!this.heldItem) return null;

    const item = this.heldItem;
    item.userData.isHeld = false;
    
    // Check distance to model center
    const modelCenter = new THREE.Vector3();
    this.modelGroup.getWorldPosition(modelCenter);
    
    const distance = item.position.distanceTo(modelCenter);
    
    if (distance < this.snapDistance + 1) {
      // Snap to model - attach as child
      const attachResult = this.attachToModel(item);
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
   * Attach item to the model group
   */
  attachToModel(item) {
    // Remove from assembly items
    const idx = this.assemblyItems.indexOf(item);
    if (idx > -1) this.assemblyItems.splice(idx, 1);
    
    // Remove from scene and add to model group
    this.scene.remove(item);
    
    // Convert world position to local model position
    const worldPos = item.position.clone();
    this.modelGroup.worldToLocal(worldPos);
    item.position.copy(worldPos);
    
    // Add to model group so it rotates with the model
    this.modelGroup.add(item);
    item.userData.isAttached = true;
    this.attachedParts.push(item);
    
    // Create a new item of the same type in sidebar
    this.respawnSidebarItem(item.userData.type);
    
    return { type: item.userData.type, position: worldPos };
  }

  /**
   * Return item to sidebar position
   */
  returnToSidebar(item) {
    const type = item.userData.type;
    if (type === 'servo') {
      item.position.set(-2.5, 0.5, 1);
    } else if (type === 'wheel') {
      item.position.set(-2.5, -0.5, 1);
    }
  }

  /**
   * Respawn a sidebar item after one is attached
   */
  respawnSidebarItem(type) {
    if (type === 'servo') {
      const servoGroup = new THREE.Group();
      servoGroup.userData = { type: 'servo', isAssemblyItem: true };
      
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
      
      const servoRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.02, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
      );
      servoRing.rotation.x = Math.PI / 2;
      servoGroup.add(servoRing);
      
      servoGroup.position.set(-2.5, 0.5, 1);
      this.scene.add(servoGroup);
      this.assemblyItems.push(servoGroup);
    } else if (type === 'wheel') {
      const wheelGroup = new THREE.Group();
      wheelGroup.userData = { type: 'wheel', isAssemblyItem: true };
      
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
      
      const wheelRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.02, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
      );
      wheelRing.rotation.x = Math.PI / 2;
      wheelGroup.add(wheelRing);
      
      wheelGroup.position.set(-2.5, -0.5, 1);
      this.scene.add(wheelGroup);
      this.assemblyItems.push(wheelGroup);
    }
  }

  /**
   * Update from gesture - with assembly mode handling
   */
  updateAssemblyMode(gesture) {
    if (!this.assemblyMode) return;

    const centroidX = (gesture.rotationY / this.rotationSensitivity) + 0.5; // Convert back to 0-1
    const centroidY = (gesture.rotationX / this.rotationSensitivity) + 0.5;
    
    // Use raw centroid from gesture if available
    const rawX = gesture.centroidX ?? centroidX;
    const rawY = gesture.centroidY ?? centroidY;

    // Update hand cursor position
    this.updateHandCursor(rawX, rawY, gesture.isPinching, gesture.hasHand);

    if (gesture.isPinching) {
      if (!this.heldItem) {
        // Try to grab an item
        this.tryGrabItem(rawX, rawY);
      } else {
        // Update held item position
        this.updateHeldItem(rawX, rawY);
      }
    } else {
      // Released pinch
      if (this.heldItem) {
        this.releaseItem();
      }
    }
  }
}
