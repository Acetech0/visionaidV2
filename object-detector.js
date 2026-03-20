/**
 * specific Object Detection Module using TensorFlow.js COCO-SSD
 */
export default class ObjectDetector {
    constructor() {
        this.model          = null;
        this.isLoaded       = false;
        // Improvement #6: lower threshold but require 2-frame confirmation
        this.minConfidence  = 0.45;
        this.lastDetections = [];
        // Map<class+bbox_key, consecutiveCount>
        this._pendingMap    = new Map();
    }

    /**
     * Initialize the COCO-SSD model
     */
    async init() {
        try {
            console.log('[ObjectDetector] Loading COCO-SSD model...');
            // Load the model. 
            // We use 'lite_mobilenet_v2' base by default which is faster/lighter.
            this.model = await cocoSsd.load({
                base: 'lite_mobilenet_v2'
            });
            this.isLoaded = true;
            console.log('[ObjectDetector] Model loaded successfully');
            if (typeof VisionLog !== 'undefined') VisionLog.add('COCO-SSD model loaded', 'info');
            return { success: true };
        } catch (error) {
            console.error('[ObjectDetector] Failed to load model:', error);
            if (typeof VisionLog !== 'undefined') VisionLog.add('COCO-SSD load failed', 'warn');
            return { success: false, error: error };
        }
    }

    /**
     * Detect objects in the given video frame or image
     * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} imageElement 
     */
    async detect(imageElement) {
        if (!this.isLoaded || !this.model) return [];

        try {
            const predictions = await this.model.detect(imageElement);

            // Improvement #6: 0.45 threshold + 2-frame confirmation
            const candidates = predictions.filter(p => p.score >= this.minConfidence);

            // Build a key per detection (class + rough grid position)
            const makeKey = d => {
                const gx = Math.round(d.bbox[0] / 80);
                const gy = Math.round(d.bbox[1] / 80);
                return `${d.class}-${gx}-${gy}`;
            };

            const currentKeys = new Set(candidates.map(makeKey));

            // Increment counts for detections seen this frame
            const nextMap = new Map();
            for (const det of candidates) {
                const key   = makeKey(det);
                const count = (this._pendingMap.get(key) || 0) + 1;
                nextMap.set(key, count);
            }
            // Zero out any key not seen this frame
            this._pendingMap = nextMap;

            // Only pass through detections confirmed in >= 2 consecutive frames
            const confirmed = candidates.filter(det => (this._pendingMap.get(makeKey(det)) || 0) >= 2);

            this.lastDetections = confirmed;
            return confirmed;
        } catch (error) {
            console.warn('[ObjectDetector] Detection error:', error);
            return [];
        }
    }

    /**
     * Get a user-friendly summary of detected objects
     * e.g. "a person and a cup"
     */
    getSummary() {
        if (this.lastDetections.length === 0) return null;

        // Count occurrences of each class
        const counts = {};
        this.lastDetections.forEach(det => {
            counts[det.class] = (counts[det.class] || 0) + 1;
        });

        const strings = Object.entries(counts).map(([cls, count]) => {
            return count > 1 ? `${count} ${cls}s` : `a ${cls}`;
        });

        if (strings.length === 0) return null;
        if (strings.length === 1) return strings[0];

        const last = strings.pop();
        return `${strings.join(', ')} and ${last}`;
    }

    /**
     * Estimate rough distance based on bounding box height relative to frame
     * @param {Array} bbox - [x, y, width, height]
     * @param {Number} frameHeight - Height of the video frame
     * @returns {String} "Very Close", "Near", or "Safe"
     */

}

