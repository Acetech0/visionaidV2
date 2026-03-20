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

const LOCK_THRESHOLD     = 3;     // must win 3 of last 5 frames to lock
const SWITCH_DURATION_MS = 2500;  // must hold new class for 2.5 s to switch
const HISTORY_SIZE       = 5;

class ObjectTracker {
    constructor() {
        /** @type {string|null} currently locked class */
        this.lockedClass    = null;
        /** @type {string|null} candidate class trying to take over */
        this.candidateClass  = null;
        /** timestamp when the candidate first appeared (ms) */
        this.switchingSince  = null;
        /** last N class observations */
        this._classHistory   = [];   // array of strings (class names per frame)
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
                this.lockedClass     = frameClass;
                this.candidateClass  = null;
                this.switchingSince  = null;
            }
        } else if (frameClass === this.lockedClass) {
            // Reinforcing the lock — cancel any pending switch
            this.candidateClass = null;
            this.switchingSince = null;
        } else {
            // Different class seen — start or continue the switch timer
            if (frameClass !== this.candidateClass) {
                // New candidate — reset timer
                this.candidateClass = frameClass;
                this.switchingSince = Date.now();
            }

            const elapsed = Date.now() - this.switchingSince;
            if (elapsed >= SWITCH_DURATION_MS) {
                // Candidate held long enough — switch lock
                this.lockedClass    = this.candidateClass;
                this.candidateClass = null;
                this.switchingSince = null;
                if (typeof VisionLog !== 'undefined') {
                    VisionLog.add(`Tracker → ${this.lockedClass}`, 'info');
                }
            }
            // else: timer still running — keep current lock
        }

        // Return detections belonging to locked class only (or all if no lock)
        const target = this.lockedClass || frameClass;
        return detections.filter(d => d.class === target);
    }

    /** Reset tracker state (e.g., on camera switch) */
    reset() {
        this.lockedClass    = null;
        this.candidateClass = null;
        this.switchingSince = null;
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
