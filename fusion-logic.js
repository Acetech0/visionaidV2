/**
 * VisionAid V2 - Fusion Logic
 * Decision-based fusion of depth, geometry, and motion data
 */

import { CONFIG, ZONE_LABELS } from './config.js';

class FusionLogic {
    constructor() {
        this.zoneHistory = [];
        this.depthHistory = [];
        this.lastStableZone = ZONE_LABELS.UNKNOWN;
    }

    /**
     * Fuse perceptions from all three layers
     * @param {Object} depthData - Raw depth estimation results
     * @param {Object} geometryData - Geometry validation results
     * @param {Object} motionData - Motion detection results
     * @returns {Object} Fused perception with final zone and confidence
     */
    fuse(depthData, geometryData, motionData) {
        // Handle failures in any layer
        if (!geometryData.success) {
            return this.safetyFallback('Geometry analysis failed');
        }

        try {
            // Extract key metrics
            const geometryZone = geometryData.zone;
            const geometryConfidence = geometryData.confidence;
            const hasDiscontinuity = geometryData.hasDiscontinuity;
            const minDepth = geometryData.minDepth;

            const hasMotion = motionData.success ? motionData.hasMotion : false;
            const isApproaching = motionData.success ? motionData.isApproaching : false;

            // Add to history
            this.zoneHistory.push(geometryZone);
            this.depthHistory.push(minDepth);

            if (this.zoneHistory.length > CONFIG.TEMPORAL_BUFFER_SIZE) {
                this.zoneHistory.shift();
                this.depthHistory.shift();
            }

            // Decision logic
            let finalZone;
            let confidence;
            let reasoning;

            // CRITICAL: Immediate danger - no smoothing
            if (geometryZone === ZONE_LABELS.VERY_CLOSE) {
                finalZone = ZONE_LABELS.VERY_CLOSE;
                confidence = 1.0;
                reasoning = 'Immediate danger detected';
            }
            // Motion confirms approach - trust it
            else if (isApproaching && hasMotion) {
                finalZone = this.escalateZone(geometryZone);
                confidence = 0.9;
                reasoning = 'Approaching motion detected';
            }
            // Depth is stable - trust geometry
            else if (this.isDepthStable() && geometryConfidence > 0.7) {
                finalZone = geometryZone;
                confidence = geometryConfidence;
                reasoning = 'Stable depth reading';
            }
            // Sudden discontinuity - be cautious
            else if (hasDiscontinuity) {
                finalZone = this.escalateZone(geometryZone);
                confidence = 0.6;
                reasoning = 'Depth discontinuity detected';
            }
            // Smooth over time
            else {
                finalZone = this.smoothTemporally();
                confidence = 0.7;
                reasoning = 'Temporal smoothing applied';
            }

            // Update stable zone if confidence is high
            if (confidence > 0.8) {
                this.lastStableZone = finalZone;
            }

            return {
                success: true,
                zone: finalZone,
                confidence,
                reasoning,
                metrics: {
                    geometryZone,
                    geometryConfidence,
                    hasMotion,
                    isApproaching,
                    minDepth,
                    historySize: this.zoneHistory.length
                }
            };

        } catch (error) {
            console.error('[FusionLogic] Fusion error:', error);
            return this.safetyFallback('Fusion error: ' + error.message);
        }
    }

    /**
     * Check if depth readings are stable over time
     */
    isDepthStable() {
        if (this.depthHistory.length < 3) return false;

        const recent = this.depthHistory.slice(-3);
        const mean = recent.reduce((sum, val) => sum + val, 0) / recent.length;
        const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
        const stdDev = Math.sqrt(variance);

        return stdDev < CONFIG.DEPTH_STABILITY_THRESHOLD;
    }

    /**
     * Smooth zone classification over time
     */
    smoothTemporally() {
        if (this.zoneHistory.length === 0) {
            return this.lastStableZone;
        }

        // Count occurrences of each zone
        const zoneCounts = {};
        this.zoneHistory.forEach(zone => {
            zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
        });

        // Find most common zone
        let maxCount = 0;
        let mostCommonZone = this.lastStableZone;

        for (const [zone, count] of Object.entries(zoneCounts)) {
            if (count > maxCount) {
                maxCount = count;
                mostCommonZone = zone;
            }
        }

        // Bias towards danger (prefer closer zones in case of tie)
        if (zoneCounts[ZONE_LABELS.VERY_CLOSE] > 0) {
            return ZONE_LABELS.VERY_CLOSE;
        }
        if (zoneCounts[ZONE_LABELS.NEAR] >= maxCount * 0.8) {
            return ZONE_LABELS.NEAR;
        }

        return mostCommonZone;
    }

    /**
     * Escalate zone to be more cautious
     */
    escalateZone(currentZone) {
        if (currentZone === ZONE_LABELS.CLEAR) {
            return ZONE_LABELS.NEAR;
        }
        if (currentZone === ZONE_LABELS.NEAR) {
            return ZONE_LABELS.VERY_CLOSE;
        }
        return currentZone;
    }

    /**
     * Safety-first fallback when uncertain
     */
    safetyFallback(reason) {
        console.warn('[FusionLogic] Safety fallback:', reason);

        // Default to last stable zone, but escalate if we're uncertain
        const fallbackZone = this.lastStableZone === ZONE_LABELS.CLEAR
            ? ZONE_LABELS.NEAR
            : this.lastStableZone;

        return {
            success: true,
            zone: fallbackZone,
            confidence: 0.3,
            reasoning: 'Safety fallback: ' + reason,
            isFallback: true
        };
    }

    /**
     * Reset fusion state
     */
    reset() {
        this.zoneHistory = [];
        this.depthHistory = [];
        this.lastStableZone = ZONE_LABELS.UNKNOWN;
    }
}

export default FusionLogic;
