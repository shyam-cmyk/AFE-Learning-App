import { getDeviceInfo } from './device-info.js';
import { getDatabase, saveAFESession, getSessionCountForDate, getStudentById, videoProgress, lessons, quizAttempts } from '@backend/db';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import os from 'os';
import { app } from 'electron';

export interface ActiveSession {
    studentId: string;
    startTime: Date;
    pauseCount: number;
    seekCount: number;
    playbackSpeeds: number[];
    watchTimeSeconds: number;
    language: string;
}

export class SessionManager {
    private static activeSession: ActiveSession | null = null;
    public static closeOnSessionEnd = false;

    /**
     * Start a new session for a student
     */
    static startSession(studentId: string, language: string = 'English'): void {
        // If there's an active session already, end it first to prevent orphans
        if (this.activeSession) {
            console.log(`[SessionManager] Ending orphaned session for student ${this.activeSession.studentId}`);
            this.endSession(null, null);
        }

        const normalizedLanguage = language && language.trim() ? language : 'English';

        this.activeSession = {
            studentId,
            startTime: new Date(),
            pauseCount: 0,
            seekCount: 0,
            playbackSpeeds: [],
            watchTimeSeconds: 0,
            language: normalizedLanguage
        };
        console.log(`[SessionManager] Started session for student ${studentId} with language ${normalizedLanguage}`);
    }

    /**
     * Record a video pause event
     */
    static recordPause(): void {
        if (this.activeSession) {
            this.activeSession.pauseCount++;
        }
    }

    /**
     * Record a video seek event
     */
    static recordSeek(): void {
        if (this.activeSession) {
            this.activeSession.seekCount++;
        }
    }

    /**
     * Record a playback speed change
     */
    static recordPlaybackSpeed(speed: number): void {
        if (this.activeSession) {
            this.activeSession.playbackSpeeds.push(speed);
        }
    }

    /**
     * Record watch duration (called when player saves progress)
     */
    static recordWatchDuration(durationSeconds: number): void {
        if (this.activeSession) {
            this.activeSession.watchTimeSeconds += durationSeconds;
        }
    }

    /**
     * Get active student ID
     */
    static getActiveStudentId(): string | null {
        return this.activeSession ? this.activeSession.studentId : null;
    }

    /**
     * Get active session language
     */
    static getLanguage(): string {
        return this.activeSession ? (this.activeSession.language || 'English') : 'English';
    }

    /**
     * Determine if the active session meets the engagement threshold to display feedback survey.
     * Criteria:
     * - Active video watch time >= 60 seconds OR
     * - Total session duration >= 120 seconds (2 minutes)
     */
    static hasMetEngagementThreshold(): boolean {
        if (!this.activeSession) return false;
        const durationSeconds = (Date.now() - this.activeSession.startTime.getTime()) / 1000;
        const watchTime = this.activeSession.watchTimeSeconds || 0;
        return watchTime >= 60 || durationSeconds >= 120;
    }

    /**
     * Update active session language
     */
    static updateLanguage(language: string): void {
        if (this.activeSession) {
            this.activeSession.language = language;
            console.log(`[SessionManager] Updated language for active session: ${language}`);
        }
    }

    /**
     * End the active session and save it to the SQLite database
     */
    static async endSession(
        csat: number | null,
        itp: number | null,
        overallRating: number | null = null,
        exploreCareerRating: number | null = null,
        seeMoreToursRating: number | null = null
    ): Promise<void> {
        if (!this.activeSession) {
            console.log('[SessionManager] No active session to end');
            return;
        }

        const session = this.activeSession;
        this.activeSession = null; // Clear immediately to prevent double calls

        try {
            const db = getDatabase();
            const endTime = new Date();
            const durationMs = endTime.getTime() - session.startTime.getTime();
            const durationMinutes = Math.max(1, Math.round(durationMs / 60000)); // Minimum 1 minute

            const deviceInfo = await getDeviceInfo();
            const student = await getStudentById(session.studentId);
            if (!student) {
                console.error(`[SessionManager] Student ${session.studentId} not found in database`);
                return;
            }

            const sessionDate = session.startTime.toISOString().split('T')[0]; // YYYY-MM-DD
            const academicYear = this.calculateAcademicYear(session.startTime);
            const monthName = session.startTime.toLocaleString('en-US', { month: 'long' });

            // Generate Session ID
            const sequenceCount = await getSessionCountForDate(student.id, sessionDate);
            const sequenceStr = String(sequenceCount + 1).padStart(3, '0');
            const schoolUdise = deviceInfo.schoolUdise || '12345678901';
            const gradeStr = String(student.grade || 5).padStart(2, '0');
            const sessionId = `CT_IN_${sessionDate.replace(/-/g, '')}_${schoolUdise}_${gradeStr}_INDIV_${sequenceStr}`;

            // --- Query Quiz Attempts during this session ---
            const startISO = session.startTime.toISOString();
            const endISO = endTime.toISOString();
            const sessionQuizzes = await db.select()
                .from(quizAttempts)
                .where(
                    and(
                        eq(quizAttempts.studentId, student.id),
                        sql`${quizAttempts.completedAt} >= ${startISO}`,
                        sql`${quizAttempts.completedAt} <= ${endISO}`
                    )
                );

            const quizzesCompletedCount = sessionQuizzes.length;
            const totalQuestionsAnswered = sessionQuizzes.reduce((sum, q) => sum + q.totalQuestions, 0);
            const correctAnswersCount = sessionQuizzes.reduce((sum, q) => sum + q.score, 0);
            const quizAccuracyPercentage = totalQuestionsAnswered > 0
                ? Number(((correctAnswersCount / totalQuestionsAnswered) * 100).toFixed(2))
                : 0.00;

            // --- Query Video Progress (cumulative and session level) ---
            // Get all videos in manifest to calculate completion rate
            const allVideos = await db.select().from(lessons).where(eq(lessons.type, 'video'));
            const totalVideosCount = allVideos.length || 1;

            const allStudentVideoProgress = await db.select()
                .from(videoProgress)
                .where(eq(videoProgress.studentId, student.id));

            // Completed is watchedPercentage >= 80% (according to guide)
            const completedVideos = allStudentVideoProgress.filter(vp => vp.watchedPercentage >= 80);
            const completedVideosCount = completedVideos.length;
            const videoCompletionRate = Number(((completedVideosCount / totalVideosCount) * 100).toFixed(2));

            // Session completed flag: TRUE if student completed all required content overall
            const allQuizzes = await db.select().from(lessons).where(eq(lessons.type, 'quiz'));
            const completedQuizzesCount = await db.select({ count: sql<number>`COUNT(DISTINCT ${quizAttempts.lessonId})` })
                .from(quizAttempts)
                .where(eq(quizAttempts.studentId, student.id));
            const distinctQuizzesCompleted = completedQuizzesCount[0]?.count || 0;

            const sessionCompletedFlag = (completedVideosCount >= totalVideosCount) && (distinctQuizzesCompleted >= allQuizzes.length);

            // Completion percentage overall: (completed videos + completed quizzes) / (total videos + total quizzes) * 100
            const totalItems = totalVideosCount + (allQuizzes.length || 1);
            const completedItems = completedVideosCount + distinctQuizzesCompleted;
            const completionPercentage = Math.round((completedItems / totalItems) * 100);

            // Average Playback Speed
            const avgPlaybackSpeed = session.playbackSpeeds.length > 0
                ? Number((session.playbackSpeeds.reduce((sum, s) => sum + s, 0) / session.playbackSpeeds.length).toFixed(2))
                : 1.00;

            // Average watch time per video in this session
            const sessionVideosWatched = await db.select({ count: sql<number>`COUNT(DISTINCT ${videoProgress.lessonId})` })
                .from(videoProgress)
                .where(
                    and(
                        eq(videoProgress.studentId, student.id),
                        sql`${videoProgress.lastWatchedAt} >= ${startISO}`,
                        sql`${videoProgress.lastWatchedAt} <= ${endISO}`
                    )
                );
            const sessionVideosCount = sessionVideosWatched[0]?.count || 0;
            const avgWatchTimeSeconds = sessionVideosCount > 0
                ? Math.round(session.watchTimeSeconds / sessionVideosCount)
                : 0;

            // Save Session Row
            const afeSessionRow = {
                id: sessionId,
                studentId: student.id,
                avatarName: student.name,
                sessionDate,
                startTime: startISO,
                endTime: endISO,
                durationMinutes,
                csatAvg: csat !== null ? Number(csat.toFixed(2)) : null,
                itpAvg: itp !== null ? Number(itp.toFixed(2)) : null,
                overallRating: overallRating !== null ? Number(overallRating.toFixed(2)) : null,
                exploreCareerRating: exploreCareerRating !== null ? Number(exploreCareerRating.toFixed(2)) : null,
                seeMoreToursRating: seeMoreToursRating !== null ? Number(seeMoreToursRating.toFixed(2)) : null,
                videoCompletionRate,
                quizAccuracyPercentage,
                avgWatchTimeSeconds,
                videosCompletedCount: completedVideosCount,
                quizzesCompletedCount: quizzesCompletedCount,
                totalQuestionsAnswered,
                correctAnswersCount,
                sessionCompletedFlag,
                completionPercentage,
                totalWatchTimeSeconds: Math.round(session.watchTimeSeconds),
                avgPlaybackSpeed,
                pauseCountTotal: session.pauseCount,
                seekCountTotal: session.seekCount,
                networkType: this.getNetworkType(),
                language: session.language,
                synced: false,
                createdAt: new Date().toISOString()
            };

            await saveAFESession(afeSessionRow);
            console.log(`[SessionManager] Session ${sessionId} saved successfully to database.`);

            if (SessionManager.closeOnSessionEnd) {
                console.log('[SessionManager] closeOnSessionEnd is true, quitting app.');
                (global as any).isQuitting = true;
                app.quit();
            }
        } catch (error) {
            console.error('[SessionManager] Failed to save session:', error);
        }
    }

    private static calculateAcademicYear(date: Date): string {
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-indexed, so 3 is April
        if (month >= 3) {
            return `${year}-${String(year + 1).slice(2)}`;
        } else {
            return `${year - 1}-${String(year).slice(2)}`;
        }
    }

    private static getNetworkType(): string {
        return 'wifi'; 
    }
}
