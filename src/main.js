import './style.css';
import { HandController } from './HandController.js';
import { SceneManager } from './SceneManager.js';

const container = document.getElementById('canvas-container');
const webcamOverlay = document.getElementById('webcam-overlay');
const webcamVideo = document.getElementById('webcam-video');
const webcamCanvas = document.getElementById('webcam-canvas');
const overlayToggle = document.getElementById('webcam-overlay-toggle');
const uploadInput = document.getElementById('upload-glb');
const loadingEl = document.getElementById('loading');

let sceneManager;
let handController;
let lastTime = 0;

/**
 * Draw MediaPipe landmarks on overlay canvas for debugging
 * Called every frame; landmarks may be null when no hand detected
 */
function drawWebcam(ctx, canvas, landmarks) {
  if (!ctx || !canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  // Clear and draw video frame (mirrored)
  ctx.clearRect(0, 0, w, h);
  if (webcamVideo.readyState >= 2) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-w, 0);
    ctx.drawImage(webcamVideo, 0, 0, w, h);
    ctx.restore();
  } else {
    // Show placeholder if video not ready
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for camera...', w / 2, h / 2);
  }

  // Draw zone divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  // Draw landmarks if present
  if (!landmarks || landmarks.length === 0) return;
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#00ff88';

  const scaleX = w;
  const scaleY = h;
  // Mirror x to match flipped video
  const tx = (x, y) => [w - x * scaleX, y * scaleY];

  landmarks.forEach((lm) => {
    const [x, y] = tx(lm.x, lm.y);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // Draw hand skeleton connections
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];
  connections.forEach(([a, b]) => {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    if (!lmA || !lmB) return;
    const [x1, y1] = tx(lmA.x, lmA.y);
    const [x2, y2] = tx(lmB.x, lmB.y);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
}


async function init() {
  sceneManager = new SceneManager(container, {
    smoothingFactor: 0.12,
    zoomSensitivity: 2,
    baseCameraZ: 5,
  });
  sceneManager.init();

  handController = new HandController({
    smoothingFactor: 0.15,
    rotationSensitivity: 3,
  });

  console.log('Initializing hand controller...');
  await handController.init(webcamVideo, webcamCanvas);
  console.log('Hand controller initialized, starting...');
  handController.start();
  console.log('Hand controller started, hiding loading screen');

  loadingEl.classList.add('hidden');

  // Resize canvas to match overlay dimensions
  function resizeWebcamCanvas() {
    const w = webcamOverlay.clientWidth;
    const h = webcamOverlay.clientHeight;
    if (w > 0 && h > 0 && (webcamCanvas.width !== w || webcamCanvas.height !== h)) {
      webcamCanvas.width = w;
      webcamCanvas.height = h;
      console.log('Canvas resized to', w, h);
    }
  }
  // Set initial size
  webcamCanvas.width = 256;
  webcamCanvas.height = 192;
  resizeWebcamCanvas();
  setTimeout(resizeWebcamCanvas, 100);
  setTimeout(resizeWebcamCanvas, 500);
  new ResizeObserver(resizeWebcamCanvas).observe(webcamOverlay);

  // Store last landmarks for continuous redraw
  let lastLandmarks = null;
  handController.onLandmarks = (landmarks) => {
    lastLandmarks = landmarks;
  };

  // Get canvas context once
  const webcamCtx = webcamCanvas.getContext('2d');

  function animate(time) {
    const delta = (time - lastTime) / 1000;
    lastTime = time;
    const gesture = handController.getGesture();
    sceneManager.updateFromGesture(gesture, delta);
    sceneManager.render();
    // Redraw webcam every frame
    if (!webcamOverlay.classList.contains('hidden')) {
      drawWebcam(webcamCtx, webcamCanvas, lastLandmarks);
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// Webcam overlay toggle
overlayToggle.addEventListener('change', () => {
  if (overlayToggle.checked) {
    webcamOverlay.classList.remove('hidden');
  } else {
    webcamOverlay.classList.add('hidden');
  }
});

// Upload GLB - label wraps input, so click on label triggers file picker
uploadInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file && sceneManager) {
    sceneManager.loadGLB(file);
  }
  e.target.value = '';
});

init().catch((err) => {
  console.error('Init failed:', err);
  loadingEl.innerHTML = `<p class="text-red-500 p-4">Error: ${err.message}<br><br>Please allow camera access and reload the page.</p>`;
});
