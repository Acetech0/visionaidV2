# VisionAid V2 — Improvement Roadmap

> All changes below are additive and do not require new ML models.  
> Priority order is listed within each section.

---

## 1. Object Threat Scoring Fix
**File:** `navigation-assistant.js`  
**Problem:** Largest bounding box ≠ closest threat. A far person can have a bigger box than a nearby chair.  
**Fix:** Score each detection by `area × (1 / distance)` using the depth map.

```js
const threat = detections
  .map(d => ({ ...d, threat: (d.bbox[2] * d.bbox[3]) * (1 / getDepthAt(d)) }))
  .sort((a, b) => b.threat - a.threat)[0];
```

---

## 2. Depth Sampling Point Fix
**File:** `navigation-assistant.js`  
**Problem:** Sampling depth at bounding box center often hits background (sky, floor between legs).  
**Fix:** Sample at **85% down** the bounding box — where the object meets the ground.

```js
const sampleX = bbox[0] + bbox[2] / 2;
const sampleY = bbox[1] + bbox[3] * 0.85; // was 0.5 (center)
```

---

## 3. Relative Optical Flow (Moving-User Safe)
**File:** `motion-detector.js`  
**Problem:** User is always walking — all vectors expand from center, causing constant false
approaching-object alerts. A "stillness gate" is not viable since the app is for active navigation.  
**Fix:** Compute the **median expansion rate** as the user's walking baseline. Only flag vectors
expanding significantly faster than that baseline as genuine threats.

```js
const medianExpansion = getMedianExpansionRate(allVectors);

const threateningVectors = vectors.filter(v =>
  v.expansionRate > medianExpansion * 1.8  // 80% faster = real incoming object
);
```

---

## 4. Temporal Buffer + EMA Smoothing
**File:** `fusion-logic.js`  
**Problem:** 2-frame buffer is too short. Depth-Anything V2 Small has frame-to-frame jitter,
which is amplified when the user is moving.  
**Fix:** Extend buffer to 5–7 frames. Apply Exponential Moving Average on depth values.

```js
// alpha = 0.3 weights recent frames while smoothing spikes
smoothedDepth = (alpha * newDepth) + ((1 - alpha) * smoothedDepth);
```

---

## 5. Per-Object TTS Cooldown (Pseudo-SLAM)
**File:** `audio-guide.js` + new `object-tracker.js`  
**Problem:** 5-second cooldown keyed on zone alone silences alerts when a *new* threat appears
in the same zone. Repeated alerts for the same static object are also not suppressed.  
**Fix 1:** Key cooldowns on `zone + objectClass + dodgeSide` triplet.

```js
const messageKey = `${zone}-${objectClass}-${dodgeSide}`;
// "danger-person-left" vs "danger-chair-right" = separate cooldowns
```

**Fix 2:** Track objects across frames by bounding box proximity. Same object = suppress re-alert.

```js
const isSameObject = (prev, curr) =>
  Math.abs(prev.centerX - curr.centerX) < frameWidth  * 0.15 &&
  Math.abs(prev.centerY - curr.centerY) < frameHeight * 0.15;
```

Maintain a `trackedObjects` map with individual per-object cooldown timers. This closes the
gap between the paper's claimed SLAM-based memory and the current stateless implementation.

---

## 6. COCO-SSD Confidence Threshold
**File:** `object-detector.js`  
**Problem:** 0.6 threshold drops many valid low-contrast detections (chairs, furniture).  
**Fix:** Lower to **0.45** but require detection in **2 consecutive frames** before acting.

```js
if (confirmedAcrossFrames(detection, 2)) processDetection(detection);
```

Trades raw sensitivity for precision — avoids ghost detections while catching real ones.

---

## 7. Tiered TTS Cooldowns
**File:** `audio-guide.js`  
**Problem:** Flat 5-second cooldown across all zones. A re-entering DANGER zone at second 4
gets silenced — dangerous for a blind user.

| Zone    | Cooldown |
|---------|----------|
| DANGER  | 1.5s     |
| WARNING | 3.0s     |
| SAFE    | 5.0s     |

---

## 8. Smarter Default Dodge Direction
**File:** `navigation-assistant.js`  
**Problem:** Center-object dodge always says "move right" arbitrarily.  
**Fix:** Track which side had fewer obstacles over the last 10 frames. Prefer the historically
clearer side as the dodge direction.

---

## 9. Adaptive Depth Scale (Scene Calibration)
**File:** `geometry-validator.js`  
**Problem:** The empirical constant `0.6` in `meters = 0.6 / depthVal` assumes a fixed scene
brightness. Depth-Anything's relative scale shifts between indoor/outdoor lighting.  
**Fix:** Sample the open-path region for 20 frames at startup to compute a dynamic baseline `K`.

```js
const sceneBaseline = computeInitialPathDepth(); // avg depth of central corridor, first 20 frames
const K = 0.6 * (sceneBaseline / EXPECTED_BASELINE);
// Use K in place of hardcoded 0.6
```

---

## 10. Frontend — Scrollable Activity Log Panel
**File:** `index.html` + `style.css` → see `log-panel.html` for full drop-in code

### Behaviour
- Displays the **last 10 detection events** in a scrollable panel below the camera card.
- Once the 10-entry cap is reached, the **oldest entry is removed with a fade-out animation**
  as each new entry arrives — camera feed is completely unaffected.
- Entries are colour-coded by zone: Green (Safe), Orange (Warn), Red (Danger), Indigo (Info).
- DANGER entries flash briefly on arrival.
- Each entry shows: `timestamp | message | zone pill`.
- A **Clear** button manually empties the log (no camera impact).
- A live **session timer** in the footer tracks uptime.

### Integration — 3 lines per module
```js
// audio-guide.js — after TTS fires
VisionLog.add(`${objectClass} ${distance}m — ${dodgeInstruction}`, 'danger');

// fusion-logic.js — on zone transition
VisionLog.add(`Zone → ${newZone}`, newZone);

// object-detector.js / depth-engine.js — on model ready
VisionLog.add('COCO-SSD loaded', 'info');
VisionLog.add('Depth-Anything V2 loaded', 'info');
```

### Design
- Dark terminal aesthetic (`#0a0c0f` base) with monospace font (JetBrains Mono).
- Left-border accent per zone, animated entry slide-in, fade-out on eviction.
- Scrollable container (`max-height: 280px`) with custom slim scrollbar.
- Zero interference with camera, ML inference, or audio pipelines.

---

## Implementation Priority

| # | Change | File | Effort | Impact |
|---|--------|------|--------|--------|
| 1 | Bottom-center depth sampling | navigation-assistant.js | 30 min | High |
| 2 | Relative optical flow baseline | motion-detector.js | 1 hr | High |
| 3 | Threat score = area × (1/dist) | navigation-assistant.js | 30 min | High |
| 4 | Per-object tracking / pseudo-SLAM | new object-tracker.js | 2 hr | High |
| 5 | EMA smoothing + 5-frame buffer | fusion-logic.js | 1 hr | Medium |
| 6 | Tiered TTS cooldowns | audio-guide.js | 30 min | Medium |
| 7 | Message key = zone+class+side | audio-guide.js | 20 min | Medium |
| 8 | COCO-SSD threshold 0.6 → 0.45 + 2-frame confirm | object-detector.js | 30 min | Medium |
| 9 | Activity log panel (UI) | index.html | 30 min | Low |
| 10 | Adaptive depth scale K | geometry-validator.js | 1 hr | Low |
| 11 | Smarter dodge direction memory | navigation-assistant.js | 45 min | Low |
