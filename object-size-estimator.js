/**
 * VisionAid V2 - Object Size Estimator
 * Improvement #1: Physics-based metric distance via pinhole camera model.
 *
 * Formula:
 *   distance = (realHeight × focalLength) / bboxHeightPx
 *   focalLength = frameHeight / (2 × tan(FOV_rad / 2))
 *
 * Accuracy: ±15–25% for well-detected objects at 0.5–6m range.
 * FOV assumed 68° — introduces ~8% error on devices with different FOVs.
 */

// Known real-world heights (metres) per COCO-SSD class
const REAL_HEIGHTS = {
    person:       1.70,
    chair:        0.90,
    car:          1.50,
    truck:        2.50,
    bus:          3.00,
    bicycle:      1.10,
    motorcycle:   1.10,
    dog:          0.50,
    cat:          0.30,
    bottle:       0.25,
    cup:          0.12,
    couch:        0.85,
    'dining table': 0.75,
    bed:          0.60,
    door:         2.10,
    tv:           0.70,
    laptop:       0.30,
    backpack:     0.50,
    handbag:      0.35,
    suitcase:     0.65,
    umbrella:     1.00,
    'sports ball': 0.22,
};

// Classes that are too unreliable for bbox estimation (small / thin)
const UNRELIABLE_CLASSES = new Set([
    'keyboard', 'mouse', 'remote', 'cell phone',
    'fork', 'knife', 'spoon', 'scissors',
    'toothbrush', 'pen',
]);

const FOV_DEGREES       = 68;          // assumed horizontal≈vertical FOV
const FOV_RAD           = FOV_DEGREES * Math.PI / 180;
const MAX_RELIABLE_DIST = 6.0;         // metres — beyond this bbox is too small
const MIN_BBOX_RATIO    = 0.04;        // bbox height / frame height minimum
const MIN_CONFIDENCE    = 0.50;

class ObjectSizeEstimator {
    constructor() {
        this._focalCache = null;      // cached focalLength for last known frameHeight
        this._lastFrameH = 0;
    }

    /**
     * Estimate metric distance from bounding box size.
     *
     * @param {string} cls          - COCO-SSD class name
     * @param {number} bboxHeightPx - detection.bbox[3]
     * @param {number} frameHeight  - video frame height in pixels
     * @param {number} confidence   - detection.score
     * @returns {{ distance: number|null, reliable: boolean, reason: string }}
     */
    estimate(cls, bboxHeightPx, frameHeight, confidence) {
        // Guard: unreliable class
        if (UNRELIABLE_CLASSES.has(cls)) {
            return { distance: null, reliable: false, reason: 'unreliable_class' };
        }

        // Guard: unknown class
        const realH = REAL_HEIGHTS[cls];
        if (realH === undefined) {
            return { distance: null, reliable: false, reason: 'unknown_class' };
        }

        // Guard: confidence too low
        if (confidence < MIN_CONFIDENCE) {
            return { distance: null, reliable: false, reason: 'low_confidence' };
        }

        // Guard: bbox too small (partial detection)
        const bboxRatio = bboxHeightPx / frameHeight;
        if (bboxRatio < MIN_BBOX_RATIO) {
            return { distance: null, reliable: false, reason: 'partial_detection' };
        }

        // Compute focal length (cached per frame size)
        const focal = this._getFocalLength(frameHeight);

        // Pinhole camera: distance = (realH × focal) / bboxHeightPx
        const dist = (realH * focal) / bboxHeightPx;

        const reliable = dist <= MAX_RELIABLE_DIST;
        return {
            distance: Math.min(dist, 12.0),   // hard cap for UI sanity
            reliable,
            reason: reliable ? 'ok' : 'far_object',
        };
    }

    /** Call when user switches camera — clears FOV cache */
    onCameraSwitch() {
        this._focalCache = null;
        this._lastFrameH = 0;
    }

    _getFocalLength(frameHeight) {
        if (frameHeight !== this._lastFrameH || this._focalCache === null) {
            this._focalCache = frameHeight / (2 * Math.tan(FOV_RAD / 2));
            this._lastFrameH = frameHeight;
        }
        return this._focalCache;
    }
}

// Singleton — safe to share across modules
export default new ObjectSizeEstimator();
