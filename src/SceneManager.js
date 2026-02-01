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
    this.snapDistance = 1.5; // distance threshold for snapping (increased)
    this.rotationSensitivity = 3; // must match HandController
    this.handCursor = null; // 3D cursor showing hand position
    
    // Fixed screen positions for assembly items (right side)
    this.servoScreenPos = { x: 0.85, y: 0.35 }; // normalized screen coords
    this.wheelScreenPos = { x: 0.85, y: 0.65 };
    
    // Mouse control state
    this.isDragging = false;
    this.previousMouseX = 0;
    this.previousMouseY = 0;

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
   * Setup mouse controls for rotating and zooming
   */
  setupMouseControls() {
    const canvas = this.renderer.domElement;

    // Mouse down - start dragging
    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.previousMouseX = e.clientX;
      this.previousMouseY = e.clientY;
    });

    // Mouse move - rotate if dragging
    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const deltaX = e.clientX - this.previousMouseX;
      const deltaY = e.clientY - this.previousMouseY;
      
      // Update rotation targets
      this.targetRotationY += deltaX * 0.01;
      this.targetRotationX += deltaY * 0.01;
      
      this.previousMouseX = e.clientX;
      this.previousMouseY = e.clientY;
    });

    // Mouse up - stop dragging
    canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Mouse leave - stop dragging
    canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
    });

    // Scroll - zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      const zoomDelta = e.deltaY * 0.001;
      this.targetZoom = Math.max(0.3, Math.min(3, this.targetZoom - zoomDelta));
    }, { passive: false });
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
   * @param {number} handSize - Size of hand in frame for depth control
   */
  updateHandCursor(centroidX, centroidY, isPinching, hasHand, handSize = 0.3) {
    if (!this.handCursor) return;

    // Show/hide based on hand detection
    this.handCursor.visible = hasHand;
    if (!hasHand) return;

    // Map hand size to depth (same logic as held items)
    const minHandSize = 0.15;
    const maxHandSize = 0.5;
    const normalizedSize = Math.max(0, Math.min(1, (handSize - minHandSize) / (maxHandSize - minHandSize)));
    const depth = 1.5 + (1 - normalizedSize) * 4; // Range: 1.5 (close) to 5.5 (far)

    // Update position
    const targetPos = this.handToWorld(centroidX, centroidY, depth);
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
    
    // Add a glowing outline ring to make it easier to see
    const servoRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.02, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
    );
    servoRing.rotation.x = Math.PI / 2;
    servoGroup.add(servoRing);
    
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
    
    // Add a glowing outline ring
    const wheelRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.02, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
    );
    wheelRing.rotation.x = Math.PI / 2;
    wheelGroup.add(wheelRing);
    
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
   */
  tryGrabItem(centroidX, centroidY) {
    if (!this.assemblyMode || this.heldItem) return null;

    const handPos = this.handToWorld(centroidX, centroidY);
    
    for (const item of this.assemblyItems) {
      const distance = item.position.distanceTo(handPos);
      if (distance < 1.0) { // Increased grab radius
        this.heldItem = item;
        this.heldItem.userData.isHeld = true;
        return item;
      }
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
    // Larger hand (closer to camera) = object closer (smaller depth)
    // Smaller hand (farther from camera) = object farther (larger depth)
    const minHandSize = 0.15;
    const maxHandSize = 0.5;
    const normalizedSize = Math.max(0, Math.min(1, (handSize - minHandSize) / (maxHandSize - minHandSize)));
    
    // Invert: bigger hand = closer = smaller depth value
    const depth = 1.5 + (1 - normalizedSize) * 4; // Range: 1.5 (close) to 5.5 (far)
    
    const targetPos = this.handToWorld(centroidX, centroidY, depth);
    // Smooth follow
    this.heldItem.position.lerp(targetPos, 0.3);
    
    // Visual feedback - change ring color when in snap range
    const closestPoint = this.getClosestPointOnModel(this.heldItem.position);
    const distance = this.heldItem.position.distanceTo(closestPoint);
    const inSnapRange = distance < 3.0;
    
    // Update ring color to indicate snap range
    this.heldItem.traverse((child) => {
      if (child.material && child.material.color) {
        const isRing = child.geometry && child.geometry.type === 'TorusGeometry';
        if (isRing) {
          child.material.color.setHex(inSnapRange ? 0x00ff00 : 0x00ffff);
          child.material.opacity = inSnapRange ? 1.0 : 0.6;
        }
      }
    });
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
    
    // Remove the cyan ring when attached
    item.traverse((child) => {
      if (child.material && child.material.color) {
        const color = child.material.color.getHex();
        if (color === 0x00ffff) {
          child.visible = false; // Hide the ring
        }
      }
    });
    
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
      
      const servoRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.02, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
      );
      servoRing.rotation.x = Math.PI / 2;
      servoGroup.add(servoRing);
      
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
      
      const wheelRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.02, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
      );
      wheelRing.rotation.x = Math.PI / 2;
      wheelGroup.add(wheelRing);
      
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
      if (!this.heldItem) {
        // Try to grab an item
        this.tryGrabItem(rawX, rawY);
      } else {
        // Update held item position with depth control via hand size (distance from camera)
        this.updateHeldItem(rawX, rawY, gesture.handSize);
      }
    } else {
      // Released pinch
      if (this.heldItem) {
        this.releaseItem();
      }
    }
  }
}
