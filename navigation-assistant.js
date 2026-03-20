/**
 * Navigation Assistant
 * Improvements applied:
 *   #1 - Threat score: area × (1 / distance) instead of raw area
 *   #2 - Depth sampled at bbox bottom 85% (ground-level) instead of center
 *   #8 - Dodge direction based on 10-frame historical side-clearance
 */
import { CONFIG } from './config.js';

export default class NavigationAssistant {
    constructor() {
        this.lastGuidanceTime = 0;
        this.guidanceCooldown = 3000;

        // Improvement #8: track historical obstacle counts per side over last 10 frames
        this.sideHistory = [];         // array of 'left' | 'right' | 'center'
        this.MAX_SIDE_HISTORY = 10;
    }

    /**
     * Get depth value at a specific (videoX, videoY) coordinate from the depth map.
     */
    _sampleDepth(depthMap, videoX, videoY, frameWidth, frameHeight) {
        const depthX = Math.floor(videoX * (depthMap.width  / frameWidth));
        const depthY = Math.floor(videoY * (depthMap.height / frameHeight));
        const idx    = Math.min(depthY, depthMap.height - 1) * depthMap.width +
                       Math.min(depthX, depthMap.width  - 1);
        return depthMap.data[idx]; // 0 (far) → 1 (very close)
    }

    /**
     * Improvement #1: Compute threat score for a detection.
     * score = bbox_area × (1 / distance_meters)
     * Requires depth map; falls back to area alone if unavailable.
     */
    _threatScore(det, depthMap, frameWidth, frameHeight, K) {
        const [x, y, w, h] = det.bbox;
        const area = w * h;

        if (!depthMap || !depthMap.data) return area;

        // Improvement #2: sample at 85% down the bbox (object-ground contact point)
        const sampleX = x + w / 2;
        const sampleY = y + h * 0.85;
        const depthVal = this._sampleDepth(depthMap, sampleX, sampleY, frameWidth, frameHeight);
        const safeDisp = Math.max(0.05, depthVal);
        const distMeters = K / safeDisp;

        return { score: area * (1 / distMeters), distMeters };
    }

    /**
     * Improvement #8: pick the clearer dodge side from recent history.
     * Counts how many recent frames had obstacles on each side.
     * Returns the side with fewer recent obstacles.
     */
    _clearerSide() {
        const leftCount   = this.sideHistory.filter(s => s === 'left').length;
        const rightCount  = this.sideHistory.filter(s => s === 'right').length;
        const centerCount = this.sideHistory.filter(s => s === 'center').length;

        // If right has had fewer obstacles historically → dodge right
        if (rightCount <= leftCount) return 'move right';
        return 'move left';
    }

    /**
     * Evaluate the scene and provide navigation advice.
     * @param {Array}  detections  - COCO-SSD detections
     * @param {Number} frameWidth
     * @param {Number} frameHeight
     * @param {Object} depthMap    - { data, width, height } normalized depth
     * @param {Number} [K=0.6]     - Adaptive depth scale (Improvement #9 feeds this in)
     */
    evaluate(detections, frameWidth, frameHeight, depthMap = null, K = 0.6) {
        if (!detections || detections.length === 0) return null;

        const now = Date.now();
        if (now - this.lastGuidanceTime < this.guidanceCooldown) return null;

        // ── Improvement #1: score each detection by area × (1/dist) ──────────
        let criticalObj  = null;
        let bestScore    = -Infinity;
        let criticalDist = -1;

        for (const det of detections) {
            const result = this._threatScore(det, depthMap, frameWidth, frameHeight, K);
            const score  = typeof result === 'object' ? result.score   : result;
            const dist   = typeof result === 'object' ? result.distMeters : -1;
            if (score > bestScore) {
                bestScore    = score;
                criticalObj  = det;
                criticalDist = dist;
            }
        }

        if (!criticalObj) return null;

        // ── Determine horizontal position ─────────────────────────────────────
        const [x, y, w, h] = criticalObj.bbox;
        const centerX  = x + w / 2;
        const relativeX = centerX / frameWidth;

        // ── Distance classification ───────────────────────────────────────────
        let distanceMeters   = criticalDist;
        let distanceCategory = 'Safe';

        if (depthMap && depthMap.data && distanceMeters > 0) {
            if      (distanceMeters < CONFIG.ZONES.VERY_CLOSE) distanceCategory = 'Very Close';
            else if (distanceMeters < CONFIG.ZONES.NEAR)       distanceCategory = 'Near';
            else if (distanceMeters < CONFIG.ZONES.CLEAR_LIMIT) distanceCategory = 'Clear';
            else distanceCategory = 'Safe';
        } else {
            // Fallback: height ratio
            const heightRatio = h / frameHeight;
            distanceMeters    = 0.5 / Math.max(0.01, heightRatio);
            if      (heightRatio > 0.6) distanceCategory = 'Very Close';
            else if (heightRatio > 0.3) distanceCategory = 'Near';
        }

        if (distanceCategory === 'Safe' || distanceCategory === 'Clear') return null;

        // ── Improvement #8: record this frame's obstacle side ─────────────────
        const obstacleSide = relativeX < 0.33 ? 'left'
                            : relativeX > 0.66 ? 'right'
                            : 'center';
        this.sideHistory.push(obstacleSide);
        if (this.sideHistory.length > this.MAX_SIDE_HISTORY) this.sideHistory.shift();

        // ── Formulate guidance ────────────────────────────────────────────────
        let action, moveStr, message;
        const distStr = distanceMeters > 0 ? `in ${distanceMeters.toFixed(1)} meter` : 'nearby';

        if (relativeX < 0.33) {
            action  = 'Object Left';
            moveStr = 'move right';
        } else if (relativeX > 0.66) {
            action  = 'Object Right';
            moveStr = 'move left';
        } else {
            action  = 'Dodge';
            // Improvement #8: use historical clearance instead of fixed 'right'
            moveStr = this._clearerSide();
        }

        if (action === 'Dodge') {
            message = `${criticalObj.class} ahead ${distStr}, ${moveStr}.`;
        } else {
            const side = relativeX < 0.33 ? 'on left' : 'on right';
            message = `${criticalObj.class} ${side} ${distStr}, ${moveStr}.`;
        }

        // Log to activity panel
        if (typeof VisionLog !== 'undefined') {
            const logZone = distanceCategory === 'Very Close' ? 'danger' : 'warn';
            VisionLog.add(message, logZone);
        }

        this.lastGuidanceTime = now;
        return {
            hasGuidance: true,
            message,
            action,
            object: criticalObj.class,
            distance: distanceCategory
        };
    }
}
