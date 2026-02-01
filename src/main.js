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
function drawLandmarks(landmarks, ctx, canvas) {
  if (!ctx || !canvas) return;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Flip only the webcam display (video) across y-axis; landmarks use MediaPipe coords
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);
  ctx.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (!landmarks || landmarks.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#00ff88';

  const scaleX = canvas.width;
  const scaleY = canvas.height;
  // Transform landmark coords to match flipped webcam (x only, across y-axis)
  const tx = (x, y) => [canvas.width - x * scaleX, y * scaleY];

  landmarks.forEach((lm) => {
    const [x, y] = tx(lm.x, lm.y);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // Draw connections (simplified hand skeleton)
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

  ctx.restore();
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
    onLandmarks: (landmarks, ctx, canvas) => {
      if (webcamOverlay.classList.contains('hidden')) return;
      drawLandmarks(landmarks, ctx, canvas);
    },
  });

  await handController.init(webcamVideo, webcamCanvas);
  handController.start();

  loadingEl.classList.add('hidden');

  // Wire gesture -> scene
  function animate(time) {
    const delta = (time - lastTime) / 1000;
    lastTime = time;
    const gesture = handController.getGesture();
    sceneManager.updateFromGesture(gesture, delta);
    sceneManager.render();
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
  loadingEl.innerHTML = `<p class="text-red-500">Error: ${err.message}</p>`;
});
