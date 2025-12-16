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
        // ... (existing init code) ...
        console.log('[VisionAid] Initializing...');
        this.updateSystemStatus('Initializing...');

        // Show VisionAid V2 elements
        if (this.zoneIndicator) this.zoneIndicator.style.display = 'flex';
        // Check availability of statusDisplay before accessing
        if (this.systemStatus && this.systemStatus.parentElement) {
            this.systemStatus.parentElement.parentElement.style.display = 'flex';
        }
        if (this.debugToggleBtn) this.debugToggleBtn.style.display = 'flex';

        try {
            // ... (rest of init)
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

            // Start camera
            await this.startCamera();

            // Initialize depth engine
            this.updateSystemStatus('Loading AI model...');
            const depthResult = await this.depthEngine.init();

            if (!depthResult.success) {
                throw new Error('Failed to initialize depth engine');
            }

            this.updateSystemStatus('Ready');
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
        try {
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => track.stop());
            }

            this.errorMessage.classList.add('hidden');
            this.loadingSpinner.classList.remove('hidden');

            const constraints = {
                video: {
                    facingMode: this.facingMode,
                    width: { ideal: 1280 }, // Lower resolution slightly for better mobile performance
                    height: { ideal: 720 }
                },
                audio: false
            };

            this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.currentStream;

            // Mirror only if using front camera (user)
            this.videoElement.style.transform = this.facingMode === 'user' ? 'scaleX(-1)' : 'none';

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
