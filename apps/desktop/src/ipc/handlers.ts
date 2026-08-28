import { ipcMain, app } from 'electron';
import { IPC_CHANNELS } from '@afe/shared';

// Backend services
import {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudentLastActive,
    updateStudentLanguage,
    generateUniqueUsername,
    updateVideoProgress,
    getVideoProgress,
    getAllVideoProgressForStudent,
    submitQuizAttempt,
    getQuizAttempts,
    getBestQuizScore,
    markModuleStarted,
    getStartedModules,
    updateReadingProgress,
    getReadingProgress,
    getAllReadingProgressForStudent,
} from '@backend/db';

import {
    trackEvent,
    getAnalyticsSummary,
} from '@backend/analytics';

import {
    sendMessage,
    sendVoiceMessage,
    getSessions,
    createSession,
    deleteSession,
    getSessionHistory,
    clearChatHistory,
} from '@backend/ai-tutor';

import {
    loadContentManifest,
    getModuleById,
    getLessonById,
} from '@backend/content-engine';

import {
    initSherpaSTT,
    SherpaStreamingSTT,
    normalizeSpeechLanguage,
    type SupportedSpeechLanguage,
} from '@backend/stt-engine';

import {
    speak as ttsSpeak,
    stop as ttsStop,
    isAvailable as ttsIsAvailable,
} from '@backend/tts-engine';

import path from 'path';
import fs from 'fs';

import {
    PATHS,
    APP_DATA_ROOT,
} from '../main/paths.js';

import { getMp4Duration } from '../main/mp4-parser.js';
import { getMkvDuration } from '../main/mkv-parser.js';
import { SessionManager } from '../main/session-manager.js';

// ============================================================
// Language
// ============================================================

const LANG_CODE_TO_NAME: Record<string, string> = {
    en: 'English',
    english: 'English',
    hi: 'Hindi',
    hindi: 'Hindi',
    'hi-en': 'Hindi / Hinglish',
    hinglish: 'Hindi / Hinglish',
    'hindi-english': 'Hindi / Hinglish',
    'english-hindi': 'Hindi / Hinglish',
    'hindi / hinglish': 'Hindi / Hinglish',
    'hindi / english': 'Hindi / Hinglish',
    'english / hindi': 'Hindi / Hinglish',
    'hi / hinglish': 'Hindi / Hinglish',
    'hi / english': 'Hindi / Hinglish',
    mixed: 'Hindi / Hinglish',
    bilingual: 'Hindi / Hinglish',
    indian: 'Hindi / Hinglish',
    'indian english': 'Hindi / Hinglish',
    ta: 'Tamil',
    te: 'Telugu',
    mr: 'Marathi',
    gu: 'Gujarati',
    kn: 'Kannada',
};

function inferIndianLanguageFromTranscript(text: string): string {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return SessionManager.getLanguage() || 'Hindi / Hinglish';
    }

    const hasDevanagari = /[\u0900-\u097F]/.test(trimmed);
    const hasLatin = /[a-zA-Z]/.test(trimmed);

    if (hasDevanagari && hasLatin) {
        return 'Hindi / Hinglish';
    }

    if (hasDevanagari) {
        return 'Hindi';
    }

    if (hasLatin) {
        return 'English';
    }

    return 'Hindi / Hinglish';
}

// ============================================================
// Content Manifest
// ============================================================

let contentManifest: ReturnType<typeof loadContentManifest> | null = null;

function getManifest() {
    if (!contentManifest) {
        contentManifest = loadContentManifest(APP_DATA_ROOT);

        console.log(
            '[Content] Manifest loaded from:',
            APP_DATA_ROOT
        );

        // Dynamically calculate video durations
        if (contentManifest?.modules) {
            for (const module of contentManifest.modules) {
                let totalSeconds = 0;

                for (const lesson of module.lessons) {
                    if (
                        lesson.type === 'video' &&
                        (lesson as any).videoUrl
                    ) {
                        try {
                            let absolutePath = path.join(
                                PATHS.ROOT,
                                (lesson as any).videoUrl
                            );

                            // Development fallback
                            if (
                                !fs.existsSync(absolutePath) &&
                                !app.isPackaged
                            ) {
                                absolutePath = path.join(
                                    app.getAppPath(),
                                    '../../installer-assets',
                                    (lesson as any).videoUrl
                                );
                            }

                            if (fs.existsSync(absolutePath)) {
                                const ext = path
                                    .extname(absolutePath)
                                    .toLowerCase();

                                const duration =
                                    ext === '.mkv' ||
                                    ext === '.webm'
                                        ? getMkvDuration(absolutePath)
                                        : getMp4Duration(absolutePath);

                                (lesson as any).durationSeconds =
                                    duration;

                                totalSeconds += duration;
                            } else {
                                console.warn(
                                    `[Content] Missing video file for duration parsing: ${absolutePath}`
                                );
                            }
                        } catch (error) {
                            console.error(
                                `[Content] Failed to get duration for ${lesson.id}:`,
                                error
                            );
                        }
                    }
                }

                if (totalSeconds > 0) {
                    (module as any).durationMinutes =
                        Math.round(totalSeconds / 60);
                }
            }
        }
    }

    return contentManifest;
}

// ============================================================
// STT State
// ============================================================

let isRecording = false;

/**
 * Active Sherpa streaming recognizer.
 *
 * The actual implementation lives inside:
 *
 * packages/backend/stt-engine
 */
let sherpaSTT: SherpaStreamingSTT | null = null;

// ============================================================
// Helper: Convert incoming IPC audio to Float32 PCM
// ============================================================

function pcm16ToFloat32(chunk: Buffer | Uint8Array | ArrayBuffer) {
    const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as any);

    if (buffer.length < 2) {
        return null;
    }

    const sampleCount = Math.floor(buffer.length / 2);

    const samples = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
        const int16 = buffer.readInt16LE(i * 2);

        samples[i] = int16 / 32768;
    }

    return samples;
}

// ============================================================
// Helper: Strip Markdown before TTS
// ============================================================

function stripMarkdownForTTS(text: string): string {
    return text
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '$1')

        // Italic
        .replace(/\*(.*?)\*/g, '$1')

        // Numbered lists
        .replace(/^\s*\d+[.)]\s+/gm, '')

        // Bullets
        .replace(/^\s*[-*•]\s+/gm, '')

        // Headings
        .replace(/^#{1,6}\s+/gm, '')

        // Inline code
        .replace(/`([^`]+)`/g, '$1')

        // Markdown links
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

        // Collapse whitespace
        .replace(/\s+/g, ' ')

        .trim();
}

// ============================================================
// Register all IPC handlers
// ============================================================

export function registerIPCHandlers(): void {
    console.log('[IPC] Registering IPC handlers...');

    // ========================================================
    // STT - Sherpa Offline Streaming
    // ========================================================

    ipcMain.on(
        IPC_CHANNELS.STT_START,
        (_event) => {
            if (isRecording) {
                console.warn(
                    '[STT] Start ignored - already recording'
                );

                return;
            }

            console.log(
                '[STT] Starting Sherpa streaming recognition'
            );

            try {
                const preferredLanguage: SupportedSpeechLanguage =
                    normalizeSpeechLanguage(SessionManager.getLanguage());

                console.log(
                    '[STT] Requested language:',
                    SessionManager.getLanguage(),
                    '-> Sherpa:',
                    preferredLanguage
                );

                // Create a fresh recognizer for every recording.
                sherpaSTT = initSherpaSTT(preferredLanguage);

                if (!sherpaSTT) {
                    throw new Error(
                        'Failed to initialize Sherpa STT'
                    );
                }

                sherpaSTT.start();

                isRecording = true;

                console.log(
                    '[STT] Sherpa streaming started'
                );
            } catch (error) {
                console.error(
                    '[STT] Failed to start Sherpa:',
                    error
                );

                sherpaSTT = null;
                isRecording = false;
            }
        }
    );

    // ========================================================
    // STT CHUNK
    // ========================================================

    ipcMain.on(
        IPC_CHANNELS.STT_CHUNK,
        (event, chunk: Buffer | Uint8Array | ArrayBuffer) => {
            if (!isRecording || !sherpaSTT) {
                return;
            }

            if (!chunk) {
                return;
            }

            try {
                const samples = pcm16ToFloat32(chunk);

                if (!samples || samples.length === 0) {
                    console.warn('[STT] Ignored empty audio chunk');
                    return;
                }

                const chunkSize = Buffer.isBuffer(chunk)
                    ? chunk.length
                    : chunk instanceof ArrayBuffer
                        ? chunk.byteLength
                        : chunk.byteLength;

                console.log(
                    '[STT] Received chunk bytes=%d samples=%d firstSample=%f',
                    chunkSize,
                    samples.length,
                    samples[0] ?? 0
                );

                /*
                 * Expected microphone format:
                 *
                 * Sample rate: 16000 Hz
                 * Channels:    1
                 * Format:      signed 16-bit PCM
                 *
                 * Sherpa expects normalized Float32 samples.
                 */

                const text = sherpaSTT.processAudio(
                    samples
                );

                if (text && text.trim()) {
                    const partial = text.trim();

                    console.log(
                        '[STT] Partial:',
                        partial
                    );
                    event.sender.send(
    'stt:partial',
    partial
);

                    // event.sender.send(
                    //     IPC_CHANNELS.STT_PARTIAL,
                    //     partial
                    // );
                }
            } catch (error) {
                console.error(
                    '[STT] Audio processing error:',
                    error
                );
            }
        }
    );

    // ========================================================
    // STT STOP
    // ========================================================

    ipcMain.on(
        IPC_CHANNELS.STT_STOP,
        (event) => {
            if (!isRecording) {
                console.warn(
                    '[STT] Stop ignored - not recording'
                );

                return;
            }

            console.log(
                '[STT] Stopping Sherpa streaming recognition'
            );

            try {
                if (sherpaSTT) {
                    const finalText =
                        sherpaSTT.finish();

                    if (
                        finalText &&
                        finalText.trim()
                    ) {
                        const result =
                            finalText.trim();

                        console.log(
                            '[STT] Final:',
                            result
                        );

                        const inferredLanguage = inferIndianLanguageFromTranscript(result);
                        const inferredNormalized = LANG_CODE_TO_NAME[inferredLanguage]
                            || inferredLanguage
                            || 'Hindi / Hinglish';

                        if (inferredNormalized !== SessionManager.getLanguage()) {
                            console.log(
                                '[STT] Auto-detected speech language:',
                                inferredNormalized
                            );
                            SessionManager.updateLanguage(inferredNormalized);

                            const activeStudentId = SessionManager.getActiveStudentId();
                            if (activeStudentId) {
                                void updateStudentLanguage(activeStudentId, inferredNormalized);
                            }
                        }

                        event.sender.send(
                            IPC_CHANNELS.STT_FINAL,
                            result
                        );
                    } else {
                        console.log(
                            '[STT] No final transcription'
                        );

                        event.sender.send(
                            IPC_CHANNELS.STT_FINAL,
                            ''
                        );
                    }
                } else {
                    event.sender.send(
                        IPC_CHANNELS.STT_FINAL,
                        ''
                    );
                }
            } catch (error) {
                console.error(
                    '[STT] Finalization error:',
                    error
                );

                event.sender.send(
                    IPC_CHANNELS.STT_FINAL,
                    ''
                );
            } finally {
                isRecording = false;

                // Keep the Sherpa instance alive between recordings to avoid
                // reinitialization latency. Reset the internal stream so the
                // recognizer is ready for the next start without losing model
                // state or tokens.
                try {
                    if (sherpaSTT) {
                        sherpaSTT.reset();
                    }
                } catch (err) {
                    // If reset fails, fall back to discarding the instance so
                    // future starts re-create it cleanly.
                    console.error('[STT] Failed to reset Sherpa instance:', err);
                    sherpaSTT = null;
                }
            }
        }
    );

    // ========================================================
    // Student Operations
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.STUDENT_CREATE,
        async (_event, data) => {
            const {
                name,
                avatar,
                grade,
                language,
            } = data;

            const normalizedLang =
                LANG_CODE_TO_NAME[language] ||
                language ||
                'English';

            return await createStudent(
                name,
                avatar,
                grade,
                normalizedLang
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.STUDENT_GET_ALL,
        async () => {
            return await getAllStudents();
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.STUDENT_GET_BY_ID,
        async (_event, data) => {
            const { studentId } = data;

            return await getStudentById(
                studentId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.STUDENT_UPDATE_LAST_ACTIVE,
        async (_event, data) => {
            const { studentId } = data;

            await updateStudentLastActive(
                studentId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.STUDENT_GENERATE_USERNAME,
        async (_event, data) => {
            const { avatarName } = data;

            return await generateUniqueUsername(
                avatarName
            );
        }
    );

    // ========================================================
    // Content Operations
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.CONTENT_GET_MODULES,
        async () => {
            const manifest = getManifest();

            return manifest.modules;
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.CONTENT_GET_MODULE_BY_ID,
        async (_event, data) => {
            const { moduleId } = data;

            const manifest = getManifest();

            return getModuleById(
                manifest,
                moduleId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.CONTENT_GET_LESSON_BY_ID,
        async (_event, data) => {
            const { lessonId } = data;

            const manifest = getManifest();

            return getLessonById(
                manifest,
                lessonId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.CONTENT_GET_VIDEO_METADATA,
        async (_event, data) => {
            const { videoUrl } = data;

            try {
                const absolutePath = path.join(
                    PATHS.ROOT,
                    videoUrl
                );

                if (!fs.existsSync(absolutePath)) {
                    return null;
                }

                const ext = path
                    .extname(absolutePath)
                    .toLowerCase();

                const duration =
                    ext === '.mkv' ||
                    ext === '.webm'
                        ? getMkvDuration(
                              absolutePath
                          )
                        : getMp4Duration(
                              absolutePath
                          );

                const stats =
                    fs.statSync(
                        absolutePath
                    );

                return {
                    duration,
                    size: stats.size,
                };
            } catch (error) {
                console.error(
                    '[IPC] Failed to get video metadata:',
                    error
                );

                return null;
            }
        }
    );

    // ========================================================
    // Progress Tracking
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_UPDATE_VIDEO,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
                watchedPercentage,
                watchDuration,
                watchedSegments,
                lastPosition,
                completed,
            } = data;

            SessionManager.recordWatchDuration(
                watchDuration
            );

            await updateVideoProgress(
                studentId,
                lessonId,
                watchedPercentage,
                watchDuration,
                watchedSegments,
                lastPosition,
                completed
            );

            await trackEvent(
                studentId,
                'video_watched',
                {
                    lessonId,
                    watchDuration,
                    watchedPercentage,
                    lastPosition,
                    completed,
                }
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_GET_VIDEO,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
            } = data;

            return await getVideoProgress(
                studentId,
                lessonId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_GET_ALL_FOR_STUDENT,
        async (_event, data) => {
            const { studentId } = data;

            return await getAllVideoProgressForStudent(
                studentId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_MARK_MODULE_STARTED,
        async (_event, data) => {
            const {
                studentId,
                moduleId,
            } = data;

            await markModuleStarted(
                studentId,
                moduleId
            );

            await trackEvent(
                studentId,
                'module_started',
                {
                    moduleId,
                }
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_GET_STARTED_MODULES,
        async (_event, data) => {
            const { studentId } = data;

            return await getStartedModules(
                studentId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_UPDATE_READING,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
                readPercentage,
                readDuration,
                currentPage,
            } = data;

            console.log(
                `[IPC] Updating reading progress: Student=${studentId}, Lesson=${lessonId}, Duration=+${readDuration}s`
            );

            await updateReadingProgress(
                studentId,
                lessonId,
                readPercentage,
                readDuration,
                currentPage
            );

            await trackEvent(
                studentId,
                'pdf_read',
                {
                    lessonId,
                    readDuration,
                }
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_GET_READING,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
            } = data;

            return await getReadingProgress(
                studentId,
                lessonId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.PROGRESS_GET_ALL_READING,
        async (_event, data) => {
            const { studentId } = data;

            return await getAllReadingProgressForStudent(
                studentId
            );
        }
    );

    // ========================================================
    // Quiz Operations
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.QUIZ_SUBMIT_ATTEMPT,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
                answers,
                timeTaken,
            } = data;

            const manifest = getManifest();

            const lesson =
                getLessonById(
                    manifest,
                    lessonId
                );

            if (
                !lesson ||
                !lesson.quizData
            ) {
                throw new Error(
                    'Quiz not found'
                );
            }

            const gradedAnswers =
                answers.map(
                    (answer: any) => {
                        const question =
                            lesson.quizData!.questions.find(
                                (q: any) =>
                                    q.id ===
                                    answer.questionId
                            );

                        const isCorrect =
                            question
                                ? question.correctAnswerIndex ===
                                  answer.selectedAnswerIndex
                                : false;

                        return {
                            ...answer,
                            isCorrect,
                        };
                    }
                );

            const score =
                gradedAnswers.filter(
                    (answer: any) =>
                        answer.isCorrect
                ).length;

            const totalQuestions =
                lesson.quizData.questions.length;

            const attempt =
                await submitQuizAttempt(
                    studentId,
                    lessonId,
                    score,
                    totalQuestions,
                    gradedAnswers,
                    timeTaken
                );

            await trackEvent(
                studentId,
                'quiz_completed',
                {
                    lessonId,
                    score,
                    totalQuestions,
                    percentage:
                        (score /
                            totalQuestions) *
                        100,
                }
            );

            return attempt;
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.QUIZ_GET_ATTEMPTS,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
            } = data;

            return await getQuizAttempts(
                studentId,
                lessonId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.QUIZ_GET_BEST_SCORE,
        async (_event, data) => {
            const {
                studentId,
                lessonId,
            } = data;

            return await getBestQuizScore(
                studentId,
                lessonId
            );
        }
    );

    // ========================================================
    // Analytics
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.ANALYTICS_TRACK_EVENT,
        async (_event, data) => {
            const {
                studentId,
                eventType,
                metadata,
            } = data;

            await trackEvent(
                studentId,
                eventType as any,
                metadata
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.ANALYTICS_GET_SUMMARY,
        async (_event, data) => {
            const { studentId } = data;

            return await getAnalyticsSummary(
                studentId
            );
        }
    );

    // ========================================================
    // Session Tracking
    // ========================================================

    ipcMain.handle(
        'session:start',
        async (_event, data) => {
            const {
                studentId,
                language,
            } = data || {};

            const normalizedLang =
                LANG_CODE_TO_NAME[language] ||
                language ||
                'English';

            SessionManager.startSession(
                studentId,
                normalizedLang
            );
        }
    );

    ipcMain.handle(
        'session:end',
        async (_event, data) => {
            const {
                csat,
                itp,
                overallRating,
                exploreCareerRating,
                seeMoreToursRating,
            } = data || {};

            await SessionManager.endSession(
                csat ?? null,
                itp ?? null,
                overallRating ?? null,
                exploreCareerRating ?? null,
                seeMoreToursRating ?? null
            );
        }
    );

    ipcMain.handle(
        'session:pause',
        async () => {
            SessionManager.recordPause();
        }
    );

    ipcMain.handle(
        'session:seek',
        async () => {
            SessionManager.recordSeek();
        }
    );

    ipcMain.handle(
        'session:speed',
        async (_event, data) => {
            const { speed } = data;

            SessionManager.recordPlaybackSpeed(
                speed
            );
        }
    );

    ipcMain.handle(
        'session:updateLanguage',
        async (_event, data) => {
            const {
                language,
            } = data || {};

            const normalizedLang =
                LANG_CODE_TO_NAME[language] ||
                language ||
                'English';

            SessionManager.updateLanguage(
                normalizedLang
            );

            const activeStudentId =
                SessionManager.getActiveStudentId();

            if (activeStudentId) {
                await updateStudentLanguage(
                    activeStudentId,
                    normalizedLang
                );
            }
        }
    );

    ipcMain.handle(
        'session:getLanguage',
        async () => {
            return SessionManager.getLanguage();
        }
    );

    ipcMain.handle(
        'session:hasMetEngagementThreshold',
        async () => {
            return SessionManager.hasMetEngagementThreshold();
        }
    );

    // ========================================================
    // App Lifecycle
    // ========================================================

    ipcMain.handle(
        'app:exit-immediately',
        async () => {
            (global as any).isQuitting = true;

            app.quit();
        }
    );

    ipcMain.handle(
        'app:set-close-on-session-end',
        async () => {
            SessionManager.closeOnSessionEnd = true;
        }
    );

    // ========================================================
    // AI Tutor
    // ========================================================

    const aiCancelFlags =
        new Map<string, boolean>();

    ipcMain.handle(
        IPC_CHANNELS.AI_SEND_MESSAGE,
        async (event, data) => {
            const {
                studentId,
                message,
                sessionId,
                requestId,
            } = data;

            console.log(
                '[AI] IPC AI_SEND_MESSAGE received:',
                {
                    studentId,
                    sessionId,
                }
            );

            aiCancelFlags.set(
                requestId,
                false
            );

            try {
                const result =
                    await sendMessage(
                        studentId,
                        message,
                        sessionId,
                        () =>
                            aiCancelFlags.get(
                                requestId
                            ) === true,
                        (chunk) => {
                            event.sender.send(
                                IPC_CHANNELS.AI_STREAM_CHUNK,
                                { chunk }
                            );
                        },
                        (title) => {
                            event.sender.send(
                                IPC_CHANNELS.AI_SESSION_UPDATED,
                                {
                                    sessionId,
                                    title,
                                }
                            );
                        }
                    );

                return result;
            } finally {
                aiCancelFlags.delete(
                    requestId
                );
            }
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.AI_CANCEL_MESSAGE,
        async (_event, data) => {
            const {
                requestId,
            } = data;

            if (!requestId) {
                return {
                    cancelled: false,
                };
            }

            aiCancelFlags.set(
                requestId,
                true
            );

            return {
                cancelled: true,
            };
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.AI_SESSION_GET_ALL,
        async (_event, data) => {
            const { studentId } = data;

            return await getSessions(
                studentId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.AI_SESSION_CREATE,
        async (_event, data) => {
            const {
                studentId,
                title,
                mode,
                moduleId,
            } = data;

            return await createSession(
                studentId,
                title,
                mode,
                moduleId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.AI_SESSION_DELETE,
        async (_event, data) => {
            const { sessionId } = data;

            await deleteSession(
                sessionId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.AI_GET_SESSION_HISTORY,
        async (_event, data) => {
            const { sessionId } = data;

            return await getSessionHistory(
                sessionId
            );
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.AI_CLEAR_HISTORY,
        async (_event, data) => {
            const { studentId } = data;

            await clearChatHistory(
                studentId
            );
        }
    );

    // ========================================================
    // Voice Pipeline - Near Real-Time STS
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.AI_VOICE_MESSAGE,
        async (event, data) => {
            const {
                studentId,
                message,
                sessionId,
            } = data;

            console.log(
                '[Voice] AI_VOICE_MESSAGE received:',
                {
                    studentId,
                    sessionId,
                }
            );

            let sentenceIndex = 0;

            const ttsPromiseChain: Promise<void>[] = [];

            let previousPromise: Promise<void> =
                Promise.resolve();

            const response =
                await sendVoiceMessage(
                    studentId,
                    message,
                    sessionId,

                    // Sentence callback
                    (rawSentence) => {
                        const index =
                            sentenceIndex++;

                        const sentence =
                            stripMarkdownForTTS(
                                rawSentence
                            );

                        if (!sentence) {
                            return;
                        }

                        console.log(
                            `[Voice] Sentence ${index}: "${sentence.substring(
                                0,
                                80
                            )}"`
                        );

                        const waitForPrevious =
                            previousPromise;

                        const orderedSend =
                            waitForPrevious.then(
                                async () => {
                                    try {
                                        const audioBuffer =
                                            await ttsSpeak(
                                                sentence
                                            );

                                        if (
                                            audioBuffer
                                        ) {
                                            const base64 =
                                                audioBuffer.toString(
                                                    'base64'
                                                );

                                            event.sender.send(
                                                IPC_CHANNELS.TTS_SENTENCE_READY,
                                                {
                                                    audio:
                                                        base64,
                                                    index,
                                                    text:
                                                        sentence,
                                                }
                                            );
                                        }
                                    } catch (error) {
                                        console.error(
                                            `[Voice] TTS failed for sentence ${index}:`,
                                            error
                                        );
                                    }
                                }
                            );

                        previousPromise =
                            orderedSend;

                        ttsPromiseChain.push(
                            orderedSend
                        );
                    },

                    // AI stream callback
                    (chunk) => {
                        event.sender.send(
                            IPC_CHANNELS.AI_STREAM_CHUNK,
                            {
                                chunk,
                            }
                        );
                    },

                    // Session title callback
                    (title) => {
                        event.sender.send(
                            IPC_CHANNELS.AI_SESSION_UPDATED,
                            {
                                sessionId,
                                title,
                            }
                        );
                    }
                );

            // Wait for all TTS
            // processing to finish.
            await Promise.all(
                ttsPromiseChain
            );

            event.sender.send(
                IPC_CHANNELS.AI_VOICE_DONE,
                {}
            );

            return {
                response,
            };
        }
    );

    // ========================================================
    // TTS
    // ========================================================

    ipcMain.handle(
        IPC_CHANNELS.TTS_SPEAK,
        async (_event, data) => {
            const {
                text,
            } = data;

            console.log(
                '[TTS] TTS_SPEAK received:',
                text?.substring(0, 50)
            );

            try {
                const audioBuffer =
                    await ttsSpeak(text);

                if (audioBuffer) {
                    const base64 =
                        audioBuffer.toString(
                            'base64'
                        );

                    return {
                        audio: base64,
                        fallback: false,
                    };
                }

                return {
                    audio: null,
                    fallback: true,
                };
            } catch (error) {
                console.error(
                    '[TTS] TTS_SPEAK error:',
                    error
                );

                return {
                    audio: null,
                    fallback: true,
                };
            }
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.TTS_STOP,
        async () => {
            console.log(
                '[TTS] TTS_STOP received'
            );

            ttsStop();
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.TTS_STATUS,
        async () => {
            return {
                available:
                    ttsIsAvailable(),
            };
        }
    );

    // ========================================================
    // Finished
    // ========================================================

    console.log(
        '✓ All IPC handlers registered'
    );
}