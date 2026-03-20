# VisionAid V2 — Improvement Roadmap v2

> Focused on distance estimation accuracy and detection consistency.  
> All changes are additive. No new ML models required.  
> Demo version — limitations documented per section.

---

## 1. Metric Distance Estimation via Pinhole Camera Model
**New File:** `object-size-estimator.js`  
**Problem:** `meters = 0.6 / depthVal` is an empirical guess with no physical basis.  
It produces different wrong answers per scene, lighting, and camera.  
**Fix:** Use known real-world object heights + pinhole camera geometry for physics-based distance.

### Formula
```
distance = (realHeight × focalLength) / bboxHeightInPixels
focalLength = frameHeight / (2 × tan(FOV / 2))
```

### Known Object Heights Table
| Class | Height (m) | Reliability |
|---|---|---|
| person | 1.70 | High |
| chair | 0.90 | High |
| car | 1.50 | High |
| door | 2.10 | High |
| couch | 0.85 | Medium |
| bottle | 0.25 | Low (small bbox) |
| cup | 0.12 | Low (small bbox) |
| keyboard / mouse | 0.04 | Unreliable — skipped |

### Guards (Critical — prevents confident wrong readings)
| Condition | Action |
|---|---|
| Unknown class | Fall back to depth map |
| Unreliable class (keyboard, mouse, etc.) | Fall back to depth map |
| `bboxHeight / frameHeight < 0.04` | Fall back (partial detection) |
| `confidence < 0.50` | Fall back |
| `distance > 6.0m` | Flag as low reliability |

### Demo Version Limitations
- FOV assumed at 68° — actual device FOV varies ±5°, introduces ~8% error
- Real-world heights are averages — a child will read ~30% closer than actual
- Only works for COCO-SSD detectable classes
- Accuracy: ±15–25% for well-detected objects at 0.5–6m range

### Integration
```js
// In navigation-assistant.js — replace current distance call
function getDistance(detection, depthMap, frameHeight) {
  const { distance, reliable, reason } = ObjectSizeEstimator.estimate(
    detection.class,
    detection.bbox[3],
    frameHeight,
    detection.score
  );
  if (distance !== null) return distance;
  return getDepthMapDistance(detection, depthMap); // fallback
}

// In switch-camera handler — reset FOV cache
ObjectSizeEstimator.onCameraSwitch();
```

---

## 2. Duplicate Log / TTS Entries Fix
**File:** `audio-guide.js`  
**Problem:** Same message logged twice in the same second (visible at 13:03:31, 13:03:38, 13:03:47 in test log).  
**Root Cause:** Cooldown is set *after* the async TTS call — two frames pass the check before the lock is set.

```js
// BEFORE (buggy)
if (!onCooldown(key)) {
  await speak(message);
  setCooldown(key); // ← too late, next frame already passed
}

// AFTER (fixed)
if (!onCooldown(key)) {
  setCooldown(key); // ← lock first, synchronously
  speak(message);   // fire and forget
}
```

---

## 3. Object Class Locking (Stop Chair → Person Flipping)
**New File:** `object-tracker.js`  
**Problem:** Detected class flips between frames (chair → person → person) because
largest bounding box selection has no temporal memory.  
**Fix:** Require a class to appear in 3 of the last 5 frames to become the locked target.
Require 4 consecutive frames of a new class before switching away.

```js
const LOCK_THRESHOLD   = 3; // must win 3 of last 5 frames
const SWITCH_THRESHOLD = 4; // must hold new class for 4 frames to switch

if (newClass !== lockedClass) {
  switchCounter++;
  if (switchCounter < SWITCH_THRESHOLD) return lockedClass;
} else {
  switchCounter = 0;
}
```

---

## 4. Dodge Direction Hysteresis (Stop Ahead → Right Flipping)
**File:** `navigation-assistant.js`  
**Problem:** `relativeX` oscillates across the 0.33/0.66 hard boundary — a person
slightly off-center flip-flops direction every few frames.  
**Fix:** Add a dead zone buffer so direction only changes when the object clearly crosses the threshold.

```js
// BEFORE — hard cutoffs
if (relativeX < 0.33) → "left"
if (relativeX > 0.66) → "right"
else                  → "ahead"

// AFTER — hysteresis (dead zone ±0.05 around each boundary)
const BUFFER = 0.05;
if (relativeX < 0.33 - BUFFER) lockDirection('left');
if (relativeX > 0.66 + BUFFER) lockDirection('right');
// Values between 0.28–0.71 → keep previous direction, no flip
```

---

## 5. EMA Depth Smoothing (Stop 1.4m → 0.5m Jumps)
**File:** `geometry-validator.js`  
**Problem:** Depth-Anything V2 Small is not temporally consistent — distance
readings jump 1.4m → 1.0m → 0.5m while the user is completely stationary.  
**Fix:** Exponential Moving Average with alpha=0.25 (weights recent frames, absorbs spikes).

```js
const ALPHA = 0.25;
let smoothedDepth = null;

function getSmoothedDepth(rawDepth) {
  if (smoothedDepth === null) {
    smoothedDepth = rawDepth;
    return rawDepth;
  }
  smoothedDepth = (ALPHA * rawDepth) + ((1 - ALPHA) * smoothedDepth);
  return smoothedDepth;
}
```

**Effect:** A spike from 1.0m → 0.5m reads as ~0.875m — preventing false DANGER escalation.  
**Note:** This applies to the depth-map fallback path only. Bbox-based distance (fix #1) does not need smoothing.

---

## 6. Tiered TTS Cooldowns
**File:** `audio-guide.js`  
**Problem:** Flat 5s cooldown silences a re-entering DANGER zone at second 4 — dangerous for navigation.

| Zone | Cooldown |
|---|---|
| DANGER | 1.5s |
| WARNING | 3.0s |
| SAFE | 5.0s |
| INFO | 8.0s |

---

## 7. Per-Message Cooldown Key
**File:** `audio-guide.js`  
**Problem:** Cooldown keyed on zone alone — a new threat in the same zone is silenced.  
**Fix:** Key on `zone + objectClass + dodgeSide` triplet.

```js
const messageKey = `${zone}-${objectClass}-${dodgeSide}`;
// "danger-person-left" and "danger-chair-right" = independent cooldowns
```

---

## 8. Threat Scoring Fix
**File:** `navigation-assistant.js`  
**Problem:** Largest bounding box selected as primary threat — a far person beats a close chair.  
**Fix:** Score by `area × (1 / distance)`.

```js
const primaryThreat = detections
  .map(d => ({ ...d, threat: (d.bbox[2] * d.bbox[3]) * (1 / getDistance(d)) }))
  .sort((a, b) => b.threat - a.threat)[0];
```

---

## 9. COCO-SSD Confidence Threshold
**File:** `object-detector.js`  
**Problem:** 0.60 threshold drops valid low-contrast detections (chairs, furniture against walls).  
**Fix:** Lower to 0.45 but require 2 consecutive frame confirmation before acting.

```js
if (confirmedAcrossFrames(detection, 2)) processDetection(detection);
```

---

## 10. Relative Optical Flow for Moving User
**File:** `motion-detector.js`  
**Problem:** User is always walking — all vectors expand from center, causing constant
false approaching-object alerts. A static stillness gate is not viable.  
**Fix:** Compare each vector against the median expansion rate (user's walking baseline).
Only flag vectors expanding 80%+ faster than the baseline as genuine threats.

```js
const medianExpansion = getMedianExpansionRate(allVectors);
const threateningVectors = vectors.filter(v =>
  v.expansionRate > medianExpansion * 1.8
);
```

---

## 11. Smarter Default Dodge Direction
**File:** `navigation-assistant.js`  
**Problem:** Center-object dodge always defaults to "move right" arbitrarily.  
**Fix:** Track obstacle frequency per side over last 10 frames. Prefer the historically clearer side.

---

## 12. Scrollable Activity Log Panel (UI)
**File:** `index.html` — see `log-panel.html` for full drop-in code

- Last 10 events retained, oldest fades out on eviction
- Camera and ML pipeline completely unaffected
- Colour-coded by zone, DANGER entries flash on arrival
- `VisionLog.add(message, zone)` — 1-line integration from any module
- Session uptime timer + manual Clear button

---

## Full Priority Table

| # | Change | File | Effort | Impact |
|---|---|---|---|---|
| 1 | Duplicate TTS fix (cooldown sync) | audio-guide.js | 20 min | Critical |
| 2 | Bbox-based metric distance | new object-size-estimator.js | 45 min | High |
| 3 | EMA depth smoothing | geometry-validator.js | 20 min | High |
| 4 | Object class locking | new object-tracker.js | 1 hr | High |
| 5 | Dodge direction hysteresis | navigation-assistant.js | 20 min | High |
| 6 | Threat score = area × (1/dist) | navigation-assistant.js | 30 min | High |
| 7 | Tiered TTS cooldowns | audio-guide.js | 20 min | Medium |
| 8 | Per-message cooldown key | audio-guide.js | 20 min | Medium |
| 9 | COCO-SSD threshold 0.60 → 0.45 | object-detector.js | 30 min | Medium |
| 10 | Relative optical flow | motion-detector.js | 1 hr | Medium |
| 11 | Smarter dodge direction memory | navigation-assistant.js | 45 min | Low |
| 12 | Activity log panel (UI) | index.html | 30 min | Low |

---

## Demo Version — Known Limitations Summary

| Limitation | Cause | Acceptable Because |
|---|---|---|
| Distance ±15–25% error | FOV assumed, avg object heights | Navigational guidance, not measurement |
| Unknown objects use depth map fallback | No size reference | Depth map sufficient for proximity alert |
| Children / small adults read closer | Height avg is adult male | Demo scope |
| Distance degrades beyond 6m | Small bbox = pixel error amplified | Beyond 6m is not an immediate hazard |
| No persistent spatial map | Browser, no ARCore | Demo version; full app would use ARCore |
