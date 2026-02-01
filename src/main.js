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

// Assembly Mode UI elements
const assemblyModeBtn = document.getElementById('assembly-mode-btn');
const assemblyIndicator = document.getElementById('assembly-indicator');

// Solana mint UI elements (created dynamically)
let mintProgressOverlay = null;
let mintStatusText = null;

let sceneManager;
let handController;
let lastTime = 0;
let assemblyModeActive = false;

/**
 * Create Solana mint UI overlay
 */
function createMintUI() {
  // Mint progress overlay
  mintProgressOverlay = document.createElement('div');
  mintProgressOverlay.id = 'mint-progress-overlay';
  mintProgressOverlay.className = 'fixed inset-0 pointer-events-none z-40 hidden';
  mintProgressOverlay.innerHTML = `
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
      <div id="mint-progress-ring" class="w-32 h-32 mx-auto mb-4 relative">
        <svg class="w-full h-full" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="#333" stroke-width="8"/>
          <circle id="mint-progress-circle" cx="50" cy="50" r="45" fill="none" 
            stroke="url(#solanaGradient)" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="283" stroke-dashoffset="283"
            transform="rotate(-90 50 50)"/>
          <defs>
            <linearGradient id="solanaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#00FFA3"/>
              <stop offset="100%" stop-color="#DC1FFF"/>
            </linearGradient>
          </defs>
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span id="mint-progress-text" class="text-2xl font-bold text-white">0%</span>
        </div>
      </div>
      <p id="mint-status" class="text-white text-lg font-medium">Hold double-pinch to mint...</p>
    </div>
  `;
  document.body.appendChild(mintProgressOverlay);

  // Demo confirmation button (for testing without wallet)
  const demoBtn = document.createElement('button');
  demoBtn.id = 'demo-confirm-btn';
  demoBtn.className = 'fixed bottom-4 right-4 bg-gradient-to-r from-green-400 to-purple-500 text-black px-4 py-2 rounded-lg font-bold z-50 hidden hover:scale-105 transition-transform';
  demoBtn.innerHTML = '✓ Simulate Mint Confirm';
  demoBtn.addEventListener('click', () => {
    if (sceneManager) {
      sceneManager.onMintConfirmed('demo_' + Date.now().toString(36));
      demoBtn.classList.add('hidden');
      hideMintProgress();
    }
  });
  document.body.appendChild(demoBtn);
}

/**
 * Show mint progress UI
 */
function showMintProgress() {
  if (mintProgressOverlay) {
    mintProgressOverlay.classList.remove('hidden');
  }
}

/**
 * Hide mint progress UI
 */
function hideMintProgress() {
  if (mintProgressOverlay) {
    mintProgressOverlay.classList.add('hidden');
  }
}

/**
 * Update mint progress ring
 * @param {number} progress - 0 to 1
 */
function updateMintProgress(progress) {
  const circle = document.getElementById('mint-progress-circle');
  const text = document.getElementById('mint-progress-text');
  const status = document.getElementById('mint-status');
  
  if (circle && text) {
    const offset = 283 * (1 - progress);
    circle.style.strokeDashoffset = offset;
    text.textContent = Math.round(progress * 100) + '%';
  }
  
  if (status) {
    if (progress < 1) {
      status.textContent = 'Hold double-pinch to mint...';
    } else {
      status.textContent = '🚀 Generating Blink...';
    }
  }
}

/**
 * Draw MediaPipe landmarks on overlay canvas for debugging
 * Called every frame; landmarks may be null when no hand detected
 */
function drawWebcam(ctx, canvas, landmarks, gesture) {
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

  // Draw zone divider line (only in normal mode)
  if (!assemblyModeActive) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // Draw zone labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ZOOM', w * 0.25, 15);
    ctx.fillText('ROTATE', w * 0.75, 15);
  } else {
    // Assembly mode label
    ctx.fillStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ASSEMBLY MODE', w / 2, 15);
  }

  // Show pinch status
  if (gesture) {
    let status;
    if (gesture.doublePinchHold) {
      // Show mint progress
      const pct = Math.round(gesture.doublePinchProgress * 100);
      status = `🚀 MINTING: ${pct}%`;
      ctx.fillStyle = '#00FFA3'; // Solana green
    } else if (assemblyModeActive) {
      status = gesture.isPinching ? 'GRABBING' : 'Pinch to grab';
      ctx.fillStyle = gesture.isPinching ? '#00ff00' : '#ffffff';
    } else {
      status = gesture.isPinching ? `PINCH: ${gesture.pinchZone.toUpperCase()}` : 'Open hand';
      ctx.fillStyle = gesture.isPinching ? '#00ff00' : '#ffffff';
    }
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(status, w / 2, h - 10);
    
    // Show double-pinch hint
    if (!gesture.doublePinchHold && !assemblyModeActive) {
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText('Double-pinch + hold 2s = Mint NFT', w / 2, h - 25);
    } else {
      // Show pinch distance for debugging
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#aaa';
      ctx.fillText(`dist: ${gesture.pinchDistance.toFixed(3)}`, w / 2, h - 25);
    }
  }

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
  // Create Solana mint UI
  createMintUI();

  sceneManager = new SceneManager(container, {
    smoothingFactor: 0.12,
    zoomSensitivity: 2,
    baseCameraZ: 5,
  });
  sceneManager.init();

  handController = new HandController({
    smoothingFactor: 0.15,
    rotationSensitivity: 3,
    // Double-pinch hold callback for Solana mint
    onDoublePinchHold: (handData) => {
      console.log('🎯 Double-pinch hold detected! Triggering mint...');
      sceneManager.triggerMintFlow(handData);
      
      // Show demo confirm button
      const demoBtn = document.getElementById('demo-confirm-btn');
      if (demoBtn) {
        demoBtn.classList.remove('hidden');
      }
    }
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
    const mintState = sceneManager.getMintingState();
    
    // Update mint progress UI
    if (gesture.doublePinchHold && !mintState.isActive && !mintState.isCertified) {
      showMintProgress();
      updateMintProgress(gesture.doublePinchProgress);
    } else if (!gesture.doublePinchHold && !mintState.isActive) {
      hideMintProgress();
    }
    
    // Update minting flow (Blink card position)
    if (mintState.isActive) {
      sceneManager.updateMintingFlow(gesture);
    }
    
    if (assemblyModeActive) {
      // In assembly mode: handle grab/attach logic, model is frozen
      sceneManager.updateAssemblyMode(gesture);
    } else {
      // Normal mode: rotate/zoom the model
      sceneManager.updateFromGesture(gesture, delta);
    }
    
    sceneManager.render(delta);
    
    // Redraw webcam every frame
    if (!webcamOverlay.classList.contains('hidden')) {
      drawWebcam(webcamCtx, webcamCanvas, lastLandmarks, gesture);
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

// Assembly Mode toggle
assemblyModeBtn.addEventListener('click', () => {
  if (!sceneManager) return;
  
  assemblyModeActive = sceneManager.toggleAssemblyMode();
  
  if (assemblyModeActive) {
    assemblyModeBtn.textContent = 'Exit Assembly Mode';
    assemblyModeBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
    assemblyModeBtn.classList.add('bg-red-600', 'hover:bg-red-700');
    assemblyIndicator.classList.remove('hidden');
  } else {
    assemblyModeBtn.textContent = 'Enter Assembly Mode';
    assemblyModeBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
    assemblyModeBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    assemblyIndicator.classList.add('hidden');
  }
});

init().catch((err) => {
  console.error('Init failed:', err);
  loadingEl.innerHTML = `<p class="text-red-500 p-4">Error: ${err.message}<br><br>Please allow camera access and reload the page.</p>`;
});
