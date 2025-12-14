/**
 * VisionAid V2 - Geometry Validator
 * Layer 2: Geometry-based distance validation
 */

import { CONFIG, ZONE_LABELS } from './config.js';

class GeometryValidator {
    constructor() {
        this.centralRegionCache = null;
    }

    /**
     * Analyze depth map using geometric constraints
     * @param {Object} depthMap - Normalized depth map from depth engine
     * @returns {Object} Geometry analysis results
     */
    analyze(depthMap) {
        if (!depthMap || !depthMap.data) {
            return { success: false, error: 'Invalid depth map' };
        }

        try {
            // Extract central corridor region
            const centralDepth = this.extractCentralRegion(depthMap);

            // Find minimum depth in central region (closest obstacle)
            const minDepth = this.findMinimumDepth(centralDepth);

            // Detect depth discontinuities (sudden obstacles)
            const hasDiscontinuity = this.detectDiscontinuities(centralDepth);

            // Convert depth to distance zone
            const zone = this.depthToZone(minDepth);

            // Calculate confidence based on depth variance
            const confidence = this.calculateConfidence(centralDepth);

            return {
                success: true,
                zone,
                minDepth,
                hasDiscontinuity,
                confidence,
                centralDepthStats: this.getDepthStats(centralDepth)
            };

        } catch (error) {
            console.error('[GeometryValidator] Analysis error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract central corridor region from depth map
     * Focus on the walking path ahead
     */
    extractCentralRegion(depthMap) {
        const { data, width, height } = depthMap;

        // Calculate central region bounds
        const regionWidth = Math.floor(width * CONFIG.VIDEO.CENTRAL_REGION_WIDTH);
        const regionHeight = Math.floor(height * CONFIG.VIDEO.CENTRAL_REGION_HEIGHT);
        const startX = Math.floor((width - regionWidth) / 2);
        const startY = Math.floor((height - regionHeight) / 2);

        const centralData = [];

        // Extract central region pixels
        for (let y = startY; y < startY + regionHeight; y++) {
            for (let x = startX; x < startX + regionWidth; x++) {
                const idx = y * width + x;
                if (idx < data.length) {
                    centralData.push(data[idx]);
                }
            }
        }

        return centralData;
    }

    /**
     * Find minimum depth value (closest point)
     */
    findMinimumDepth(depthArray) {
        if (!depthArray || depthArray.length === 0) return 1.0;

        // Use percentile instead of absolute minimum to reduce noise
        const sorted = [...depthArray].sort((a, b) => a - b);
        const percentileIndex = Math.floor(sorted.length * 0.05); // 5th percentile

        return sorted[percentileIndex];
    }

    /**
     * Detect sudden depth discontinuities (obstacles)
     */
    detectDiscontinuities(depthArray) {
        if (!depthArray || depthArray.length < 2) return false;

        // Calculate depth variance
        const mean = depthArray.reduce((sum, val) => sum + val, 0) / depthArray.length;
        const variance = depthArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / depthArray.length;
        const stdDev = Math.sqrt(variance);

        // High variance indicates discontinuities
        return stdDev > CONFIG.DEPTH_SPIKE_THRESHOLD;
    }

    /**
     * Convert normalized depth to distance zone
     * Depth-Anything outputs relative depth, so we use heuristics
     */
    depthToZone(normalizedDepth) {
        // Inverse relationship: lower depth value = closer object
        // These thresholds are heuristic and may need tuning

        if (normalizedDepth < 0.2) {
            return ZONE_LABELS.VERY_CLOSE;
        } else if (normalizedDepth < 0.5) {
            return ZONE_LABELS.NEAR;
        } else {
            return ZONE_LABELS.CLEAR;
        }
    }

    /**
     * Calculate confidence based on depth consistency
     */
    calculateConfidence(depthArray) {
        if (!depthArray || depthArray.length === 0) return 0;

        const mean = depthArray.reduce((sum, val) => sum + val, 0) / depthArray.length;
        const variance = depthArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / depthArray.length;
        const stdDev = Math.sqrt(variance);

        // Lower variance = higher confidence
        // Map stdDev to 0-1 confidence (inverse relationship)
        const confidence = Math.max(0, 1 - (stdDev / 0.5));

        return confidence;
    }

    /**
     * Get statistical summary of depth data
     */
    getDepthStats(depthArray) {
        if (!depthArray || depthArray.length === 0) {
            return { mean: 0, min: 0, max: 0, stdDev: 0 };
        }

        const mean = depthArray.reduce((sum, val) => sum + val, 0) / depthArray.length;
        const min = Math.min(...depthArray);
        const max = Math.max(...depthArray);
        const variance = depthArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / depthArray.length;
        const stdDev = Math.sqrt(variance);

        return { mean, min, max, stdDev };
    }
}

export default GeometryValidator;
