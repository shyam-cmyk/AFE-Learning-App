import { useRef, useState, useCallback, useEffect } from "react";
import { ipc } from "../lib/ipc.ts";

export type OrbState = "idle" | "listening" | "processing" | "speaking";

interface VoiceModeReturn {
    orbState: OrbState;
    audioLevel: number;
    transcript: string;
    response: string;
    isActive: boolean;
    startVoiceMode: (sessionId: string, studentId: string) => Promise<void>;
    stopVoiceMode: () => void;
    tapOrb: () => void;
}

export function useVoiceMode(): VoiceModeReturn {
    const [orbState, setOrbState] = useState<OrbState>("idle");
    const [audioLevel, setAudioLevel] = useState(0);
    const [transcript, setTranscript] = useState("");
    const [response, setResponse] = useState("");
    const [isActive, setIsActive] = useState(false);

    const isActiveRef = useRef(false);
    const orbStateRef = useRef<OrbState>("idle");
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const sessionIdRef = useRef<string>("");
    const studentIdRef = useRef<string>("");
    const sessionLanguageRef = useRef<string>("English");

    // Cleanup STT final listener
    const cleanupSTTRef = useRef<(() => void) | null>(null);
    // Cleanup stream chunk listener
    const cleanupStreamRef = useRef<(() => void) | null>(null);

    // Track active TTS playback
    const ttsAudioCtxRef = useRef<AudioContext | null>(null);
    const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const ttsSpeakIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Voice pipeline listeners
    const cleanupSentenceReadyRef = useRef<(() => void) | null>(null);
    const cleanupVoiceDoneRef = useRef<(() => void) | null>(null);

    // Audio queue for gapless sentence playback
    const audioQueueRef = useRef<Array<{ audio: string; index: number; text: string }>>([]);
    const isPlayingRef = useRef(false);
    const voiceDoneRef = useRef(false);
    const listenAfterResponseRef = useRef<number | null>(null);

    const resolveSpeechLocale = useCallback((lang?: string): string => {
        const normalized = (lang || "English").toLowerCase();
        const localeMap: Record<string, string> = {
            en: "en-IN",
            english: "en-IN",
            hi: "hi-IN",
            hindi: "hi-IN",
            "hi-en": "hi-IN",
            hinglish: "hi-IN",
            ta: "ta-IN",
            tamil: "ta-IN",
            te: "te-IN",
            telugu: "te-IN",
            mr: "mr-IN",
            marathi: "mr-IN",
            gu: "gu-IN",
            gujarati: "gu-IN",
            kn: "kn-IN",
            kannada: "kn-IN",
        };

        return localeMap[normalized] || "en-IN";
    }, []);

    // Helper to update orbState and ref together
    const setOrbStateSync = useCallback((state: OrbState) => {
        orbStateRef.current = state;
        setOrbState(state);
    }, []);

    /**
     * Stop any active TTS playback.
     */
    const stopTTSPlayback = useCallback(() => {
        try { ttsSourceRef.current?.stop(); } catch { /* ignore */ }
        try {
            if (ttsAudioCtxRef.current?.state !== "closed") {
                ttsAudioCtxRef.current?.close();
            }
        } catch { /* ignore */ }
        ttsAudioCtxRef.current = null;
        ttsSourceRef.current = null;

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        ipc.stopTTS();

        if (ttsSpeakIntervalRef.current) {
            clearInterval(ttsSpeakIntervalRef.current);
            ttsSpeakIntervalRef.current = null;
        }
    }, []);

    /**
     * Transition to idle — waiting for user to tap.
     */
    const transitionToIdle = useCallback(() => {
        if (!isActiveRef.current) return;
        console.log("[VoiceMode] -> Idle (waiting for tap)");
        setOrbStateSync("idle");
        setAudioLevel(0);
    }, [setOrbStateSync]);

    /**
     * Start mic and begin recording. Called when user taps the orb.
     */
    const startListening = useCallback(async () => {
        if (!isActiveRef.current) return;
        if (mediaStreamRef.current || audioContextRef.current || workletNodeRef.current) {
            console.log("[VoiceMode] Mic already active, skipping duplicate start");
            return;
        }

        if (!window.electronAPI?.stt) {
            console.warn("[VoiceMode] electronAPI.stt not available");
            return;
        }

        console.log("[VoiceMode] -> Listening (tap-to-talk)");
        setOrbStateSync("listening");
        setTranscript("");
        setResponse("");

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioContext = new AudioContext();
            if (audioContext.state === "suspended") {
                await audioContext.resume();
            }
            console.log("[VoiceMode] AudioContext state:", audioContext.state);
            const source = audioContext.createMediaStreamSource(stream);

            const workletUrl =
                window.location.protocol === "file:"
                    ? new URL("stt-worklet.js", window.location.href).href
                    : new URL("/stt-worklet.js", window.location.origin).href;

            await audioContext.audioWorklet.addModule(workletUrl);

            const workletNode = new AudioWorkletNode(audioContext, "stt-processor", {
                processorOptions: {
                    sampleRate: audioContext.sampleRate,
                    // Manual stop only: do not auto-end recording on silence,
                    // since this cuts off normal speech before the user finishes.
                    vadEnabled: false,
                    silenceThreshold: 0.04,
                    silenceDuration: 3.2,
                    minSpeechDuration: 0.8,
                },
            });

            workletNode.port.onmessage = (event) => {
                if (!isActiveRef.current) return;
                const data = event.data;

                if (data.type === "audio-data" && data.buffer) {
                    if (orbStateRef.current === "listening") {
                        try {
                            window.electronAPI.stt.sendChunk(data.buffer);
                        } catch (err) {
                            console.error("[VoiceMode] Error sending chunk:", err);
                        }
                    }
                } else if (data.type === "audio-level") {
                    if (orbStateRef.current === "listening") {
                        setAudioLevel(data.level);
                    }
                } else if (data.type === "vad-silence") {
                    if (orbStateRef.current === "listening") {
                        console.log("[VoiceMode] VAD silence -> stopping recording");
                        stopListening();
                    }
                }
                // vad-speech events are not used in tap-to-talk mode
            };

            source.connect(workletNode);
            workletNode.connect(audioContext.destination);

            audioContextRef.current = audioContext;
            mediaStreamRef.current = stream;
            workletNodeRef.current = workletNode;
            sourceNodeRef.current = source;

            // Tell main process to start recording
            window.electronAPI.stt.start();

        } catch (error) {
            console.error("[VoiceMode] Error starting recording:", error);
            transitionToIdle();
        }
    }, [setOrbStateSync, transitionToIdle]);

    /**
     * Stop recording and destroy mic. Triggers STT processing.
     */
    const stopListening = useCallback(async () => {
        console.log("[VoiceMode] Stopping recording...");
        setOrbStateSync("processing");
        setAudioLevel(0);

        // Disconnect and destroy mic
        try {
            workletNodeRef.current?.disconnect();
            sourceNodeRef.current?.disconnect();
            mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
            if (audioContextRef.current?.state !== "closed") {
                await audioContextRef.current?.close();
            }
        } catch (err) {
            console.error("[VoiceMode] Stop error:", err);
        }

        audioContextRef.current = null;
        mediaStreamRef.current = null;
        workletNodeRef.current = null;
        sourceNodeRef.current = null;

        // Tell STT to process
        if (window.electronAPI?.stt) {
            window.electronAPI.stt.stop();
        }
    }, [setOrbStateSync]);

    const getTTSVoice = useCallback((_language?: string) => {
        if (!window.speechSynthesis) return null;

        const voices = window.speechSynthesis.getVoices();
        return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) || null;
    }, []);

    /**
     * Play audio using Web Audio API (for Piper WAV) or fallback to OS Speech Synthesis.
     */
    const playTTSAudio = useCallback(async (text: string): Promise<void> => {
        setOrbStateSync("speaking");
        setResponse(text);

        try {
            console.log("[TTS-Playback] Calling ipc.speakTTS...");
            const result = await ipc.speakTTS(text);

            console.log("[TTS-Playback] IPC result:", {
                hasAudio: !!result.audio,
                fallback: result.fallback,
                audioType: typeof result.audio,
                audioLength: typeof result.audio === "string" ? result.audio.length : 0
            });

            if (!isActiveRef.current) return;

            if (result.audio && !result.fallback) {
                return new Promise<void>((resolve) => {
                    try {
                        // Decode base64 string to binary
                        const binaryString = atob(result.audio as string);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }

                        // Create a Blob URL and play via HTML Audio element
                        // (decodeAudioData silently hangs on this custom Piper WAV format)
                        const blob = new Blob([bytes], { type: "audio/wav" });
                        const blobUrl = URL.createObjectURL(blob);

                        console.log("[TTS-Playback] Created Blob URL, size:", bytes.length);

                        const audio = new Audio(blobUrl);

                        // Connect to AudioContext for orb-level analysis
                        const audioCtx = new AudioContext();
                        ttsAudioCtxRef.current = audioCtx;
                        const mediaSource = audioCtx.createMediaElementSource(audio);
                        const analyser = audioCtx.createAnalyser();
                        analyser.fftSize = 256;
                        mediaSource.connect(analyser);
                        analyser.connect(audioCtx.destination);

                        const dataArray = new Uint8Array(analyser.frequencyBinCount);
                        const animateOrb = () => {
                            if (!isActiveRef.current || orbStateRef.current !== "speaking") return;
                            analyser.getByteFrequencyData(dataArray);
                            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                            setAudioLevel(Math.min(1, avg / 128));
                            requestAnimationFrame(animateOrb);
                        };

                        audio.onended = () => {
                            console.log("[TTS-Playback] Audio playback ended");
                            setAudioLevel(0);
                            ttsSourceRef.current = null;
                            ttsAudioCtxRef.current = null;
                            try { audioCtx.close(); } catch { }
                            URL.revokeObjectURL(blobUrl);
                            resolve();
                        };

                        audio.onerror = (e) => {
                            console.error("[TTS-Playback] Audio element error:", e);
                            try { audioCtx.close(); } catch { }
                            ttsAudioCtxRef.current = null;
                            URL.revokeObjectURL(blobUrl);
                            fallbackSpeak(text).then(resolve);
                        };

                        console.log("[TTS-Playback] Starting audio playback via Audio element...");
                        audio.play().then(() => {
                            console.log("[TTS-Playback] Audio.play() resolved successfully");
                            animateOrb();
                        }).catch((playErr) => {
                            console.error("[TTS-Playback] Audio.play() rejected:", playErr);
                            try { audioCtx.close(); } catch { }
                            ttsAudioCtxRef.current = null;
                            URL.revokeObjectURL(blobUrl);
                            fallbackSpeak(text).then(resolve);
                        });

                    } catch (err) {
                        console.error("[TTS-Playback] Exception in audio setup:", err);
                        fallbackSpeak(text).then(resolve);
                    }
                });
            } else {
                console.log("[TTS-Playback] No Piper audio, using fallback speech");
                await fallbackSpeak(text);
            }
        } catch (err) {
            console.error("[TTS-Playback] Top-level error:", err);
            await fallbackSpeak(text);
        }
    }, [setOrbStateSync]);

    /**
     * Fallback TTS using OS Speech Synthesis API.
     */
    const fallbackSpeak = useCallback((text: string): Promise<void> => {
        return new Promise((resolve) => {
            if (!window.speechSynthesis) {
                resolve();
                return;
            }

            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);

            const preferredVoice = getTTSVoice(sessionLanguageRef.current);
            if (preferredVoice) {
                utterance.voice = preferredVoice;
            }

            utterance.onend = () => {
                setAudioLevel(0);
                if (ttsSpeakIntervalRef.current) {
                    clearInterval(ttsSpeakIntervalRef.current);
                    ttsSpeakIntervalRef.current = null;
                }
                resolve();
            };
            utterance.onerror = () => {
                setAudioLevel(0);
                if (ttsSpeakIntervalRef.current) {
                    clearInterval(ttsSpeakIntervalRef.current);
                    ttsSpeakIntervalRef.current = null;
                }
                resolve();
            };

            utterance.onstart = () => {
                ttsSpeakIntervalRef.current = setInterval(() => {
                    if (!isActiveRef.current || orbStateRef.current !== "speaking") {
                        if (ttsSpeakIntervalRef.current) clearInterval(ttsSpeakIntervalRef.current);
                        return;
                    }
                    setAudioLevel(0.3 + Math.random() * 0.4);
                }, 100);
            };

            window.speechSynthesis.speak(utterance);
        });
    }, [getTTSVoice, resolveSpeechLocale]);

    /**
     * Play the next sentence from the audio queue.
     * Chains to the next sentence automatically on end.
     */
    const playNextSentence = useCallback(async () => {
        if (!isActiveRef.current) return;
        if (audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            // If all sentences are received and queue is empty, go idle
            if (voiceDoneRef.current) {
                console.log("[VoiceMode] All sentences played, going idle");
                transitionToIdle();
            }
            return;
        }

        isPlayingRef.current = true;
        const { audio: base64, text } = audioQueueRef.current.shift()!;
        console.log(`[VoiceMode] Playing sentence: "${text.substring(0, 40)}..."`);

        try {
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const blob = new Blob([bytes], { type: "audio/wav" });
            const blobUrl = URL.createObjectURL(blob);
            const audioEl = new Audio(blobUrl);

            const audioCtx = new AudioContext();
            ttsAudioCtxRef.current = audioCtx;
            const mediaSource = audioCtx.createMediaElementSource(audioEl);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            mediaSource.connect(analyser);
            analyser.connect(audioCtx.destination);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const animateOrb = () => {
                if (!isActiveRef.current || orbStateRef.current !== "speaking") return;
                analyser.getByteFrequencyData(dataArray);
                const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                setAudioLevel(Math.min(1, avg / 128));
                requestAnimationFrame(animateOrb);
            };

            audioEl.onended = () => {
                setAudioLevel(0);
                try { audioCtx.close(); } catch { }
                ttsAudioCtxRef.current = null;
                URL.revokeObjectURL(blobUrl);
                // Play next sentence in queue
                playNextSentence();
            };

            audioEl.onerror = () => {
                try { audioCtx.close(); } catch { }
                ttsAudioCtxRef.current = null;
                URL.revokeObjectURL(blobUrl);
                playNextSentence();
            };

            await audioEl.play();
            animateOrb();
        } catch (err) {
            console.error("[VoiceMode] Sentence playback error:", err);
            playNextSentence();
        }
    }, [transitionToIdle]);

    /**
     * Handle the full voice interaction flow after transcript received.
     * Uses the streaming voice pipeline for near real-time STS.
     */
    const handleTranscript = useCallback(async (text: string) => {
        if (!text || !text.trim() || !isActiveRef.current) {
            if (isActiveRef.current) {
                console.log("[VoiceMode] Empty transcript, back to idle");
                transitionToIdle();
            }
            return;
        }

        const cleanedText = text.trim();
        console.log(`[VoiceMode] Transcript: "${cleanedText}"`);
        setTranscript(cleanedText);
        setOrbStateSync("processing");

        // Reset audio queue state
        audioQueueRef.current = [];
        isPlayingRef.current = false;
        voiceDoneRef.current = false;

        if (listenAfterResponseRef.current) {
            clearTimeout(listenAfterResponseRef.current);
            listenAfterResponseRef.current = null;
        }

        // Register sentence-ready listener
        cleanupSentenceReadyRef.current?.();
        cleanupSentenceReadyRef.current = ipc.onTTSSentenceReady((data) => {
            if (!isActiveRef.current) return;
            console.log(`[VoiceMode] Sentence ${data.index} ready: "${data.text.substring(0, 40)}..."`);

            audioQueueRef.current.push(data);

            // Transition to speaking on first sentence
            if (orbStateRef.current !== "speaking") {
                setOrbStateSync("speaking");
            }

            // Start playback if not already playing
            if (!isPlayingRef.current) {
                playNextSentence();
            }
        });

        // Register voice-done listener
        cleanupVoiceDoneRef.current?.();
        cleanupVoiceDoneRef.current = ipc.onAIVoiceDone(() => {
            console.log("[VoiceMode] All sentences received from backend");
            voiceDoneRef.current = true;
            // If playback already finished, go idle
            if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
                scheduleNextListen();
                transitionToIdle();
            }
        });

        try {
            // Fire the voice pipeline (backend will stream TTS_SENTENCE_READY events)
            await ipc.sendAIVoiceMessage(
                studentIdRef.current,
                cleanedText,
                sessionIdRef.current
            );
        } catch (error) {
            console.error("[VoiceMode] Error in voice flow:", error);
            if (isActiveRef.current) {
                transitionToIdle();
            }
        }
    }, [playNextSentence, transitionToIdle, setOrbStateSync]);

    /**
     * Tap the orb — start listening if idle, stop listening if already recording.
     */
    const tapOrb = useCallback(() => {
        if (!isActiveRef.current) return;

        const currentState = orbStateRef.current;

        if (currentState === "idle") {
            startListening();
        } else if (currentState === "listening") {
            // Manual stop
            stopListening();
        } else if (currentState === "speaking") {
            // Tap during speaking = skip TTS and go to listening
            stopTTSPlayback();
            startListening();
        }
        // During "processing", tapping does nothing (wait for result)
    }, [startListening, stopListening, stopTTSPlayback]);

    /**
     * Start voice mode.
     */
    const startVoiceMode = useCallback(async (sessionId: string, studentId: string) => {
        if (isActiveRef.current) return;

        console.log("[VoiceMode] Starting voice mode");
        isActiveRef.current = true;
        setIsActive(true);
        sessionIdRef.current = sessionId;
        studentIdRef.current = studentId;

        try {
            const persistedLanguage = await ipc.getSessionLanguage();
            sessionLanguageRef.current = persistedLanguage || 'English';
        } catch {
            sessionLanguageRef.current = 'English';
        }

        setOrbStateSync("idle");
        setTranscript("");
        setResponse("");

        if (listenAfterResponseRef.current) {
            clearTimeout(listenAfterResponseRef.current);
            listenAfterResponseRef.current = null;
        }

        // Listen for STT final results
        cleanupSTTRef.current = ipc.onSTTFinalResult((text) => {
            if (isActiveRef.current) {
                handleTranscript(text);
            }
        });

        // Listen for streaming chunks (for response display)
        cleanupStreamRef.current = ipc.onAIStreamChunk((chunk) => {
            if (isActiveRef.current) {
                setResponse(prev => prev + chunk);
            }
        });

        // Use the app’s original default greeting tone.
        await playTTSAudio('How can I help you today?');
        if (!isActiveRef.current) return;

        await startListening();
    }, [handleTranscript, playTTSAudio, startListening]);

    /**
     * Stop voice mode completely.
     */
    const scheduleNextListen = useCallback(() => {
        if (!isActiveRef.current) return;

        if (listenAfterResponseRef.current) {
            clearTimeout(listenAfterResponseRef.current);
        }

        listenAfterResponseRef.current = window.setTimeout(() => {
            if (!isActiveRef.current) return;
            if (orbStateRef.current === "idle" || orbStateRef.current === "processing") {
                void startListening();
            }
        }, 200);
    }, [startListening]);

    const stopVoiceMode = useCallback(() => {
        console.log("[VoiceMode] Stopping voice mode");
        isActiveRef.current = false;
        setIsActive(false);
        setOrbStateSync("idle");
        setAudioLevel(0);
        setTranscript("");
        setResponse("");

        // Stop TTS
        stopTTSPlayback();

        if (listenAfterResponseRef.current) {
            clearTimeout(listenAfterResponseRef.current);
            listenAfterResponseRef.current = null;
        }

        // Kill mic if active
        workletNodeRef.current?.disconnect();
        sourceNodeRef.current?.disconnect();
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        if (audioContextRef.current?.state !== "closed") {
            audioContextRef.current?.close().catch(() => { });
        }
        audioContextRef.current = null;
        mediaStreamRef.current = null;
        workletNodeRef.current = null;
        sourceNodeRef.current = null;

        // Stop STT
        if (window.electronAPI?.stt) {
            window.electronAPI.stt.stop();
        }

        // Cleanup listeners
        if (cleanupSTTRef.current) {
            cleanupSTTRef.current();
            cleanupSTTRef.current = null;
        }
        if (cleanupStreamRef.current) {
            cleanupStreamRef.current();
            cleanupStreamRef.current = null;
        }
        if (cleanupSentenceReadyRef.current) {
            cleanupSentenceReadyRef.current();
            cleanupSentenceReadyRef.current = null;
        }
        if (cleanupVoiceDoneRef.current) {
            cleanupVoiceDoneRef.current();
            cleanupVoiceDoneRef.current = null;
        }

        // Clear audio queue
        audioQueueRef.current = [];
        isPlayingRef.current = false;
        voiceDoneRef.current = false;
    }, [stopTTSPlayback, setOrbStateSync]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isActiveRef.current) {
                stopVoiceMode();
            }
        };
    }, [stopVoiceMode]);

    return {
        orbState,
        audioLevel,
        transcript,
        response,
        isActive,
        startVoiceMode,
        stopVoiceMode,
        tapOrb,
    };
}
