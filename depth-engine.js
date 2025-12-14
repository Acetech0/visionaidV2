/**
 * VisionAid V2 - Depth Estimation Engine
 * Layer 1: Primary depth estimation using Depth-Anything v2
 * 
 * NOTE: Due to Hugging Face access restrictions, this includes a demo mode
 * that simulates depth estimation for testing purposes.
 */

import { CONFIG } from './config.js';

class DepthEngine {
    constructor() {
        this.model = null;
        this.isLoading = false;
        this.isReady = false;
        this.lastInferenceTime = 0;
        this.canvas = null;
        this.ctx = null;
        this.demoMode = false;
    }

    /**
     * Initialize the depth estimation model
     */
    async init() {
        if (this.isLoading || this.isReady) return;

        this.isLoading = true;
        console.log('[DepthEngine] Initializing depth estimation model...');

        try {
            // Try to load Transformers.js
            const { pipeline, env } = await import('@xenova/transformers');

            // Configure environment
            env.allowLocalModels = false;
            env.allowRemoteModels = true;
            env.backends.onnx.wasm.numThreads = 1;

            console.log('[DepthEngine] Loading Depth-Anything model from Hugging Face...');
            console.log('[DepthEngine] This may take a few minutes on first load...');

            // Try to load the model with timeout
            const modelPromise = pipeline(
                'depth-estimation',
                'Xenova/depth-anything-small',
                {
                    quantized: true,
                    progress_callback: (progress) => {
                        if (progress.status === 'downloading') {
                            console.log(`[DepthEngine] Downloading: ${progress.file} - ${Math.round(progress.progress || 0)}%`);
                        }
                    }
                }
            );

            // Set a timeout for model loading
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Model loading timeout')), 30000)
            );

            this.model = await Promise.race([modelPromise, timeoutPromise]);

            // Create canvas for frame extraction
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

            this.isReady = true;
            this.isLoading = false;
            this.demoMode = false;
            console.log('[DepthEngine] Model loaded successfully');

            return { success: true };

        } catch (error) {
            console.warn('[DepthEngine] Failed to load AI model:', error.message);
            console.log('[DepthEngine] Switching to DEMO MODE for testing...');

            // Fall back to demo mode
            this.demoMode = true;
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

            this.isReady = true;
            this.isLoading = false;

            return {
                success: true,
                demoMode: true,
                message: 'Running in demo mode (simulated depth estimation)'
            };
        }
    }

    /**
     * Extract and preprocess frame from video element
     */
    extractFrame(videoElement) {
        if (!videoElement || videoElement.readyState < 2) {
            return null;
        }

        // Set canvas size to match video
        this.canvas.width = videoElement.videoWidth;
        this.canvas.height = videoElement.videoHeight;

        // Draw current video frame to canvas
        this.ctx.drawImage(videoElement, 0, 0);

        return this.canvas;
    }

    /**
     * Estimate depth from video frame
     * @param {HTMLVideoElement} videoElement - Video element to process
     * @returns {Promise<Object>} Depth map and metadata
     */
    async estimateDepth(videoElement) {
        if (!this.isReady) {
            return { success: false, error: 'Model not ready' };
        }

        const startTime = performance.now();

        try {
            // Extract frame
            const frame = this.extractFrame(videoElement);
            if (!frame) {
                return { success: false, error: 'Failed to extract frame' };
            }

            let depthData, width, height;

            if (this.demoMode) {
                // Demo mode: Generate simulated depth map
                ({ depthData, width, height } = this.generateDemoDepthMap(frame));
            } else {
                // Real mode: Use AI model
                const output = await this.model(frame);
                depthData = output.depth;
                width = output.width;
                height = output.height;
            }

            // Normalize depth map to 0-1 range
            const normalizedDepth = this.normalizeDepthMap(depthData, width, height);

            this.lastInferenceTime = performance.now() - startTime;

            return {
                success: true,
                depthMap: normalizedDepth,
                width,
                height,
                inferenceTime: this.lastInferenceTime,
                demoMode: this.demoMode
            };

        } catch (error) {
            console.error('[DepthEngine] Inference error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate simulated depth map for demo mode
     * Uses brightness as a proxy for depth (darker = closer)
     */
    generateDemoDepthMap(canvas) {
        const width = canvas.width;
        const height = canvas.height;
        const imageData = this.ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        const depthData = new Float32Array(width * height);

        // Convert to grayscale and invert (darker = closer in real world)
        for (let i = 0; i < width * height; i++) {
            const offset = i * 4;
            // Calculate brightness
            const brightness = (
                pixels[offset] * 0.299 +
                pixels[offset + 1] * 0.587 +
                pixels[offset + 2] * 0.114
            ) / 255;

            // Invert: darker pixels = closer objects (lower depth value)
            // Add some noise for realism
            const noise = (Math.random() - 0.5) * 0.1;
            depthData[i] = Math.max(0, Math.min(1, 1 - brightness + noise));
        }

        return {
            depthData: { data: depthData },
            width,
            height
        };
    }

    /**
     * Normalize depth map to 0-1 range
     * 0 = closest, 1 = farthest
     */
    normalizeDepthMap(depthTensor, width, height) {
        const data = depthTensor.data;
        const size = width * height;

        // Find min and max values
        let min = Infinity;
        let max = -Infinity;

        for (let i = 0; i < size; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }

        // Normalize to 0-1 range
        const range = max - min;
        const normalized = new Float32Array(size);

        for (let i = 0; i < size; i++) {
            normalized[i] = range > 0 ? (data[i] - min) / range : 0;
        }

        return {
            data: normalized,
            width,
            height,
            min,
            max
        };
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        return {
            isReady: this.isReady,
            demoMode: this.demoMode,
            lastInferenceTime: this.lastInferenceTime,
            estimatedFPS: this.lastInferenceTime > 0 ? 1000 / this.lastInferenceTime : 0
        };
    }
}

export default DepthEngine;
