/**
 * VisionAid V2 - Audio Guidance System
 * Text-to-speech audio guidance with priority and cooldown management
 */

import { CONFIG, AUDIO_MESSAGES, ZONE_LABELS } from './config.js';

class AudioGuide {
    constructor() {
        this.synthesis = null;
        this.isInitialized = false;
        this.isSpeaking = false;
        this.messageQueue = [];
        this.lastMessageTime = {};
        this.currentZone = ZONE_LABELS.UNKNOWN;
        this.currentZone = ZONE_LABELS.UNKNOWN;
        this.lastSpokenZone = ZONE_LABELS.UNKNOWN;
        this.lastSpeechEnd = 0;
        this.lastSpeechStart = 0;
        this.currentUtterance = null;
    }

    /**
     * Initialize text-to-speech
     */
    init() {
        if ('speechSynthesis' in window) {
            this.synthesis = window.speechSynthesis;
            this.isInitialized = true;

            // Chrome loads voices asynchronously
            if (this.synthesis.onvoiceschanged !== undefined) {
                this.synthesis.onvoiceschanged = () => {
                    console.log('[AudioGuide] Voices loaded:', this.synthesis.getVoices().length);
                };
            }

            console.log('[AudioGuide] TTS initialized');
            return { success: true };
        } else {
            console.error('[AudioGuide] TTS not supported');
            return { success: false, error: 'TTS not supported' };
        }
    }

    /**
     * Unlock audio context (browser autoplay policy)
     * Must be called from a user interaction (click/touch)
     */
    unlock() {
        if (!this.synthesis) return;
        // Speak empty string to resume audio context if suspended
        const utterance = new SpeechSynthesisUtterance('');
        this.synthesis.speak(utterance);
        this.synthesis.resume(); // Ensure resume
    }

    /**
     * Update guidance based on current zone
     * @param {Object} fusionResult - Result from fusion logic
     */
    updateGuidance(fusionResult) {
        if (!this.isInitialized || !fusionResult.success) {
            return;
        }

        const zone = fusionResult.zone;
        const confidence = fusionResult.confidence;
        const isFallback = fusionResult.isFallback;

        // Determine appropriate message
        let message = null;
        let priority = 'normal';

        // Very close - immediate danger
        if (zone === ZONE_LABELS.VERY_CLOSE) {
            message = AUDIO_MESSAGES.VERY_CLOSE;
            priority = 'critical';
        }
        // Near - warning
        else if (zone === ZONE_LABELS.NEAR && this.lastSpokenZone !== ZONE_LABELS.NEAR) {
            message = AUDIO_MESSAGES.NEAR;
            if (fusionResult.distanceMeters) {
                message = `Obstacle ahead, ${fusionResult.distanceMeters.toFixed(1)} meters.`;
            }
            priority = 'high';
        }
        // Clear - only announce if coming from danger zone
        else if (zone === ZONE_LABELS.CLEAR &&
            (this.lastSpokenZone === ZONE_LABELS.VERY_CLOSE ||
                this.lastSpokenZone === ZONE_LABELS.NEAR)) {
            message = AUDIO_MESSAGES.CLEAR;
            priority = 'low';
        }
        // Uncertain fallback
        else if (isFallback && confidence < 0.5) {
            message = AUDIO_MESSAGES.UNCERTAIN;
            priority = 'normal';
        }

        // Speak message if appropriate
        if (message) {
            this.speak(message, priority, zone);
        }

        this.currentZone = zone;
    }

    /**
     * Speak a message with priority and cooldown management
     * @param {string} message - Message to speak
     * @param {string} priority - 'critical', 'high', 'normal', 'low'
     * @param {string} zone - Associated zone for cooldown tracking
     */


    /**
     * Speak a message with priority and cooldown management.
     * Improvements #5 & #7:
     *   #5 - Cooldown key = zone+objectClass+dodgeSide (not just zone)
     *   #7 - Tiered cooldowns: DANGER=1.5s, WARNING=3s, SAFE/INFO=5s
     * @param {string} message      - Message to speak
     * @param {string} priority     - 'critical', 'high', 'navigation', 'normal', 'low'
     * @param {string} zone         - Associated zone
     * @param {string} [objectClass=''] - COCO-SSD class of the primary threat
     * @param {string} [dodgeSide='']   - 'left', 'right', or '' for non-directional
     */
    speak(message, priority = 'normal', zone = null, objectClass = '', dodgeSide = '') {
        if (!this.isInitialized || !this.synthesis) return;

        const now = Date.now();

        // FAILSAFE: If we think we are speaking but it's been > 5 seconds, assume we are stuck.
        if (this.isSpeaking && (now - this.lastSpeechStart > 5000)) {
            console.warn('[AudioGuide] Failsafe: Resetting stuck speech state');
            this.synthesis.cancel();
            this.isSpeaking = false;
        }

        // Constraint 1: Do not interrupt if already speaking (unless critical emergency)
        if (this.isSpeaking && priority !== 'critical') {
            return;
        }

        // Constraint 2: "wait 2 sec before speaking again"
        // Wait 2000ms after the LAST speech ended
        if (now - this.lastSpeechEnd < 2000 && priority !== 'critical') {
            return;
        }

        // Check zone cooldown — using composite key (Improvement #5)
        const cooldownKey = zone ? `${zone}-${objectClass}-${dodgeSide}` : null;
        if (cooldownKey && !this.canSpeak(cooldownKey, priority)) {
            return;
        }

        // Critical messages interrupt everything
        if (priority === 'critical') {
            this.cancelNonCritical();
            this.isSpeaking = false;
        }

        try {
            // Create utterance
            const utterance = new SpeechSynthesisUtterance(message);
            // Store reference to prevent Garbage Collection (Common browser bug)
            this.currentUtterance = utterance;

            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            // Set voice (prefer female voice for calmness)
            let voices = this.synthesis.getVoices();
            // Retry getting voices if empty (sometimes needed)
            if (voices.length === 0) {
                voices = window.speechSynthesis.getVoices();
            }

            if (voices.length > 0) {
                const preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female'));
                if (preferredVoice) {
                    utterance.voice = preferredVoice;
                }
            }

            // Event handlers
            utterance.onstart = () => {
                this.lastSpeechStart = Date.now(); // Track start time for failsafe
                if (CONFIG.DEBUG.LOG_DETECTIONS) {
                    console.log(`[AudioGuide] Speaking: "${message}"`);
                }
            };

            utterance.onend = () => {
                this.isSpeaking = false;
                this.lastSpeechEnd = Date.now();
                this.currentUtterance = null; // Release ref
                // Improvement #5: record cooldown against composite key
                if (cooldownKey) {
                    this.lastMessageTime[cooldownKey] = Date.now();
                }
                if (zone) this.lastSpokenZone = zone;
            };

            utterance.onerror = (event) => {
                console.warn('[AudioGuide] TTS Error:', event);
                this.isSpeaking = false;
                this.currentUtterance = null;
                this.lastSpeechEnd = Date.now(); // Treat error as end to allow continuation
            };

            // Speak
            this.isSpeaking = true;
            this.lastSpeechStart = Date.now();
            // Log to activity panel
            if (typeof VisionLog !== 'undefined') {
                const logZone = (priority === 'critical') ? 'danger' :
                                (priority === 'high')     ? 'warn'   :
                                (priority === 'navigation') ? 'warn'  : 'info';
                VisionLog.add(message, logZone);
            }
            this.synthesis.speak(utterance);
        } catch (error) {
            console.warn('[AudioGuide] Speech failed:', error.message);
            this.isSpeaking = false;
        }
    }

    /**
     * Check if we can speak for a given cooldown key (Improvement #5)
     */
    canSpeak(key, priority) {
        // Critical and Navigation messages always allowed
        if (priority === 'critical' || priority === 'navigation') {
            return true;
        }

        const now      = Date.now();
        const lastTime = this.lastMessageTime[key] || 0;
        const cooldown = this.getCooldown(key);

        return (now - lastTime) >= cooldown;
    }

    /**
     * Improvement #7: Tiered TTS cooldowns based on danger level.
     * Key format: "zone-class-side", e.g. "Very Close-person-right"
     *   DANGER  (Very Close) = 1.5 s
     *   WARNING (Near)       = 3.0 s
     *   SAFE / INFO / other  = 5.0 s
     */
    getCooldown(key) {
        if (key.startsWith('Very Close')) return 1500;
        if (key.startsWith('Near'))       return 3000;
        return 5000;
    }

    /**
     * Cancel all non-critical messages
     */
    cancelNonCritical() {
        if (this.synthesis) {
            this.synthesis.cancel();
            this.isSpeaking = false;
        }
    }

    /**
     * Speak a system message (loading, error, etc.)
     */
    speakSystem(messageKey) {
        const message = AUDIO_MESSAGES[messageKey];
        if (message) {
            this.speak(message, 'normal');
        }
    }

    /**
     * Stop all speech
     */
    stop() {
        if (this.synthesis) {
            this.synthesis.cancel();
            this.isSpeaking = false;
        }
    }

    /**
     * Reset audio guide state
     */
    reset() {
        this.stop();
        this.lastMessageTime = {};
        this.currentZone = ZONE_LABELS.UNKNOWN;
        this.lastSpokenZone = ZONE_LABELS.UNKNOWN;
    }
}

export default AudioGuide;
