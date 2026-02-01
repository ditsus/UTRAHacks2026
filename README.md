# Hand Gesture 3D Controller | UTRA Hacks 2026

A Vite-based Three.js application that uses MediaPipe Hand Landmarker to control a 3D model with hand gestures.

## Tech Stack

- **Vite** – build tool
- **Three.js** – 3D rendering
- **MediaPipe Tasks Vision** – Hand landmark detection
- **Tailwind CSS** – styling

## Features

- **Rotation**: Move your hand – centroid x/y maps to model rotation
- **Zoom (pinch)**: Change distance between thumb tip and index tip to zoom
- **Smoothing**: Lerp on all gestures to reduce jitter
- **Upload GLB**: Replace the default cube with your own `.glb` / `.gltf` model
- **Webcam overlay**: Toggle debug view with MediaPipe landmarks drawn on the webcam feed

## Project Structure

```
src/
├── main.js          # Entry point, wires HandController ↔ SceneManager
├── HandController.js # MediaPipe hand tracking, gesture extraction, smoothing
├── SceneManager.js   # Three.js scene, GLTFLoader+DRACO, model group
└── style.css        # Tailwind + base styles
```

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173 and allow camera access when prompted.

## Gesture Controls

| Gesture | Action |
|--------|--------|
| Move hand | Rotate 3D model |
| Pinch (thumb + index) | Zoom in/out |
| Open hand | Reset pinch baseline |

## Development

- `npm run dev` – start dev server
- `npm run build` – production build
- `npm run preview` – preview production build
