import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ipc } from '../lib/ipc.ts';
import type { Module, Lesson, VideoProgress } from '@afe/shared';
import VideoPlayer from '../components/VideoPlayer.tsx';
import PDFViewer from '../components/PDFViewer.tsx';
import QuizViewer from '../components/QuizViewer.tsx';
import { FeedbackSurveyModal } from '../components/FeedbackSurveyModal.tsx';
import { exitPictureInPictureAndCleanup } from '../lib/mediaCleanup.ts';

function ModuleDetail() {
    const { studentId, moduleId } = useParams<{ studentId: string; moduleId: string }>();
    const navigate = useNavigate();
    const [module, setModule] = useState<Module | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
    const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
    const [lessonCompletionStates, setLessonCompletionStates] = useState<Record<string, boolean>>({});
    const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
    const savedScrollPositionRef = useRef<number>(0);

    useEffect(() => {
        if (moduleId) {
            loadModule();
            // Dispatch event for global AI Tutor
            window.dispatchEvent(new CustomEvent('set-ai-module', { detail: { moduleId } }));
        }
    }, [moduleId]);

    async function loadCompletionStates(targetModule?: Module | null) {
        const currentModule = targetModule !== undefined ? targetModule : module;
        if (!currentModule || !studentId) return;

        try {
            const completions: Record<string, boolean> = {};

            // Fetch all progress
            const [videoProgressList, readingProgressList] = await Promise.all([
                ipc.getAllProgressForStudent(studentId),
                ipc.getAllReadingProgress(studentId)
            ]);

            const videoProgressMap = new Map(videoProgressList.map(p => [p.lessonId, p]));
            const readingProgressMap = new Map(readingProgressList.map(p => [p.lessonId, p]));

            // Fetch quiz scores
            const quizLessons = currentModule.lessons.filter(l => l.type === 'quiz');
            const quizScores = await Promise.all(
                quizLessons.map(async (l) => {
                    const score = await ipc.getBestQuizScore(studentId, l.id);
                    return { lessonId: l.id, score };
                })
            );
            const quizScoresMap = new Map(quizScores.map(q => [q.lessonId, q.score]));

            for (const lesson of currentModule.lessons) {
                if (lesson.type === 'video') {
                    const progress = videoProgressMap.get(lesson.id);
                    completions[lesson.id] = progress ? (progress.completed || progress.watchedPercentage >= 95) : false;
                } else if (lesson.type === 'reading') {
                    const progress = readingProgressMap.get(lesson.id);
                    completions[lesson.id] = progress ? progress.readPercentage >= 95 : false;
                } else if (lesson.type === 'quiz') {
                    const bestScore = quizScoresMap.get(lesson.id);
                    const passingScore = lesson.quizData?.passingScore || (lesson as any).data?.quizData?.passingScore || 70;
                    completions[lesson.id] = bestScore !== null && bestScore !== undefined ? bestScore >= passingScore : false;
                }
            }

            setLessonCompletionStates(completions);
        } catch (e) {
            console.error('Error loading completion states:', e);
        }
    }

    async function loadModule() {
        if (!moduleId) return;

        try {
            const moduleData = await ipc.getModuleById(moduleId);
            setModule(moduleData);

            // Track module started event
            if (studentId && moduleData) {
                await ipc.markModuleStarted(studentId, moduleId);
                await ipc.trackEvent(studentId, 'module_started', { moduleId });
                await loadCompletionStates(moduleData);
            }
        } catch (error) {
            console.error('Failed to load module:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleBackToModules() {
        await exitPictureInPictureAndCleanup();
        navigate(`/dashboard/${studentId}`);
    }

    async function handleSelectLesson(lesson: Lesson) {
        // Save current scroll position before viewing lesson
        savedScrollPositionRef.current = window.scrollY;
        setSelectedLesson(lesson);
        // Dispatch event for global AI Tutor
        window.dispatchEvent(new CustomEvent('set-ai-lesson', { detail: { lessonId: lesson.id } }));

        if (studentId) {
            try {
                if (lesson.type === 'video') {
                    // Fetch existing video progress
                    const progress = await ipc.getVideoProgress(studentId, lesson.id);
                    setVideoProgress(progress);
                } else if (lesson.type === 'reading') {
                    // Fetch existing reading progress
                    const progress = await ipc.getReadingProgress(studentId, lesson.id);
                    setVideoProgress(progress as any);
                }
            } catch (err) {
                console.error('Failed to load lesson progress', err);
            }
        }
    }

    async function checkModuleCompletion() {
        if (!module || !studentId) return;

        try {
            const sorted = [...module.lessons].sort((a, b) => a.order - b.order);
            const isComplete = sorted.every(lesson => !!lessonCompletionStates[lesson.id]);

            if (isComplete) {
                await ipc.trackEvent(studentId, 'module_completed', { moduleId: module.id });
                alert('🎉 Congratulations! You have completed this module!');
            }
        } catch (e) {
            console.error('Error checking module completion', e);
        }
    }

    async function handleLessonCompleted() {
        // Refresh progress
        if (selectedLesson && studentId) {
            try {
                if (selectedLesson.type === 'video') {
                    const p = await ipc.getVideoProgress(studentId, selectedLesson.id);
                    setVideoProgress(p);
                } else if (selectedLesson.type === 'reading') {
                    const p = await ipc.getReadingProgress(studentId, selectedLesson.id);
                    setVideoProgress(p as any);
                }
            } catch { }
        }

        await loadCompletionStates();
        await checkModuleCompletion();
    }

    async function handleBackToLessonList() {
        await exitPictureInPictureAndCleanup();
        setSelectedLesson(null);
        setVideoProgress(null);
        // Reset global AI Tutor context
        window.dispatchEvent(new CustomEvent('set-ai-lesson', { detail: { lessonId: undefined } }));
        // Refresh completions
        await loadCompletionStates();
        // Restore scroll position to where the student was
        requestAnimationFrame(() => {
            window.scrollTo({ top: savedScrollPositionRef.current, behavior: 'instant' });
        });
    }

    function getLessonIcon(lesson: Lesson): string {
        switch (lesson.type) {
            case 'video':
                return '🎥';
            case 'quiz':
                return '📝';
            case 'reading':
                return '📖';
            default:
                return '📄';
        }
    }

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontSize: 20, fontWeight: 700 }}>Loading module...</div>;
    }

    if (!module) {
        return (
            <div className="neo-root" style={{ padding: 40 }}>
                <p>Module not found</p>
                <button className="neo-btn neo-btn--teal" onClick={handleBackToModules}>
                    ← Back to Modules
                </button>
            </div>
        );
    }

    return (
        <div className="neo-root" style={{ display: 'flex', flexDirection: 'column', padding: '44px 24px 0' }}>
            <div style={{ maxWidth: 940, margin: '0 auto', width: '100%', flex: 1 }}>
                
                <div style={{ marginBottom: 32, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button className="neo-btn neo-btn--teal" onClick={handleBackToModules}>
                        ← Back to Modules
                    </button>
                    <button
                        className="neo-btn neo-btn--teal"
                        onClick={() => navigate(`/ai-tutor/${studentId}`)}
                    >
                        🤖 Open AI Tutor
                    </button>
                </div>

                <div style={{ textAlign: 'center', marginBottom: 48, padding: '40px 0' }}>
                    <h1 className="h-hero" style={{ fontSize: 'clamp(32px,5vw,48px)', margin: '0 0 16px' }}>{module.title}</h1>
                    <p style={{ fontSize: 18, color: '#6E6A64', fontWeight: 500, margin: 0, maxWidth: 800, marginInline: 'auto' }}>
                        {module.description}
                    </p>
                </div>

                <div style={{ height: 4, background: '#141210', width: '100%', marginBottom: 40 }} />

                {selectedLesson ? (
                    <div style={{ marginBottom: 60 }}>
                        <button className="neo-btn neo-btn--teal" onClick={handleBackToLessonList} style={{ marginBottom: 24 }}>
                            ← Back to Lessons
                        </button>
                        <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 24px' }}>{selectedLesson.title}</h2>
                        {selectedLesson.type === 'video' && studentId && (
                            <VideoPlayer
                                key={selectedLesson.id}
                                src={`media://${selectedLesson.videoUrl}`}
                                lessonId={selectedLesson.id}
                                studentId={studentId}
                                language={module.language}
                                initialProgress={videoProgress ? {
                                    watchedPercentage: videoProgress.watchedPercentage,
                                    totalWatchDuration: videoProgress.totalWatchDuration,
                                    lastWatchedAt: videoProgress.lastWatchedAt
                                } : undefined}
                                onCompleted={handleLessonCompleted}
                            />
                        )}
                        {selectedLesson.type === 'reading' && studentId && (
                            <PDFViewer
                                key={selectedLesson.id}
                                src={`media://${selectedLesson.readingUrl}`} // Use readingUrl for PDFs
                                lessonId={selectedLesson.id}
                                studentId={studentId}
                                initialProgress={videoProgress ? {
                                    readPercentage: (videoProgress as any).readPercentage,
                                    currentPage: (videoProgress as any).currentPage,
                                    totalReadDuration: (videoProgress as any).totalReadDuration,
                                    lastReadAt: (videoProgress as any).lastReadAt
                                } : undefined}
                                onCompleted={handleLessonCompleted}
                            />
                        )}
                        {selectedLesson.type === 'quiz' && studentId && (
                            <QuizViewer
                                lessonId={selectedLesson.id}
                                studentId={studentId}
                                quizData={selectedLesson.quizData || (selectedLesson as any).data?.quizData}
                                onCompleted={handleLessonCompleted}
                            />
                        )}
                        {/* Placeholder for other types */}
                        {selectedLesson.type !== 'video' && selectedLesson.type !== 'reading' && selectedLesson.type !== 'quiz' && (
                            <div className="neo-card" style={{ padding: 24, textAlign: 'center', color: '#6E6A64', fontWeight: 600 }}>Content type {selectedLesson.type} viewer coming soon.</div>
                        )}
                    </div>
                ) : (
                    <div style={{ marginBottom: 60 }}>
                        <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 32px' }}>Lessons ({module.lessons.length})</h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {(() => {
                                const sortedLessons = [...module.lessons].sort((a, b) => a.order - b.order);
                                return sortedLessons.map((lesson, idx) => {
                                    const isUnlocked = idx === 0 || !!lessonCompletionStates[sortedLessons[idx - 1].id];
                                    const isCompleted = !!lessonCompletionStates[lesson.id];
                                    const showSeparator = isUnlocked && !isCompleted && idx < sortedLessons.length - 1;
                                    return (
                                        <React.Fragment key={lesson.id}>
                                            <div 
                                                className={`neo-card ${isUnlocked ? 'neo-tap' : ''}`}
                                                onClick={() => {
                                                    if (isUnlocked) {
                                                        handleSelectLesson(lesson);
                                                    } else {
                                                        alert("🔒 This lesson is locked. Please complete the previous lessons first!");
                                                    }
                                                }} 
                                                style={{ 
                                                    cursor: isUnlocked ? 'pointer' : 'not-allowed',
                                                    opacity: isUnlocked ? 1 : 0.6,
                                                    backgroundColor: isUnlocked ? '#FFFFFF' : '#EAEAE6',
                                                    borderStyle: isUnlocked ? 'solid' : 'dashed',
                                                    boxShadow: isUnlocked ? '5px 5px 0 0 #141210' : 'none',
                                                    transform: 'none',
                                                    padding: '24px 32px'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                                                    <div style={{ fontSize: '48px', filter: isUnlocked ? 'none' : 'grayscale(100%)', flexShrink: 0, opacity: isUnlocked ? 1 : 0.5 }}>
                                                        {isUnlocked ? getLessonIcon(lesson) : '🔒'}
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <h3 style={{ 
                                                            fontSize: 22,
                                                            fontWeight: 700,
                                                            margin: '0 0 8px'
                                                        }}>
                                                            {lesson.title}
                                                        </h3>
                                                        <p style={{ color: '#6E6A64', fontSize: 16, fontWeight: 500, margin: '0 0 16px' }}>
                                                            {lesson.description}
                                                        </p>
                                                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                                            <span className="neo-chip" style={{
                                                                backgroundColor: isCompleted ? '#3FB873' : '#4ECDC4',
                                                                color: isCompleted ? '#FFFFFF' : '#141210',
                                                                textTransform: 'uppercase',
                                                                fontSize: 13,
                                                                padding: '6px 14px'
                                                            }}>
                                                                {lesson.type} {isCompleted && '✓'}
                                                            </span>
                                                            {(lesson as any).durationSeconds > 0 && (
                                                                <span style={{ fontSize: 14, color: '#6E6A64', fontWeight: 600 }}>
                                                                    {Math.round((lesson as any).durationSeconds / 60)} min
                                                                </span>
                                                            )}
                                                            {!isUnlocked && (
                                                                <span style={{ fontSize: '14px', color: '#ef476f', fontWeight: 800 }}>
                                                                    Locked
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            {showSeparator && (
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    margin: '16px 0',
                                                    width: '100%',
                                                    gap: 16
                                                }}>
                                                    <div style={{ flex: 1, height: 2, backgroundColor: '#141210' }} />
                                                    <span style={{
                                                        fontWeight: 800,
                                                        fontSize: '14px',
                                                        color: '#ef476f',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '1px',
                                                        padding: '8px 16px',
                                                        backgroundColor: '#FFFFFF',
                                                        border: '2.5px solid #141210',
                                                        borderRadius: '12px',
                                                        boxShadow: '3px 3px 0 #141210',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                        🔒 Complete to unlock next
                                                    </span>
                                                    <div style={{ flex: 1, height: 2, backgroundColor: '#141210' }} />
                                                </div>
                                            )}
                                        </React.Fragment>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )}
            </div>

            <FeedbackSurveyModal
                isOpen={isFeedbackOpen}
                language={module?.language}
                onClose={() => setIsFeedbackOpen(false)}
                onSubmit={async (csat, itp, overallRating, exploreCareerRating, seeMoreToursRating) => {
                    await exitPictureInPictureAndCleanup();
                    await ipc.endSession(csat, itp, overallRating, exploreCareerRating, seeMoreToursRating);
                    setIsFeedbackOpen(false);
                    navigate('/');
                }}
            />
        </div>
    );
}

export default ModuleDetail;
