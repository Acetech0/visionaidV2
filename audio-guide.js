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
     * Speak a message with priority and cooldown management
     */
    speak(message, priority = 'normal', zone = null) {
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

        // Check zone cooldown
        if (zone && !this.canSpeak(zone, priority)) {
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
                if (zone) {
                    this.lastMessageTime[zone] = Date.now();
                    this.lastSpokenZone = zone;
                }
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
            this.synthesis.speak(utterance);
        } catch (error) {
            console.warn('[AudioGuide] Speech failed:', error.message);
            this.isSpeaking = false;
        }
    }

    /**
     * Check if we can speak for a given zone (cooldown check)
     */
    canSpeak(zone, priority) {
        // Critical messages always allowed
        // Critical and Navigation messages always allowed
        if (priority === 'critical' || priority === 'navigation') {
            return true;
        }

        const now = Date.now();
        const lastTime = this.lastMessageTime[zone] || 0;
        const cooldown = this.getCooldown(zone);

        return (now - lastTime) >= cooldown;
    }

    /**
     * Get cooldown duration for a zone
     */
    getCooldown(zone) {
        switch (zone) {
            case ZONE_LABELS.VERY_CLOSE:
                return CONFIG.COOLDOWN.VERY_CLOSE;
            case ZONE_LABELS.NEAR:
                return CONFIG.COOLDOWN.NEAR;
            case ZONE_LABELS.CLEAR:
                return CONFIG.COOLDOWN.CLEAR;
            default:
                return CONFIG.COOLDOWN.UNCERTAIN;
        }
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
