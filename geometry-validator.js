/**
 * VisionAid V2 - Geometry Validator
 * Layer 2: Geometry-based distance validation
 */

import { CONFIG, ZONE_LABELS } from './config.js';

class GeometryValidator {
    constructor() {
        // Improvement #9: adaptive depth scale K
        this.EXPECTED_BASELINE = 0.1;   // expected median center depth for ~6m open corridor
        this.K_BASE            = 0.6;   // empirical constant from original calibration
        this.adaptiveK         = 0.6;   // starts at baseline, updates after calibration
        this._calibSamples     = [];    // accumulates center-path depth samples
        this._calibFrames      = 0;
        this._calibDone        = false;
        this.CALIB_FRAMES      = 20;    // number of startup frames to sample
    }

    /**
     * Analyze depth map using geometric constraints
     * Optimized single-pass implementation
     * @param {Object} depthMap - Normalized depth map from depth engine
     * @returns {Object} Geometry analysis results
     */
    analyze(depthMap) {
        if (!depthMap || !depthMap.data) {
            return { success: false, error: 'Invalid depth map' };
        }

        try {
            const { data, width, height } = depthMap;

            // Calculate central region bounds
            const regionW = Math.floor(width * CONFIG.VIDEO.CENTRAL_REGION_WIDTH);
            const regionH = Math.floor(height * CONFIG.VIDEO.CENTRAL_REGION_HEIGHT);
            const startX = Math.floor((width - regionW) / 2);
            const startY = Math.floor((height - regionH) / 2);

            // Single pass statistics
            let min = 1.0;
            let sum = 0;
            let sumSq = 0;
            let count = 0;

            // Histogram for percentile estimation (20 bins for 5% resolution)
            const bins = new Uint32Array(20);

            for (let y = 0; y < regionH; y++) {
                const rowOffset = (startY + y) * width;
                const rowStart = rowOffset + startX;
                for (let x = 0; x < regionW; x++) {
                    const val = data[rowStart + x];

                    if (val < min) min = val;
                    sum += val;
                    sumSq += val * val;

                    // Binning for percentile
                    // Clamp index between 0 and 19
                    const binIdx = Math.min(19, Math.floor(val * 20));
                    bins[binIdx]++;

                    count++;
                }
            }

            if (count === 0) return { success: false, error: 'Empty region' };

            // Calculate statistics
            const mean = sum / count;
            const variance = (sumSq / count) - (mean * mean);
            const stdDev = Math.sqrt(Math.max(0, variance));

            // Estimate 5th percentile (robust minimum)
            let percentile5 = min;
            let countAccum = 0;
            const targetCount = count * 0.05;

            for (let i = 0; i < 20; i++) {
                countAccum += bins[i];
                if (countAccum >= targetCount) {
                    // Use the lower bound of the bin as a safe estimate
                    percentile5 = i / 20.0;
                    break;
                }
            }

            // Detect depth discontinuities (high variance)
            const hasDiscontinuity = stdDev > CONFIG.DEPTH_SPIKE_THRESHOLD;

            // Improvement #9: adaptive K calibration (first CALIB_FRAMES frames)
            if (!this._calibDone) {
                this._calibSamples.push(mean);
                this._calibFrames++;
                if (this._calibFrames >= this.CALIB_FRAMES) {
                    const avgBaseline = this._calibSamples.reduce((s, v) => s + v, 0) / this._calibSamples.length;
                    this.adaptiveK = this.K_BASE * (avgBaseline / this.EXPECTED_BASELINE);
                    // Clamp to sane range [0.3, 1.5]
                    this.adaptiveK = Math.min(1.5, Math.max(0.3, this.adaptiveK));
                    this._calibDone = true;
                    console.log(`[GeometryValidator] Adaptive K calibrated: ${this.adaptiveK.toFixed(3)}`);
                    if (typeof VisionLog !== 'undefined') {
                        VisionLog.add(`Depth scale K=${this.adaptiveK.toFixed(2)} calibrated`, 'info');
                    }
                }
            }

            // Convert to distance/zone using adaptiveK
            const distanceMeters = this.estimateDistance(percentile5);

            let zone = ZONE_LABELS.CLEAR;
            if (distanceMeters < CONFIG.ZONES.VERY_CLOSE) zone = ZONE_LABELS.VERY_CLOSE;
            else if (distanceMeters < CONFIG.ZONES.NEAR)  zone = ZONE_LABELS.NEAR;

            // Calculate confidence
            const confidence = Math.max(0, 1 - (stdDev / 0.5));

            return {
                success: true,
                zone,
                distanceMeters,
                minDepth: percentile5,
                hasDiscontinuity,
                confidence,
                adaptiveK: this.adaptiveK,
                centralDepthStats: { mean, min, stdDev }
            };

        } catch (error) {
            console.error('[GeometryValidator] Analysis error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Estimate rough distance in meters from normalized depth.
     * Improvement #9: uses adaptiveK instead of hardcoded 0.6
     */
    estimateDistance(depthVal) {
        const safeDisp = Math.max(0.05, depthVal);
        const estimatedMeters = this.adaptiveK / safeDisp;
        return Math.min(Math.max(estimatedMeters, 0.3), 12.0);
    }

    /**
     * Expose the current adaptive K for other modules (e.g., navigation-assistant).
     */
    getAdaptiveK() {
        return this.adaptiveK;
    }
}

export default GeometryValidator;
