/**
 * HandController - MediaPipe Hand Landmarker integration
 * Tracks hand gestures and outputs smoothed rotation/zoom values.
 * Runs in its own requestAnimationFrame loop, separate from Three.js.
 */
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;

export class HandController {
  constructor(options = {}) {
    this.onGesture = options.onGesture || (() => {});
    this.onLandmarks = options.onLandmarks || (() => {});
    this.onDoublePinchHold = options.onDoublePinchHold || (() => {}); // New: Solana mint trigger
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
    this.targetHandSize = 0.3; // Approximate hand size in frame (0-1)
    this.currentCentroidX = 0.5;
    this.currentCentroidY = 0.5;
    this.currentPinchDistance = 0;
    this.currentHandSize = 0.3;
    this.hasHand = false;

    // Normalization: map 0-1 screen coords to rotation range (radians)
    this.rotationSensitivity = options.rotationSensitivity ?? 3;
    // Pinch threshold: distance below this = pinching (actions only when pinching)
    this.pinchThreshold = options.pinchThreshold ?? 0.18;

    // Double pinch detection for Solana mint
    this.doublePinchState = {
      lastPinchEnd: 0,         // Timestamp when last pinch ended
      pinchCount: 0,           // Number of consecutive quick pinches
      isHolding: false,        // Currently holding a double-pinch
      holdStartTime: 0,        // When the hold started
      holdDuration: 1500,      // Required hold time (1.5 seconds - reduced for reliability)
      doublePinchWindow: 600,  // Max time between pinches to count as double
      triggered: false,        // Has the callback been triggered
      wasTriggered: false,     // Prevent re-triggering until release
      progress: 0              // 0-1 progress of hold
    };
    this.wasPinching = false;
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
      this.ctx = this.canvas.getContext('2d', { alpha: true });
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
    this.video.srcObject = this.stream;

    // Wait for video to be ready (with timeout)
    await Promise.race([
      new Promise((resolve) => {
        const done = () => {
          const w = this.video.videoWidth || 640;
          const h = this.video.videoHeight || 480;
          this.video.width = w;
          this.video.height = h;
          if (this.canvas) {
            const parent = this.canvas.parentElement;
            const pw = parent?.clientWidth || 256;
            const ph = parent?.clientHeight || 144;
            this.canvas.width = pw > 0 ? pw : w;
            this.canvas.height = ph > 0 ? ph : h;
          }
          resolve();
        };
        if (this.video.readyState >= 1) {
          done();
        } else {
          this.video.onloadedmetadata = done;
          this.video.oncanplay = done;
        }
      }),
      new Promise((resolve) => setTimeout(resolve, 3000)), // 3s timeout
    ]);

    try {
      await this.video.play();
    } catch (e) {
      console.warn('Video play failed:', e);
    }

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

        // Hand size: distance from wrist to middle finger tip
        // Larger = hand closer to camera, smaller = hand farther
        const wrist = landmarks[WRIST];
        const middleTip = landmarks[MIDDLE_TIP];
        this.targetHandSize = this.euclideanDistance(wrist, middleTip);

        this.onLandmarks(landmarks, this.ctx, this.canvas);
      } else {
        this.hasHand = false;
        this.targetPinchDistance = this.currentPinchDistance; // hold last value
        this.targetHandSize = this.currentHandSize; // hold last value
        this.onLandmarks(null, this.ctx, this.canvas); // still redraw video when no hand
      }
    }

    // Smooth all values with lerp
    const t = this.smoothingFactor;
    this.currentCentroidX = this.lerp(this.currentCentroidX, this.targetCentroidX, t);
    this.currentCentroidY = this.lerp(this.currentCentroidY, this.targetCentroidY, t);
    this.currentPinchDistance = this.lerp(this.currentPinchDistance, this.targetPinchDistance, t);
    this.currentHandSize = this.lerp(this.currentHandSize, this.targetHandSize, t);

    // Emit gesture: map 0-1 centroid to rotation, pinch to zoom
    const rotationX = (this.currentCentroidY - 0.5) * this.rotationSensitivity;
    const rotationY = (0.5 - this.currentCentroidX) * this.rotationSensitivity; // flipped horizontal
    const pinchNorm = this.currentPinchDistance;
    const isPinching = this.hasHand && this.currentPinchDistance < this.pinchThreshold;
    // Left half (x < 0.5): pinch → zoom. Right half: pinch → rotate
    const pinchZone = this.currentCentroidX < 0.5 ? 'zoom' : 'rotate';

    // Double pinch detection
    const doublePinchData = this.detectDoublePinchHold(isPinching);

    this.onGesture({
      rotationX,
      rotationY,
      centroidX: this.currentCentroidX,
      centroidY: this.currentCentroidY,
      pinchDistance: pinchNorm,
      handSize: this.currentHandSize, // Hand size for depth control
      hasHand: this.hasHand,
      isPinching,
      pinchZone,
      doublePinchHold: doublePinchData.isHolding,
      doublePinchProgress: doublePinchData.progress,
      doublePinchTriggered: doublePinchData.triggered,
    });
  }

  /**
   * Detect double-pinch hold gesture for Solana mint
   * Double pinch = two quick pinches, then hold the second one for 2 seconds
   */
  detectDoublePinchHold(isPinching) {
    const state = this.doublePinchState;
    const now = Date.now();

    // Detect pinch start
    if (isPinching && !this.wasPinching) {
      // Pinch just started
      const timeSinceLastPinch = now - state.lastPinchEnd;
      
      if (timeSinceLastPinch < state.doublePinchWindow && state.pinchCount === 1) {
        // This is the second pinch of a double-pinch
        state.pinchCount = 2;
        state.isHolding = true;
        state.holdStartTime = now;
        state.triggered = false;
      } else {
        // First pinch or too slow - reset
        state.pinchCount = 1;
        state.isHolding = false;
        state.triggered = false;
      }
    }

    // Detect pinch end - but allow brief flickers during hold
    if (!isPinching && this.wasPinching) {
      // Pinch just ended
      if (state.pinchCount === 1) {
        // Record when first pinch ended
        state.lastPinchEnd = now;
      } else if (state.pinchCount === 2 && !state.isHolding) {
        // Only reset if not in a hold (allow flickers during hold)
        state.pinchCount = 0;
      }
    }

    // Update hold progress - allow brief pinch flickers during hold
    if (state.isHolding && state.pinchCount === 2 && !state.triggered) {
      const elapsed = now - state.holdStartTime;
      state.progress = Math.min(1, elapsed / state.holdDuration);

      // Trigger when progress reaches 100%
      if (state.progress >= 1 && !state.wasTriggered) {
        state.triggered = true;
        state.wasTriggered = true;
        state.isHolding = false;
        state.pinchCount = 0;
        
        console.log('🎯 Double-pinch mint triggered at 100%!');
        
        // Trigger the callback
        this.onDoublePinchHold({
          centroidX: this.currentCentroidX,
          centroidY: this.currentCentroidY,
          handSize: this.currentHandSize
        });
        
        // Reset progress after triggering so UI hides
        state.progress = 0;
      }
    } else if (!state.triggered && !state.isHolding) {
      // Only reset progress if not triggered and not in a hold
      state.progress = 0;
    } else if (state.triggered) {
      // Already triggered - ensure progress stays at 0 so UI stays hidden
      state.progress = 0;
    }

    // Reset wasTriggered when fully released
    if (!isPinching && state.pinchCount === 0) {
      state.wasTriggered = false;
    }

    this.wasPinching = isPinching;

    return {
      isHolding: state.isHolding && state.pinchCount === 2,
      progress: state.progress,
      triggered: state.triggered
    };
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
    const isPinching = this.hasHand && this.currentPinchDistance < this.pinchThreshold;
    const pinchZone = this.currentCentroidX < 0.5 ? 'zoom' : 'rotate';
    const state = this.doublePinchState;
    
    // Only show as holding if not yet triggered
    const isDoublePinchHold = state.isHolding && state.pinchCount === 2 && !state.triggered;
    
    return {
      rotationX: (this.currentCentroidY - 0.5) * this.rotationSensitivity,
      rotationY: (0.5 - this.currentCentroidX) * this.rotationSensitivity, // flipped horizontal
      centroidX: this.currentCentroidX,
      centroidY: this.currentCentroidY,
      pinchDistance: this.currentPinchDistance,
      handSize: this.currentHandSize,
      hasHand: this.hasHand,
      isPinching,
      pinchZone,
      doublePinchHold: isDoublePinchHold,
      doublePinchProgress: state.progress,
      doublePinchTriggered: state.triggered,
    };
  }

  /**
   * Reset double pinch state (call after mint is processed)
   */
  resetDoublePinch() {
    this.doublePinchState = {
      lastPinchEnd: 0,
      pinchCount: 0,
      isHolding: false,
      holdStartTime: 0,
      holdDuration: 2000,
      doublePinchWindow: 500,
      triggered: false,
      wasTriggered: false,
      progress: 0
    };
  }
}
