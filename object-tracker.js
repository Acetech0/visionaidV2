/**
 * VisionAid V2 - Object Tracker
 * Improvement #3: Temporal class locking to prevent per-frame class flipping.
 *
 * Rules:
 *   - A class must win 3 of the last 5 frames to become the locked target.
 *   - Requires 4 consecutive frames of a NEW class before switching away.
 *
 * Usage:
 *   const tracker = new ObjectTracker();
 *   const stableDetections = tracker.update(rawDetections);
 */

const LOCK_THRESHOLD   = 3;  // must win 3 of last 5 frames to lock
const SWITCH_THRESHOLD = 4;  // must hold 4 consecutive frames to switch
const HISTORY_SIZE     = 5;

class ObjectTracker {
    constructor() {
        /** @type {string|null} currently locked class */
        this.lockedClass   = null;
        /** @type {string|null} candidate class trying to take over */
        this.candidateClass = null;
        /** consecutive frame count for candidate */
        this.switchCounter  = 0;
        /** last N class observations */
        this._classHistory  = [];   // array of strings (class names per frame)
    }

    /**
     * Given raw detections for this frame, return only those that belong
     * to the currently locked (stable) class, or the best guess if no lock yet.
     *
     * @param {Array} detections - COCO-SSD detection array
     * @returns {Array} filtered detections
     */
    update(detections) {
        if (!detections || detections.length === 0) {
            // Record "no detection" frame
            this._record(null);
            return [];
        }

        // Pick the class with the highest combined score this frame
        const classTotals = {};
        for (const d of detections) {
            classTotals[d.class] = (classTotals[d.class] || 0) + d.score;
        }
        const frameClass = Object.entries(classTotals)
            .sort((a, b) => b[1] - a[1])[0][0];

        this._record(frameClass);

        // --- Locking logic ---
        if (this.lockedClass === null) {
            // No lock yet — check if frameClass has a majority
            if (this._majorityClass() === frameClass) {
                this.lockedClass    = frameClass;
                this.candidateClass = null;
                this.switchCounter  = 0;
            }
        } else if (frameClass === this.lockedClass) {
            // Reinforcing the lock
            this.candidateClass = null;
            this.switchCounter  = 0;
        } else {
            // Different class seen — start/continue switch counter
            if (frameClass === this.candidateClass) {
                this.switchCounter++;
            } else {
                this.candidateClass = frameClass;
                this.switchCounter  = 1;
            }

            if (this.switchCounter >= SWITCH_THRESHOLD) {
                // Switch lock to new class
                this.lockedClass    = this.candidateClass;
                this.candidateClass = null;
                this.switchCounter  = 0;
                if (typeof VisionLog !== 'undefined') {
                    VisionLog.add(`Tracker locked → ${this.lockedClass}`, 'info');
                }
            }
        }

        // Return detections belonging to locked class only (or all if no lock)
        const target = this.lockedClass || frameClass;
        return detections.filter(d => d.class === target);
    }

    /** Reset tracker state (e.g., on camera switch) */
    reset() {
        this.lockedClass    = null;
        this.candidateClass = null;
        this.switchCounter  = 0;
        this._classHistory  = [];
    }

    // ── Private helpers ────────────────────────────────────────────────────

    _record(cls) {
        this._classHistory.push(cls);
        if (this._classHistory.length > HISTORY_SIZE) {
            this._classHistory.shift();
        }
    }

    /** Return the class that appears in >= LOCK_THRESHOLD of the last N frames, or null */
    _majorityClass() {
        const counts = {};
        for (const c of this._classHistory) {
            if (c !== null) counts[c] = (counts[c] || 0) + 1;
        }
        for (const [cls, count] of Object.entries(counts)) {
            if (count >= LOCK_THRESHOLD) return cls;
        }
        return null;
    }
}

export default ObjectTracker;
