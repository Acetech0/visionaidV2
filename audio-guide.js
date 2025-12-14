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
        this.lastSpokenZone = ZONE_LABELS.UNKNOWN;
    }

    /**
     * Initialize text-to-speech
     */
    init() {
        if ('speechSynthesis' in window) {
            this.synthesis = window.speechSynthesis;
            this.isInitialized = true;
            console.log('[AudioGuide] TTS initialized');
            return { success: true };
        } else {
            console.error('[AudioGuide] TTS not supported');
            return { success: false, error: 'TTS not supported' };
        }
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
    speak(message, priority = 'normal', zone = null) {
        if (!this.isInitialized) return;

        // Check cooldown
        if (zone && !this.canSpeak(zone, priority)) {
            if (CONFIG.DEBUG.LOG_DETECTIONS) {
                console.log(`[AudioGuide] Cooldown active for ${zone}`);
            }
            return;
        }

        // Critical messages interrupt everything
        if (priority === 'critical') {
            this.cancelNonCritical();
        }

        // Create utterance
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Set voice (prefer female voice for calmness)
        const voices = this.synthesis.getVoices();
        const preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female'));
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        // Event handlers
        utterance.onstart = () => {
            this.isSpeaking = true;
            if (CONFIG.DEBUG.LOG_DETECTIONS) {
                console.log(`[AudioGuide] Speaking: "${message}" (${priority})`);
            }
        };

        utterance.onend = () => {
            this.isSpeaking = false;
            if (zone) {
                this.lastMessageTime[zone] = Date.now();
                this.lastSpokenZone = zone;
            }
        };

        utterance.onerror = (event) => {
            console.error('[AudioGuide] Speech error:', event);
            this.isSpeaking = false;
        };

        // Speak
        this.synthesis.speak(utterance);
    }

    /**
     * Check if we can speak for a given zone (cooldown check)
     */
    canSpeak(zone, priority) {
        // Critical messages always allowed
        if (priority === 'critical') {
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
