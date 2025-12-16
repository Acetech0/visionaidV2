/**
 * VisionAid V2 - Geometry Validator
 * Layer 2: Geometry-based distance validation
 */

import { CONFIG, ZONE_LABELS } from './config.js';

class GeometryValidator {
    constructor() {
        // No caching needed for single-pass approach
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

            // Convert to distance/zone
            const distanceMeters = this.estimateDistance(percentile5);

            let zone = ZONE_LABELS.CLEAR;
            if (distanceMeters < CONFIG.ZONES.VERY_CLOSE) zone = ZONE_LABELS.VERY_CLOSE;
            else if (distanceMeters < CONFIG.ZONES.NEAR) zone = ZONE_LABELS.NEAR;

            // Calculate confidence
            const confidence = Math.max(0, 1 - (stdDev / 0.5));

            return {
                success: true,
                zone,
                distanceMeters,
                minDepth: percentile5,
                hasDiscontinuity,
                confidence,
                centralDepthStats: { mean, min, stdDev }
            };

        } catch (error) {
            console.error('[GeometryValidator] Analysis error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Estimate rough distance in meters from normalized depth
     */
    estimateDistance(depthVal) {
        // Empirically tuned mapping
        // depthVal: 0 (far) to 1 (close)

        // Inverse relationship: Distance ~ 1/Depth
        // If max depth (1.0) is ~0.5m (very close)
        // Then min depth (0.05) should be ~10m+

        const safeDisp = Math.max(0.05, depthVal);
        // Scalar K = 0.5 * 1.0 = 0.5 (for close range consistency) -> Too small
        // Let's try matching the users range:
        // very close < 3m. depth > ~0.2
        // near < 6m. depth > ~0.1

        // func: meters = K / depth
        // 3 = K / 0.2 -> K = 0.6
        // Check: 6 = 0.6 / 0.1 -> matches.

        const K = 0.6;
        const estimatedMeters = K / safeDisp;

        // Clamp to reasonable range [0.3m, 12.0m]
        return Math.min(Math.max(estimatedMeters, 0.3), 12.0);
    }
}

export default GeometryValidator;
