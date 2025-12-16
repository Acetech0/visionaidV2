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
        // this.debugToggleBtn removed

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
        this.facingMode = 'user'; // Default to user-facing (selfie)

        this.toggleBtn = document.getElementById('toggle-camera-btn');
        this.switchCameraBtn = document.getElementById('switch-camera-btn');
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
        // Check availability of statusDisplay before accessing
        if (this.systemStatus && this.systemStatus.parentElement) {
            this.systemStatus.parentElement.parentElement.style.display = 'flex';
        }

        // Show permission overlay and wait for user to grant access
        const permissionOverlay = document.getElementById('permission-overlay');
        const grantPermissionBtn = document.getElementById('grant-permission-btn');

        console.log('[VisionAid] Waiting for camera permission...');

        // Wait for user to click the permission button
        await new Promise((resolve) => {
            grantPermissionBtn.addEventListener('click', () => {
                console.log('[VisionAid] User clicked grant permission');
                permissionOverlay.classList.add('hidden');
                resolve();
            }, { once: true });
        });

        try {
            console.log('[VisionAid] Step 1: Initializing audio guide...');
            // Initialize audio guide
            const audioResult = this.audioGuide.init();
            if (audioResult.success) {
                this.audioGuide.speakSystem('MODEL_LOADING');
                this.updateAudioStatus('Ready');
                console.log('[VisionAid] Audio guide initialized successfully');
            } else {
                this.updateAudioStatus('Unavailable');
                console.warn('[VisionAid] Audio guide unavailable');
            }

            console.log('[VisionAid] Step 2: Setting up camera controls...');
            // Set up camera controls
            this.setupCameraControls();
            console.log('[VisionAid] Camera controls set up');

            console.log('[VisionAid] Step 3: Starting camera...');
            // Start camera
            await this.startCamera();
            console.log('[VisionAid] Camera started successfully');

            console.log('[VisionAid] Step 4: Initializing depth engine...');
            // Initialize depth engine
            this.updateSystemStatus('Loading AI model...');
            const depthResult = await this.depthEngine.init();
            console.log('[VisionAid] Depth engine init result:', depthResult);

            if (!depthResult.success) {
                console.error('[VisionAid] Depth engine failed to initialize');
                throw new Error('Failed to initialize depth engine');
            }
            console.log('[VisionAid] Depth engine initialized successfully');

            console.log('[VisionAid] Step 5: Finalizing initialization...');
            this.updateSystemStatus('Ready');
            this.audioGuide.speakSystem('SYSTEM_READY');

            // Start processing loop
            this.isRunning = true;
            this.processFrame();

            console.log('[VisionAid] ✓ Initialization complete - System ready');

        } catch (error) {
            console.error('[VisionAid] Initialization failed:', error);
            this.updateSystemStatus('Error: ' + error.message);
            this.audioGuide.speakSystem('CAMERA_ERROR');
        }
    }

    // ... (existing methods) ...

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

        if (this.switchCameraBtn) {
            this.switchCameraBtn.addEventListener('click', () => this.switchCamera());
        }

        this.retryBtn.addEventListener('click', () => this.startCamera());

        window.addEventListener('beforeunload', () => {
            this.stopCamera();
        });
    }

    async switchCamera() {
        // Toggle facing mode
        this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
        console.log(`[VisionAid] Switching camera to: ${this.facingMode}`);

        // Restart camera if it's currently on
        if (this.isCameraOn) {
            await this.stopCamera();
            await this.startCamera();
        }
    }

    async startCamera() {
        console.log('[Camera] Starting camera initialization...');
        try {
            if (this.currentStream) {
                console.log('[Camera] Stopping existing stream...');
                this.currentStream.getTracks().forEach(track => track.stop());
            }

            this.errorMessage.classList.add('hidden');
            this.loadingSpinner.classList.remove('hidden');
            console.log('[Camera] UI updated - showing spinner');

            const constraints = {
                video: {
                    facingMode: this.facingMode,
                    width: { ideal: 1280 }, // Lower resolution slightly for better mobile performance
                    height: { ideal: 720 }
                },
                audio: false
            };
            console.log('[Camera] Requesting camera with constraints:', constraints);

            this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('[Camera] ✓ Camera stream obtained successfully');

            this.videoElement.srcObject = this.currentStream;

            // Mirror only if using front camera (user)
            this.videoElement.style.transform = this.facingMode === 'user' ? 'scaleX(-1)' : 'none';
            console.log('[Camera] Video element configured, waiting for metadata...');

            this.videoElement.onloadedmetadata = () => {
                console.log('[Camera] ✓ Video metadata loaded');
                this.loadingSpinner.classList.add('hidden');
                this.videoElement.play();
                this.statusIndicator.classList.add('active');
                this.updateToggleButtonState(true);
                console.log('[Camera] ✓ Camera fully initialized and playing');
            };

        } catch (err) {
            console.error("[Camera] Error accessing camera:", err);
            console.error("[Camera] Error name:", err.name);
            console.error("[Camera] Error message:", err.message);
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
