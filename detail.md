# VisionAid V2 - Complete Project Audit

This document provides a comprehensive breakdown of the entire VisionAid V2 architecture, covering frontend elements, machine learning models, algorithms, and mathematical formulas used across the system.

---

## 1. Frontend Architecture & User Interface

The application is built using Vanilla HTML, CSS, and modular JavaScript. 

### Core UI Elements (`index.html` & `style.css`)
- **Live Feed (`<video id="camera-feed">`)**: The core element displaying the mirrored (or environment) camera feed.
- **Top Header (`.camera-header`)**: Contains a pulsing **Status Indicator** (green for active, red/off for inactive) and the title "Live Feed".
- **Dynamic Canvases**:
    - **Depth Canvas (`id="depth-canvas"`)**: Positioned at the bottom right. Used for debugging to map the relative depth of the scene (Hidden by default).
    - **Detection Canvas (`id="detection-canvas"`)**: Overlaid exactly on top of the video feed to draw bounding boxes and labels for detected objects.
- **Zone Indicator (`id="zone-indicator"`)**: A floating pill at the top center of the video that dynamically changes color and text based on proximity (Safe/Green, Warning/Orange, Danger/Red).
- **Camera Controls (`.camera-controls`)**:
    - **Switch Camera Button (`id="switch-camera-btn"`)**: Toggles the device camera between `user` (selfie) and `environment` (rear) mode.
    - **Toggle Camera Button (`id="toggle-camera-btn"`)**: Starts or pauses the entire camera feed and the guiding ML model.
- **Status Display (`#status-display`)**: Located at the bottom of the card.
    - **System**: Displays text like "Initializing...", "Loading AI model...", "Ready", or dodge actions.
    - **FPS**: Displays current frames per second (capped at ~30 FPS).
    - **Audio**: Displays the current status of the Text-To-Speech engine ("Ready", "Unavailable").
- **Fallbacks**: Loading Spinner (`loading-spinner`) and Camera Access Denied Error (`camera-error`) with a Retry button.

---

## 2. AI Models & Neural Networks

The system uses two concurrent Machine Learning models working in tandem.

### A. Object Detector (`object-detector.js`)
- **Model**: TensorFlow.js COCO-SSD
- **Base Network**: `lite_mobilenet_v2` (Chosen for high speed and mobile efficiency).
- **Functionality**: Processes the raw video frame and returns an array of detections. Each detection includes the `class` (name of the object, e.g., "person"), a confidence `score`, and a bounding box (`bbox: [x, y, width, height]`).
- **Threshold**: Only results with a confidence score `>= 0.6` (60%) are kept.

### B. Depth Estimation Engine (`depth-engine.js`)
- **Model**: Depth-Anything V2 Small (`Xenova/depth-anything-v2-small`).
- **Environment**: Ran entirely in the browser using huggingface `@xenova/transformers` (Transformers.js) over WebAssembly.
- **Functionality**: Generates a greyscale depth map where pixel intensity denotes relative depth. The engine normalizes the raw output tensor using a Min-Max normalization formula:
  - `normalized[i] = (raw[i] - min) / (max - min)`

---

## 3. Mathematical Formulas, Algorithms & Subsystems

The project uses several distinct mathematical approaches to analyze movement, depth, and geometry to provide user navigation instructions.

### A. Geometry Validator (`geometry-validator.js`)
This module estimates real-world distance based on the normalized depth map.
- **Region Filtering**: Only analyzes the central 40% width and 60% height of the image, as this is the corridor directly in front of the user.
- **Statistical Analysis**: Calculates the Mean, Variance, and Standard Deviation (to find sudden spikes in depth).
- **5th Percentile Formula**: To prevent outliers from breaking the system, it uses an array of 20 bins to construct a histogram. It finds the 5th percentile value (`percentile5`) of depth to represent the closest dominant object in the path.
- **Distance Formula**: Converts the normalized depth (`depthVal` between 0.05 and 1.0) into physical meters using an empirical formula:
  - `meters = 0.6 / max(0.05, depthVal)`
  - *Distances are clamped to a minimum of 0.3m and maximum of 12.0m.*

### B. Motion Detector (Optical Flow) (`motion-detector.js`)
Instead of a heavy tracking model, it relies on a manual sparse Optical Flow implementation (Simplified Lucas-Kanade approach).
- **Downsampling**: Resizes the image to 1/4th resolution for performance.
- **Sum of Absolute Differences (SAD)**: Compares 8x8 blocks of pixels between the current frame and the previous frame within a search range of 4 pixels. It finds the lowest SAD to create an `x,y` motion vector.
  - `SAD = Σ | pixel1_intensity - pixel2_intensity | / Total_Pixels`
- **Approaching Object Detection**: It calculates the dot product between a pixel's motion vector and the center of the screen. If the majority (> 60%) of the motion vectors expand *away* from the center, the object is mathematically deduced to be approaching the user.

### C. Fusion Logic (`fusion-logic.js`)
Acts as a decision matrix holding a temporal buffer (last 2 frames) to smooth out erratic predictions.
- **Overrides**: If geometry says `VERY_CLOSE`, it escalates immediately.
- **Confirmations**: If geometry proposes `NEAR` and motion confirms it is `approaching`, it dramatically increases the confidence.
- **Smoothing**: If data is unstable (high Variance in the last 3 frames), it defaults to predicting the most commonly occurring safety zone in the history buffer.

### D. Navigation Assistant (`navigation-assistant.js`)
Processes bounding boxes against depth mapped coordinates to tell the user what to do.
- **Target Selection**: Chooses the detected object with the largest area (`width * height`), assuming it's the biggest threat.
- **Dodge Formula**: Calculates relative X position (`centerX / frameWidth`):
  - If `relativeX < 0.33` (Left third) ➔ "Object on left, move right."
  - If `relativeX > 0.66` (Right third) ➔ "Object on right, move left."
  - Otherwise (Center) ➔ "Object ahead, move right" (default dodge).
- **Distance Mapping**: Overlays the Center X and Center Y of the bounding box onto the DepthMap Tensor to find the explicit distance of the tracked object.

---

## 4. Text-To-Speech / Audio Guide (`audio-guide.js`)
- **API**: Uses the browser's native `window.speechSynthesis`.
- **Voices**: It specifically queries `getVoices()` to find and use a female English speaking voice for calmer navigation.
- **Priority Queue & Cooldowns**: 
  - *Critical* messages (Very Close) interrupt any currently playing audio.
  - Standard messages enforce a **5-second cooldown** per zone to prevent spamming the user's ears.
  - Contains an emergency failsafe: If the state thinks speech is playing but over 5 seconds have passed, it forces a GC purge (`synthesis.cancel()`) to prevent the browser engine from getting stuck.
