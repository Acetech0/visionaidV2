/**
 * VisionAid V2 - Main Application
 * Integrates all subsystems for real-time obstacle detection and voice guidance
 */

import DepthEngine from './depth-engine.js';
import GeometryValidator from './geometry-validator.js';
import MotionDetector from './motion-detector.js';
import FusionLogic from './fusion-logic.js';
import AudioGuide from './audio-guide.js';
import { CONFIG, ZONE_LABELS } from './config.js';

class VisionAidApp {
    constructor() {
        // Core subsystems
        this.depthEngine = new DepthEngine();
        this.geometryValidator = new GeometryValidator();
        this.motionDetector = new MotionDetector();
        this.fusionLogic = new FusionLogic();
        this.audioGuide = new AudioGuide();

        // UI elements
        this.videoElement = document.getElementById('camera-feed');
        this.zoneIndicator = document.getElementById('zone-indicator');
        this.zoneIcon = document.querySelector('.zone-icon');
        this.zoneText = document.querySelector('.zone-text');
        this.systemStatus = document.getElementById('system-status');
        this.fpsDisplay = document.getElementById('fps-display');
        this.audioStatus = document.getElementById('audio-status');
        this.depthCanvas = document.getElementById('depth-canvas');
        this.debugToggleBtn = document.getElementById('debug-toggle-btn');

        // State
        this.isRunning = false;
        this.isPaused = false;
        this.frameCount = 0;
        this.lastFpsUpdate = Date.now();
        this.currentFPS = 0;
        this.animationFrameId = null;

        // Camera controls
        this.currentStream = null;
        this.isCameraOn = true;
        this.toggleBtn = document.getElementById('toggle-camera-btn');
        this.retryBtn = document.getElementById('retry-btn');
        this.loadingSpinner = document.getElementById('loading-spinner');
        this.errorMessage = document.getElementById('camera-error');
        this.statusIndicator = document.querySelector('.status-indicator');
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('[VisionAid] Initializing...');
        this.updateSystemStatus('Initializing...');

        // Show VisionAid V2 elements
        if (this.zoneIndicator) this.zoneIndicator.style.display = 'flex';
        if (this.statusDisplay) this.statusDisplay.style.display = 'flex';
        if (this.debugToggleBtn) this.debugToggleBtn.style.display = 'flex';

        try {
            // Initialize audio guide
            const audioResult = this.audioGuide.init();
            if (audioResult.success) {
                this.audioGuide.speakSystem('MODEL_LOADING');
                this.updateAudioStatus('Ready');
            } else {
                this.updateAudioStatus('Unavailable');
            }

            // Set up camera controls
            this.setupCameraControls();

            // Set up debug toggle
            this.debugToggleBtn.addEventListener('click', () => this.toggleDebug());

            // Start camera (back camera only)
            await this.startCamera();

            // Initialize depth engine
            this.updateSystemStatus('Loading AI model...');
            const depthResult = await this.depthEngine.init();

            if (!depthResult.success) {
                throw new Error('Failed to initialize depth engine');
            }

            if (depthResult.demoMode) {
                this.updateSystemStatus('Ready (Demo Mode)');
                console.warn('[VisionAid] Running in DEMO MODE - using simulated depth estimation');
            } else {
                this.updateSystemStatus('Ready');
            }

            this.audioGuide.speakSystem('SYSTEM_READY');

            // Start processing loop
            this.isRunning = true;
            this.processFrame();

            console.log('[VisionAid] Initialization complete');

        } catch (error) {
            console.error('[VisionAid] Initialization failed:', error);
            this.updateSystemStatus('Error: ' + error.message);
            this.audioGuide.speakSystem('CAMERA_ERROR');
        }
    }

    /**
     * Main processing loop
     */
    async processFrame() {
        if (!this.isRunning || this.isPaused) {
            return;
        }

        const frameStart = performance.now();

        try {
            // Layer 1: Depth estimation
            const depthResult = await this.depthEngine.estimateDepth(this.videoElement);

            if (!depthResult.success) {
                console.warn('[VisionAid] Depth estimation failed:', depthResult.error);
            }

            // Layer 2: Geometry validation
            const geometryResult = this.geometryValidator.analyze(depthResult.depthMap || {});

            // Layer 3: Motion detection
            const motionResult = this.motionDetector.detect(this.videoElement);

            // Fusion
            const fusionResult = this.fusionLogic.fuse(
                depthResult,
                geometryResult,
                motionResult
            );

            // Audio guidance
            this.audioGuide.updateGuidance(fusionResult);

            // Update UI
            this.updateUI(fusionResult, depthResult);

            // Debug visualization
            if (CONFIG.DEBUG.ENABLED && CONFIG.DEBUG.SHOW_DEPTH_MAP && depthResult.depthMap) {
                this.visualizeDepthMap(depthResult.depthMap);
            }

            // Update FPS
            this.updateFPS(frameStart);

        } catch (error) {
            console.error('[VisionAid] Processing error:', error);
        }

        // Schedule next frame
        this.animationFrameId = requestAnimationFrame(() => this.processFrame());
    }

    /**
     * Update UI based on fusion result
     */
    updateUI(fusionResult, depthResult) {
        if (!fusionResult.success) return;

        const zone = fusionResult.zone;
        const confidence = fusionResult.confidence;

        // Update zone indicator
        this.zoneText.textContent = zone;

        // Update zone indicator color
        this.zoneIndicator.className = 'zone-indicator';
        if (zone === ZONE_LABELS.VERY_CLOSE) {
            this.zoneIndicator.classList.add('zone-danger');
        } else if (zone === ZONE_LABELS.NEAR) {
            this.zoneIndicator.classList.add('zone-warning');
        } else if (zone === ZONE_LABELS.CLEAR) {
            this.zoneIndicator.classList.add('zone-safe');
        }

        // Update audio status
        if (this.audioGuide.isSpeaking) {
            this.updateAudioStatus('Speaking');
        } else {
            this.updateAudioStatus('Ready');
        }

        // Log in debug mode
        if (CONFIG.DEBUG.LOG_DETECTIONS) {
            console.log('[VisionAid]', {
                zone,
                confidence: confidence.toFixed(2),
                reasoning: fusionResult.reasoning,
                inferenceTime: depthResult.inferenceTime?.toFixed(1) + 'ms'
            });
        }
    }

    /**
     * Visualize depth map on debug canvas
     */
    visualizeDepthMap(depthMap) {
        const { data, width, height } = depthMap;

        this.depthCanvas.width = width;
        this.depthCanvas.height = height;

        const ctx = this.depthCanvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        // Convert depth to grayscale
        for (let i = 0; i < data.length; i++) {
            const value = Math.floor(data[i] * 255);
            const offset = i * 4;
            imageData.data[offset] = value;
            imageData.data[offset + 1] = value;
            imageData.data[offset + 2] = value;
            imageData.data[offset + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Update FPS display
     */
    updateFPS(frameStart) {
        this.frameCount++;
        const now = Date.now();

        if (now - this.lastFpsUpdate >= 1000) {
            this.currentFPS = this.frameCount;
            this.fpsDisplay.textContent = this.currentFPS;

            // Color code FPS
            if (this.currentFPS >= CONFIG.TARGET_FPS) {
                this.fpsDisplay.style.color = '#10b981';
            } else if (this.currentFPS >= CONFIG.TARGET_FPS * 0.7) {
                this.fpsDisplay.style.color = '#f59e0b';
            } else {
                this.fpsDisplay.style.color = '#ef4444';
            }

            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
    }

    /**
     * Toggle debug mode
     */
    toggleDebug() {
        CONFIG.DEBUG.ENABLED = !CONFIG.DEBUG.ENABLED;
        CONFIG.DEBUG.SHOW_DEPTH_MAP = CONFIG.DEBUG.ENABLED;
        CONFIG.DEBUG.LOG_DETECTIONS = CONFIG.DEBUG.ENABLED;

        if (CONFIG.DEBUG.ENABLED) {
            this.depthCanvas.classList.remove('hidden');
            this.debugToggleBtn.classList.add('active');
            console.log('[VisionAid] Debug mode enabled');
        } else {
            this.depthCanvas.classList.add('hidden');
            this.debugToggleBtn.classList.remove('active');
            console.log('[VisionAid] Debug mode disabled');
        }
    }

    /**
     * Update system status display
     */
    updateSystemStatus(status) {
        if (this.systemStatus) {
            this.systemStatus.textContent = status;
        }
    }

    /**
     * Update audio status display
     */
    updateAudioStatus(status) {
        if (this.audioStatus) {
            this.audioStatus.textContent = status;
        }
    }

    // ========== Camera Control Methods ==========

    setupCameraControls() {
        this.toggleBtn.addEventListener('click', () => {
            if (this.isCameraOn) {
                this.stopCamera();
                this.isPaused = true;
            } else {
                this.startCamera();
                this.isPaused = false;
            }
        });

        this.retryBtn.addEventListener('click', () => this.startCamera());

        window.addEventListener('beforeunload', () => {
            this.stopCamera();
        });
    }

    async startCamera() {
        try {
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => track.stop());
            }

            this.errorMessage.classList.add('hidden');
            this.loadingSpinner.classList.remove('hidden');

            // Always use back camera for obstacle detection
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            };

            this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.currentStream;
            this.videoElement.style.transform = 'scaleX(1)';

            this.videoElement.onloadedmetadata = () => {
                this.loadingSpinner.classList.add('hidden');
                this.videoElement.play();
                this.statusIndicator.classList.add('active');
                this.updateToggleButtonState(true);
            };

        } catch (err) {
            console.error("Error accessing camera:", err);
            this.loadingSpinner.classList.add('hidden');
            this.errorMessage.classList.remove('hidden');
            this.statusIndicator.classList.remove('active');
            this.updateToggleButtonState(false);
        }
    }

    stopCamera() {
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.videoElement.srcObject = null;
            this.currentStream = null;
        }
        this.statusIndicator.classList.remove('active');
        this.updateToggleButtonState(false);
    }

    updateToggleButtonState(isOn) {
        this.isCameraOn = isOn;
        if (isOn) {
            this.toggleBtn.classList.remove('off');
            this.toggleBtn.classList.add('active');
            this.toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;
        } else {
            this.toggleBtn.classList.remove('active');
            this.toggleBtn.classList.add('off');
            this.toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 21l-2-2m-3.268-3.268L6 6"></path><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path></svg>`;
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new VisionAidApp();
    app.init();
});
