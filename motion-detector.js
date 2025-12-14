/**
 * VisionAid V2 - Motion Detector
 * Layer 3: Motion and temporal validation using optical flow
 */

import { CONFIG } from './config.js';

class MotionDetector {
    constructor() {
        this.previousFrame = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.motionHistory = [];
    }

    /**
     * Detect motion between current and previous frame
     * @param {HTMLVideoElement} videoElement - Current video frame
     * @returns {Object} Motion analysis results
     */
    detect(videoElement) {
        if (!videoElement || videoElement.readyState < 2) {
            return { success: false, error: 'Video not ready' };
        }

        try {
            // Extract current frame
            const currentFrame = this.extractGrayscaleFrame(videoElement);

            if (!this.previousFrame) {
                this.previousFrame = currentFrame;
                return {
                    success: true,
                    hasMotion: false,
                    isApproaching: false,
                    motionMagnitude: 0
                };
            }

            // Calculate sparse optical flow
            const motionVectors = this.calculateOpticalFlow(
                this.previousFrame,
                currentFrame
            );

            // Analyze motion in central region
            const motionAnalysis = this.analyzeMotion(motionVectors);

            // Update history
            this.motionHistory.push(motionAnalysis.motionMagnitude);
            if (this.motionHistory.length > CONFIG.TEMPORAL_BUFFER_SIZE) {
                this.motionHistory.shift();
            }

            // Store current frame for next iteration
            this.previousFrame = currentFrame;

            return {
                success: true,
                hasMotion: motionAnalysis.hasMotion,
                isApproaching: motionAnalysis.isApproaching,
                motionMagnitude: motionAnalysis.motionMagnitude,
                motionDirection: motionAnalysis.direction
            };

        } catch (error) {
            console.error('[MotionDetector] Detection error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract grayscale frame for motion detection
     */
    extractGrayscaleFrame(videoElement) {
        const width = videoElement.videoWidth;
        const height = videoElement.videoHeight;

        // Downsample for performance (quarter resolution)
        const scaledWidth = Math.floor(width / 4);
        const scaledHeight = Math.floor(height / 4);

        this.canvas.width = scaledWidth;
        this.canvas.height = scaledHeight;

        // Draw and convert to grayscale
        this.ctx.drawImage(videoElement, 0, 0, scaledWidth, scaledHeight);
        const imageData = this.ctx.getImageData(0, 0, scaledWidth, scaledHeight);
        const grayscale = new Uint8Array(scaledWidth * scaledHeight);

        for (let i = 0; i < grayscale.length; i++) {
            const offset = i * 4;
            // Convert to grayscale using luminance formula
            grayscale[i] = Math.floor(
                0.299 * imageData.data[offset] +
                0.587 * imageData.data[offset + 1] +
                0.114 * imageData.data[offset + 2]
            );
        }

        return {
            data: grayscale,
            width: scaledWidth,
            height: scaledHeight
        };
    }

    /**
     * Calculate sparse optical flow (simplified Lucas-Kanade)
     */
    calculateOpticalFlow(prevFrame, currFrame) {
        const { width, height } = currFrame;
        const blockSize = 8; // Size of blocks to track
        const motionVectors = [];

        // Sample points in central region only
        const centralWidth = Math.floor(width * CONFIG.VIDEO.CENTRAL_REGION_WIDTH);
        const centralHeight = Math.floor(height * CONFIG.VIDEO.CENTRAL_REGION_HEIGHT);
        const startX = Math.floor((width - centralWidth) / 2);
        const startY = Math.floor((height - centralHeight) / 2);

        // Calculate motion for sparse grid of points
        for (let y = startY; y < startY + centralHeight; y += blockSize) {
            for (let x = startX; x < startX + centralWidth; x += blockSize) {
                const motion = this.estimateBlockMotion(
                    prevFrame,
                    currFrame,
                    x,
                    y,
                    blockSize
                );

                if (motion) {
                    motionVectors.push(motion);
                }
            }
        }

        return motionVectors;
    }

    /**
     * Estimate motion for a single block (simplified)
     */
    estimateBlockMotion(prevFrame, currFrame, x, y, blockSize) {
        const { width, height } = currFrame;
        const searchRange = 4; // Pixels to search in each direction

        let bestMatch = Infinity;
        let bestDx = 0;
        let bestDy = 0;

        // Search for best match in neighborhood
        for (let dy = -searchRange; dy <= searchRange; dy++) {
            for (let dx = -searchRange; dx <= searchRange; dx++) {
                const sad = this.calculateSAD(
                    prevFrame,
                    currFrame,
                    x,
                    y,
                    x + dx,
                    y + dy,
                    blockSize
                );

                if (sad < bestMatch) {
                    bestMatch = sad;
                    bestDx = dx;
                    bestDy = dy;
                }
            }
        }

        return {
            x,
            y,
            dx: bestDx,
            dy: bestDy,
            magnitude: Math.sqrt(bestDx * bestDx + bestDy * bestDy)
        };
    }

    /**
     * Calculate Sum of Absolute Differences (SAD)
     */
    calculateSAD(frame1, frame2, x1, y1, x2, y2, blockSize) {
        const { width, height } = frame1;
        let sad = 0;
        let count = 0;

        for (let by = 0; by < blockSize; by++) {
            for (let bx = 0; bx < blockSize; bx++) {
                const px1 = x1 + bx;
                const py1 = y1 + by;
                const px2 = x2 + bx;
                const py2 = y2 + by;

                // Check bounds
                if (px1 >= 0 && px1 < width && py1 >= 0 && py1 < height &&
                    px2 >= 0 && px2 < width && py2 >= 0 && py2 < height) {
                    const idx1 = py1 * width + px1;
                    const idx2 = py2 * width + px2;
                    sad += Math.abs(frame1.data[idx1] - frame2.data[idx2]);
                    count++;
                }
            }
        }

        return count > 0 ? sad / count : Infinity;
    }

    /**
     * Analyze motion vectors to detect approaching objects
     */
    analyzeMotion(motionVectors) {
        if (!motionVectors || motionVectors.length === 0) {
            return {
                hasMotion: false,
                isApproaching: false,
                motionMagnitude: 0,
                direction: { x: 0, y: 0 }
            };
        }

        // Calculate average motion magnitude
        const avgMagnitude = motionVectors.reduce((sum, v) => sum + v.magnitude, 0) / motionVectors.length;

        // Calculate average motion direction
        const avgDx = motionVectors.reduce((sum, v) => sum + v.dx, 0) / motionVectors.length;
        const avgDy = motionVectors.reduce((sum, v) => sum + v.dy, 0) / motionVectors.length;

        // Detect if motion is significant
        const hasMotion = avgMagnitude > CONFIG.MOTION_THRESHOLD;

        // Detect approaching motion (expansion pattern or forward motion)
        // In a camera view, approaching objects appear to expand outward from center
        const isApproaching = this.detectApproachingPattern(motionVectors);

        return {
            hasMotion,
            isApproaching,
            motionMagnitude: avgMagnitude,
            direction: { x: avgDx, y: avgDy }
        };
    }

    /**
     * Detect if motion pattern indicates approaching object
     */
    detectApproachingPattern(motionVectors) {
        if (motionVectors.length < 4) return false;

        // Count vectors moving outward from center
        const { width, height } = this.canvas;
        const centerX = width / 2;
        const centerY = height / 2;

        let outwardCount = 0;

        for (const vector of motionVectors) {
            // Vector from center to point
            const toCenterX = vector.x - centerX;
            const toCenterY = vector.y - centerY;

            // Dot product with motion vector
            const dotProduct = toCenterX * vector.dx + toCenterY * vector.dy;

            // Positive dot product means moving away from center (expansion)
            if (dotProduct > 0 && vector.magnitude > CONFIG.MOTION_THRESHOLD) {
                outwardCount++;
            }
        }

        // If majority of motion is outward, object is approaching
        return outwardCount > motionVectors.length * 0.6;
    }

    /**
     * Reset motion detector state
     */
    reset() {
        this.previousFrame = null;
        this.motionHistory = [];
    }
}

export default MotionDetector;
