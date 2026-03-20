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
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

        // Reusable buffers
        this.normalizedBuffer = null;
    }

    /**
     * Initialize the depth estimation model
     */
    async init() {
        if (this.isLoading || this.isReady) return;

        this.isLoading = true;
        console.log('[DepthEngine] Initializing depth estimation model...');

        try {
            // Load Transformers.js
            const { pipeline, env } = await import('@xenova/transformers');

            // Configure environment
            env.allowLocalModels = false;
            env.allowRemoteModels = true;
            env.backends.onnx.wasm.numThreads = 1;

            console.log('[DepthEngine] Loading Depth-Anything model...');

            // Initialize model
            this.model = await pipeline(
                'depth-estimation',
                CONFIG.MODEL.PRIMARY, // Use config model path
                { quantized: true }
            );

            // Setup canvas
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

            this.isReady = true;
            this.isLoading = false;
            console.log('[DepthEngine] Model loaded successfully');
            if (typeof VisionLog !== 'undefined') VisionLog.add('Depth-Anything V2 loaded', 'info');

            return { success: true };

        } catch (error) {
            console.error('[DepthEngine] Failed to load model:', error);
            this.isLoading = false;
            if (typeof VisionLog !== 'undefined') VisionLog.add('Depth engine failed to load', 'warn');
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract frame from video element
     */
    extractFrame(videoElement) {
        if (!videoElement || videoElement.readyState < 2) return null;

        // Check if canvas needs resizing
        if (this.canvas.width !== videoElement.videoWidth ||
            this.canvas.height !== videoElement.videoHeight) {
            this.canvas.width = videoElement.videoWidth;
            this.canvas.height = videoElement.videoHeight;
        }

        this.ctx.drawImage(videoElement, 0, 0);
        return this.canvas;
    }

    /**
     * Estimate depth from video frame
     */
    async estimateDepth(videoElement) {
        if (!this.isReady) {
            return { success: false, error: 'Model not ready' };
        }

        const startTime = performance.now();

        try {
            const frame = this.extractFrame(videoElement);
            if (!frame) return { success: false, error: 'Frame Error' };

            // Run inference
            const output = await this.model(frame);

            // Normalize
            const normalizedResult = this.normalizeDepthMap(output.depth, output.width, output.height);

            this.lastInferenceTime = performance.now() - startTime;

            return {
                success: true,
                depthMap: normalizedResult, // { data, width, height }
                inferenceTime: this.lastInferenceTime
            };

        } catch (error) {
            console.error('[DepthEngine] Inference error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Normalize depth map to 0-1 range (Reuse buffer)
     */
    normalizeDepthMap(depthTensor, width, height) {
        const data = depthTensor.data;
        const size = width * height;

        // Resize buffer if needed
        if (!this.normalizedBuffer || this.normalizedBuffer.length !== size) {
            this.normalizedBuffer = new Float32Array(size);
        }

        // 1. Find min/max
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < size; i++) {
            const val = data[i];
            if (val < min) min = val;
            if (val > max) max = val;
        }

        // 2. Normalize
        const range = max - min;
        const invRange = range > 0 ? 1.0 / range : 0;

        for (let i = 0; i < size; i++) {
            this.normalizedBuffer[i] = (data[i] - min) * invRange;
        }

        return {
            data: this.normalizedBuffer,
            width,
            height
        };
    }
}

export default DepthEngine;
