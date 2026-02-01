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
    this.basePinchDistance = null;

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

    // Grid helper
    this.gridHelper = new THREE.GridHelper(10, 20, 0x333355, 0x222244);
    this.gridHelper.position.y = -2;
    this.scene.add(this.gridHelper);

    // Model Group - contains loaded model
    this.modelGroup = new THREE.Group();
    this.modelGroup.position.y = 0;
    this.scene.add(this.modelGroup);

    // GLTFLoader with DRACO support
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    // Load default robotic car GLB (encode + as %2B)
    this.loadGLB('/robotic%2Bcar%2B3d%2Bmodel.glb');

    window.addEventListener('resize', () => this.onResize());
    return this;
  }

  /**
   * Update from gesture data (call each frame)
   */
  updateFromGesture(gesture, delta = 0.016) {
    if (!this.modelGroup) return;

    const t = this.smoothingFactor;

    if (gesture.hasHand) {
      this.targetRotationX = gesture.rotationX;
      this.targetRotationY = gesture.rotationY;

      // Pinch to zoom: normalize by first pinch value, then scale
      if (this.basePinchDistance === null) {
        this.basePinchDistance = gesture.pinchDistance || 0.1;
      }
      const pinchNorm = gesture.pinchDistance / this.basePinchDistance;
      this.targetZoom = Math.max(0.3, Math.min(3, pinchNorm * this.zoomSensitivity));
    } else {
      this.basePinchDistance = null;
    }

    // Lerp rotation and zoom
    this.currentRotationX = this.lerp(this.currentRotationX, this.targetRotationX, t);
    this.currentRotationY = this.lerp(this.currentRotationY, this.targetRotationY, t);
    this.currentZoom = this.lerp(this.currentZoom, this.targetZoom, t);

    this.modelGroup.rotation.x = this.currentRotationX;
    this.modelGroup.rotation.y = this.currentRotationY;
    this.modelGroup.scale.setScalar(this.currentZoom);

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
        this.basePinchDistance = null;
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
}
