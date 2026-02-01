/**
 * HandController - MediaPipe Hand Landmarker integration
 * Tracks hand gestures and outputs smoothed rotation/zoom values.
 * Runs in its own requestAnimationFrame loop, separate from Three.js.
 */
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Landmark indices: 4 = thumb tip, 8 = index tip
const THUMB_TIP = 4;
const INDEX_TIP = 8;

export class HandController {
  constructor(options = {}) {
    this.onGesture = options.onGesture || (() => {});
    this.onLandmarks = options.onLandmarks || (() => {});
    this.smoothingFactor = options.smoothingFactor ?? 0.15;

    this.handLandmarker = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.stream = null;
    this.lastVideoTime = -1;
    this.running = false;

    // Smoothed gesture state (lerp targets)
    this.targetCentroidX = 0.5;
    this.targetCentroidY = 0.5;
    this.targetPinchDistance = 0;
    this.currentCentroidX = 0.5;
    this.currentCentroidY = 0.5;
    this.currentPinchDistance = 0;
    this.hasHand = false;

    // Normalization: map 0-1 screen coords to rotation range (radians)
    this.rotationSensitivity = options.rotationSensitivity ?? 3;
  }

  /**
   * Linear interpolation helper
   */
  lerp(a, b, t) {
    return a + (b - a) * Math.min(1, t);
  }

  /**
   * Euclidean distance between two landmarks
   */
  euclideanDistance(lm1, lm2) {
    return Math.hypot(lm2.x - lm1.x, lm2.y - lm1.y, (lm2.z || 0) - (lm1.z || 0));
  }

  /**
   * Initialize MediaPipe Hand Landmarker and webcam
   */
  async init(videoElement, canvasElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      numHands: 1,
      runningMode: 'VIDEO',
    });

    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });

    // Attach listener BEFORE setting srcObject so we don't miss the event
    const videoReady = new Promise((resolve, reject) => {
      const done = () => {
        this.video.width = this.video.videoWidth;
        this.video.height = this.video.videoHeight;
        if (this.canvas) {
          this.canvas.width = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
        }
        resolve();
      };
      this.video.onloadedmetadata = done;
      this.video.onerror = () => reject(new Error('Video failed to load'));
    });

    this.video.srcObject = this.stream;
    await this.video.play();
    await videoReady;

    return this;
  }

  /**
   * Process a single frame - call from your own RAF loop
   */
  async detectFrame() {
    if (!this.handLandmarker || !this.video || this.video.readyState < 2) return;

    const now = performance.now() / 1000;
    if (this.lastVideoTime !== this.video.currentTime) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.handLandmarker.detectForVideo(this.video, now);

      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0];
        this.hasHand = true;

        // Centroid: average of all 21 landmarks (x, y in normalized 0-1)
        let sumX = 0, sumY = 0;
        for (const lm of landmarks) {
          sumX += lm.x;
          sumY += lm.y;
        }
        this.targetCentroidX = sumX / landmarks.length;
        this.targetCentroidY = sumY / landmarks.length;

        // Pinch: distance between thumb tip (4) and index tip (8)
        const thumb = landmarks[THUMB_TIP];
        const index = landmarks[INDEX_TIP];
        this.targetPinchDistance = this.euclideanDistance(thumb, index);

        this.onLandmarks(landmarks, this.ctx, this.canvas);
      } else {
        this.hasHand = false;
        this.targetPinchDistance = this.currentPinchDistance; // hold last value
      }
    }

    // Smooth all values with lerp
    const t = this.smoothingFactor;
    this.currentCentroidX = this.lerp(this.currentCentroidX, this.targetCentroidX, t);
    this.currentCentroidY = this.lerp(this.currentCentroidY, this.targetCentroidY, t);
    this.currentPinchDistance = this.lerp(this.currentPinchDistance, this.targetPinchDistance, t);

    // Emit gesture: map 0-1 centroid to rotation, pinch to zoom
    const rotationX = (this.currentCentroidY - 0.5) * this.rotationSensitivity;
    const rotationY = (this.currentCentroidX - 0.5) * this.rotationSensitivity;
    const pinchNorm = this.currentPinchDistance;

    this.onGesture({
      rotationX,
      rotationY,
      pinchDistance: pinchNorm,
      hasHand: this.hasHand,
    });
  }

  /**
   * Start the detection loop (runs independently of Three.js)
   */
  start() {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.detectFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
  }

  /**
   * Get current smoothed values (for SceneManager)
   */
  getGesture() {
    return {
      rotationX: (this.currentCentroidY - 0.5) * this.rotationSensitivity,
      rotationY: (this.currentCentroidX - 0.5) * this.rotationSensitivity,
      pinchDistance: this.currentPinchDistance,
      hasHand: this.hasHand,
    };
  }
}
