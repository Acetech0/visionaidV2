 * Navigation Assistant
    * Analyzes object positions to provide dodge / avoidance guidance
        */
import { CONFIG } from './config.js';

export default class NavigationAssistant {
    constructor() {
        this.lastGuidanceTime = 0;
        this.guidanceCooldown = 3000; // 3 seconds between guidance commands
    }

    /**
     * Evaluate the scene and provide navigation advice
     * @param {Array} detections - List of object detections
     * @param {Number} frameWidth - Width of the video frame
     * @param {Number} frameHeight - Height of the video frame
     * @param {Object} depthMap - Optional depth map { data, width, height }
     */
    evaluate(detections, frameWidth, frameHeight, depthMap = null) {
        if (!detections || detections.length === 0) return null;

        const now = Date.now();
        if (now - this.lastGuidanceTime < this.guidanceCooldown) return null;

        // 1. Find the most critical object (closest/largest)
        // We use bbox area as a proxy for closeness/importance
        let maxArea = 0;
        let criticalObj = null;

        detections.forEach(det => {
            const [x, y, w, h] = det.bbox;
            const area = w * h;
            if (area > maxArea) {
                maxArea = area;
                criticalObj = det;
            }
        });

        if (!criticalObj) return null;

        // 2. Determine Position
        const [x, y, w, h] = criticalObj.bbox;
        const centerX = x + (w / 2);
        const relativeX = centerX / frameWidth;

        // 3. Determine Distance Zone
        // Prefer Depth Map if available, else Fallback to BBox
        let distanceMeters = -1;
        let distanceCategory = 'Safe';

        if (depthMap && depthMap.data) {
            // Sample depth at object center
            // Map video coordinates to depth map coordinates
            const depthX = Math.floor(centerX * (depthMap.width / frameWidth));
            const depthY = Math.floor((y + h / 2) * (depthMap.height / frameHeight));

            const idx = depthY * depthMap.width + depthX;
            const depthVal = depthMap.data[idx]; // 0 (far) to 1 (close)

            // Convert to meters using calibration K=0.6
            const safeDisp = Math.max(0.05, depthVal);
            distanceMeters = 0.6 / safeDisp;

            // Categorize
            if (distanceMeters < CONFIG.ZONES.VERY_CLOSE) distanceCategory = 'Very Close';
            else if (distanceMeters < CONFIG.ZONES.NEAR) distanceCategory = 'Near';
            else if (distanceMeters < CONFIG.ZONES.CLEAR_LIMIT) distanceCategory = 'Clear';
            else distanceCategory = 'Safe'; // > 12m

        } else {
            // Fallback: Height Ratio
            const heightRatio = h / frameHeight;
            if (heightRatio > 0.6) distanceCategory = 'Very Close';
            else if (heightRatio > 0.3) distanceCategory = 'Near';
        }

        // Only guide if object is significant (now strictly based on zones)
        if (distanceCategory === 'Safe' || distanceCategory === 'Clear') {
            // Maybe announce 'Clear' if previously close? 
            // For now, only dodge if Very Close or Near
            return null;
        }

        // 4. Formulate Guidance
        let message = '';
        let action = '';

        if (relativeX < 0.33) {
            // Object is on Left
            action = 'Object Left';
            // Suggest moving Right is usually safe if no object there? 
            // For MVP simplicty: "Object on Left" implies path is clear elsewhere or user should attend.
            message = `${criticalObj.class} on Left.`;
        } else if (relativeX > 0.66) {
            // Object is on Right
            action = 'Object Right';
            message = `${criticalObj.class} on Right.`;
        } else {
            // Object is Center - Collision Hazard!
            action = 'Dodge';
            // Suggest direction? 
            // If strictly center, usually "Move Left" or "Move Right". Default to Right.
            message = `${criticalObj.class} Ahead. Move Right.`;
        }

        this.lastGuidanceTime = now;
        return {
            hasGuidance: true,
            message: message,
            action: action,
            object: criticalObj.class,
            distance: distanceCategory
        };
    }
}
