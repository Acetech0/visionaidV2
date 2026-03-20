/**
 * specific Object Detection Module using TensorFlow.js COCO-SSD
 */
export default class ObjectDetector {
    constructor() {
        this.model = null;
        this.isLoaded = false;
        this.minConfidence = 0.6; // Minimum confidence to report a detection
        this.lastDetections = [];
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
        if (!this.isLoaded || !this.model) {
            return [];
        }

        try {
            // predictions is an array of { class, score, bbox: [x, y, width, height] }
            const predictions = await this.model.detect(imageElement);

            // Filter by confidence
            this.lastDetections = predictions.filter(
                prediction => prediction.score >= this.minConfidence
            );

            return this.lastDetections;
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

