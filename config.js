/**
 * VisionAid V2 - Configuration
 * Centralized configuration for all system parameters
 */

export const CONFIG = {
    // Performance targets
    TARGET_FPS: 20,
    MAX_PROCESSING_TIME_MS: 50,

    // Distance zones (in meters)
    ZONES: {
        VERY_CLOSE: 0.6,  // < 0.6m
        NEAR: 1.5         // 0.6m - 1.5m, > 1.5m is CLEAR
    },

    // Fusion logic parameters
    TEMPORAL_BUFFER_SIZE: 5,        // Number of frames to smooth over
    MOTION_THRESHOLD: 0.3,          // Minimum motion magnitude to consider
    DEPTH_SPIKE_THRESHOLD: 0.4,     // Sudden depth change threshold
    DEPTH_STABILITY_THRESHOLD: 0.1, // Max variance for "stable" depth

    // Audio guidance cooldowns (milliseconds) - speak every 1 second
    COOLDOWN: {
        VERY_CLOSE: 2000,   // 1 second
        NEAR: 2000,         // 1 second
        CLEAR: 2000,        // 1 second
        UNCERTAIN: 2000     // 1 second
    },

    // Model configuration
    MODEL: {
        PRIMARY: 'Xenova/depth-anything-v2-small',  // Depth-Anything v2
        FALLBACK: 'midas',                          // MiDaS (if needed)
        USE_WEBGPU: true,
        INPUT_SIZE: 518  // Depth-Anything v2 default input size
    },

    // Video processing
    VIDEO: {
        CENTRAL_REGION_WIDTH: 0.4,   // 40% of frame width (central corridor)
        CENTRAL_REGION_HEIGHT: 0.6,  // 60% of frame height
        FLOOR_REGION_BOTTOM: 0.8     // Bottom 20% is likely floor
    },

    // Debug mode
    DEBUG: {
        ENABLED: false,
        SHOW_DEPTH_MAP: false,
        SHOW_MOTION_VECTORS: false,
        SHOW_FPS: true,
        LOG_DETECTIONS: false
    }
};

// Distance zone labels
export const ZONE_LABELS = {
    VERY_CLOSE: 'Very Close',
    NEAR: 'Near',
    CLEAR: 'Clear',
    UNKNOWN: 'Unknown'
};

// Audio message templates
export const AUDIO_MESSAGES = {
    VERY_CLOSE: 'Stop. Obstacle very close.',
    NEAR: 'Obstacle ahead.',
    CLEAR: 'Path clear.',
    APPROACHING: 'Something approaching.',
    UNCERTAIN: 'Please slow down.',
    SYSTEM_READY: 'VisionAid ready.',
    CAMERA_ERROR: 'Camera error.',
    MODEL_LOADING: 'Loading vision system.'
};
