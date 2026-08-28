import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ipc } from '../lib/ipc.ts';
import type { Student, Module, StartedModule, VideoProgress, ReadingProgress, QuizAttempt } from '@afe/shared';
import { FeedbackSurveyModal } from '../components/FeedbackSurveyModal.tsx';
import { exitPictureInPictureAndCleanup } from '../lib/mediaCleanup.ts';

interface ModuleProgress {
    module: Module;
    startedModule: StartedModule;
    progress: number; // 0-100
    completedLessons: number;
    totalLessons: number;
}

interface AnalyticsSummary {
    totalWatchTime: number;
    totalReadTime: number;
    modulesStarted: number;
    modulesCompleted: number;
    quizzesTaken: number;
    averageQuizScore: number;
}

function StudentDashboard() {
    const { studentId } = useParams<{ studentId: string }>();
    const navigate = useNavigate();
    const [student, setStudent] = useState<Student | null>(null);
    const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
    const [modules, setModules] = useState<Module[]>([]);
    const [moduleProgressList, setModuleProgressList] = useState<ModuleProgress[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Header states
    const [profileOpen, setProfileOpen] = useState(false);
    const [selectedLanguage, setSelectedLanguage] = useState<string>('English');
    const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement>(null);
    const [langOpen, setLangOpen] = useState(false);

    const availableLanguages = Array.from(
        new Set(modules.map((m) => m.language || 'English'))
    ).sort();

    const filteredModules = modules.filter(
        (m) => (m.language || 'English') === selectedLanguage
    );

    useEffect(() => {
        if (studentId) {
            loadDashboard();
        }
    }, [studentId]);

    // Close profile dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setProfileOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    async function loadDashboard() {
        if (!studentId) return;

        try {
            const [studentData, analyticsData, modulesData, startedModulesData, allVideoProgress, allReadingProgress, sessionLang] = await Promise.all([
                ipc.getStudentById(studentId),
                ipc.getAnalyticsSummary(studentId),
                ipc.getModules(),
                ipc.getStartedModules(studentId),
                ipc.getAllProgressForStudent(studentId),
                ipc.getAllReadingProgress(studentId),
                ipc.getSessionLanguage().catch(() => 'English'),
            ]);

            setStudent(studentData);
            setAnalytics(analyticsData);
            setModules(modulesData);
            if (sessionLang) {
                setSelectedLanguage(sessionLang);
            }

            // Calculate per-module progress
            const progressList = computeModuleProgressList(
                modulesData,
                startedModulesData,
                allVideoProgress,
                allReadingProgress
            );
            setModuleProgressList(progressList);
        } catch (error) {
            console.error('Failed to load dashboard:', error);
        } finally {
            setLoading(false);
        }
    }

    function computeModuleProgressList(
        modules: Module[],
        startedModules: StartedModule[],
        videoProgressArr: VideoProgress[],
        readingProgressArr: ReadingProgress[]
    ): ModuleProgress[] {
        const videoMap = new Map<string, VideoProgress>();
        for (const vp of videoProgressArr) {
            videoMap.set(vp.lessonId, vp);
        }

        const readingMap = new Map<string, ReadingProgress>();
        for (const rp of readingProgressArr) {
            readingMap.set(rp.lessonId, rp);
        }

        const results: ModuleProgress[] = [];

        for (const sm of startedModules) {
            const mod = modules.find(m => m.id === sm.moduleId);
            if (!mod) continue;

            let completedLessons = 0;
            const totalLessons = mod.lessons.length;

            for (const lesson of mod.lessons) {
                if (lesson.type === 'video') {
                    const vp = videoMap.get(lesson.id);
                    if (vp) {
                        const minDuration = lesson.minVideoLength || 0;
                        if (minDuration > 0) {
                            if (vp.totalWatchDuration >= minDuration) completedLessons++;
                        } else if (vp.watchedPercentage >= 90) {
                            completedLessons++;
                        }
                    }
                } else if (lesson.type === 'reading') {
                    const rp = readingMap.get(lesson.id);
                    if (rp) {
                        const minDuration = lesson.minReadingTime || 0;
                        if (minDuration > 0) {
                            if (rp.totalReadDuration >= minDuration) completedLessons++;
                        } else if (rp.readPercentage >= 90) {
                            completedLessons++;
                        }
                    }
                } else if (lesson.type === 'quiz') {
                    // Quiz is "completed" if at least one attempt exists
                }
            }

            const progress = totalLessons > 0
                ? Math.round((completedLessons / totalLessons) * 100)
                : 0;

            results.push({
                module: mod,
                startedModule: sm,
                progress,
                completedLessons,
                totalLessons,
            });
        }

        return results;
    }

    async function handleLanguageChange(lang: string) {
        setSelectedLanguage(lang);
        try {
            await ipc.updateSessionLanguage(lang);
        } catch (error) {
            console.error('Failed to update session language:', error);
        }
    }

    function handleModuleClick(moduleId: string) {
        navigate(`/module/${studentId}/${moduleId}`);
    }

    async function handleLogout() {
        setProfileOpen(false);
        await exitPictureInPictureAndCleanup();
        try {
            const metThreshold = await ipc.hasMetEngagementThreshold();
            if (metThreshold) {
                setIsFeedbackOpen(true);
            } else {
                await ipc.endSession(null, null);
                navigate('/');
            }
        } catch (error) {
            console.error('Failed to check engagement threshold on logout:', error);
            await ipc.endSession(null, null);
            navigate('/');
        }
    }

    async function handleFeedbackSubmit(
        csat: number,
        itp: number,
        overallRating: number,
        exploreCareerRating: number,
        seeMoreToursRating: number
    ) {
        try {
            await exitPictureInPictureAndCleanup();
            await ipc.endSession(csat, itp, overallRating, exploreCareerRating, seeMoreToursRating);
            setIsFeedbackOpen(false);
            navigate('/');
        } catch (error) {
            console.error('Failed to end session:', error);
            navigate('/');
        }
    }

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontSize: 20, fontWeight: 700 }}>Loading dashboard...</div>;
    }

    if (!student) {
        return <div className="neo-root" style={{ padding: 40 }}><p>Student not found</p></div>;
    }

    function formatTime(seconds: number) {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const hours = Math.floor(mins / 60);
        if (hours > 0) return `${hours}h ${mins % 60}m`;
        return `${mins}m ${seconds % 60}s`;
    }

    const totalWatchTimeFormatted = formatTime(Math.round(analytics?.totalWatchTime || 0));

    return (
        <div className="neo-root" style={{ display: 'flex', flexDirection: 'column', padding: '44px 24px 0' }}>
            <div style={{ maxWidth: 940, margin: '0 auto', width: '100%', flex: 1 }}>
                
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
                    <div>
                        <h1 className="h-hero" style={{ fontSize: 'clamp(36px,6vw,54px)', margin: '0 0 4px' }}>Courses</h1>
                        <p style={{ fontSize: 16, color: '#6E6A64', fontWeight: 600, margin: 0 }}>
                            {filteredModules.length} modules • {totalWatchTimeFormatted} watch time
                        </p>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button
                            className="neo-chip"
                            onClick={() => navigate(`/ai-tutor/${studentId}`)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '7px 16px',
                                fontWeight: 700,
                            }}
                        >
                            🤖 AI Tutor
                        </button>
                        {availableLanguages.length > 0 && (
                            <div style={{ position: 'relative' }}>
                                <button 
                                    className="neo-chip" 
                                    onClick={() => setLangOpen(!langOpen)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '7px 16px',
                                    }}
                                >
                                    {selectedLanguage}
                                    <svg fill="#141210" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M7 10l5 5 5-5z"/>
                                    </svg>
                                </button>
                                
                                {langOpen && (
                                    <div className="neo-card" style={{
                                        position: 'absolute',
                                        top: '100%',
                                        right: 0,
                                        marginTop: '8px',
                                        padding: '8px',
                                        zIndex: 1000,
                                        minWidth: '140px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 4
                                    }}>
                                        {availableLanguages.map(lang => (
                                            <button
                                                key={lang}
                                                onClick={() => {
                                                    handleLanguageChange(lang);
                                                    setLangOpen(false);
                                                }}
                                                style={{
                                                    display: 'block',
                                                    width: '100%',
                                                    padding: '10px 14px',
                                                    textAlign: 'left',
                                                    border: 'none',
                                                    background: lang === selectedLanguage ? '#FFE6D6' : 'transparent',
                                                    cursor: 'pointer',
                                                    fontWeight: 700,
                                                    fontSize: '15px',
                                                    color: '#141210',
                                                    borderRadius: '6px',
                                                }}
                                                onMouseEnter={(e) => { if (lang !== selectedLanguage) e.currentTarget.style.backgroundColor = '#FDF3E7' }}
                                                onMouseLeave={(e) => { if (lang !== selectedLanguage) e.currentTarget.style.backgroundColor = 'transparent' }}
                                            >
                                                {lang}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        <div ref={profileRef} style={{ position: 'relative' }}>
                            <button className="neo-flat neo-tap row" onClick={() => setProfileOpen(!profileOpen)} style={{ padding: '6px 12px 6px 6px', gap: 8, cursor: 'pointer' }}>
                                <div className="neo-ava" style={{ width: 32, height: 32, background: '#FFE08A', fontSize: 16, flexShrink: 0 }}>{student.avatar}</div>
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#141210' }}>{student.name}</span>
                            </button>
                            
                            {/* Dropdown Menu */}
                            {profileOpen && (
                                <div className="neo-card" style={{
                                    position: 'absolute',
                                    top: '100%',
                                    right: 0,
                                    marginTop: '8px',
                                    padding: '8px',
                                    zIndex: 1000,
                                    minWidth: '160px',
                                }}>
                                    <button
                                        onClick={handleLogout}
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            padding: '10px 14px',
                                            textAlign: 'left',
                                            border: 'none',
                                            background: 'none',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: '15px',
                                            color: '#ef4444',
                                            borderRadius: '6px',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FDF3E7')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                    >
                                        Exit Session
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Modules Grid */}
                {filteredModules.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 20, marginBottom: 40 }}>
                        {filteredModules.map((module, idx) => {
                            const mp = moduleProgressList.find(p => p.module.id === module.id);
                            const progress = mp ? mp.progress : 0;
                            const vids = module.lessons.filter(l => l.type === 'video').length;
                            const quizzes = module.lessons.filter(l => l.type === 'quiz').length;
                            
                            // Rough estimation of duration if not provided
                            const durationMins = (module as any).durationMinutes || (module.lessons.reduce((acc, l) => acc + ((l as any).durationSeconds || 300), 0) / 60);
                            const durStr = durationMins > 0 ? `${Math.round(durationMins)} min` : '';

                            return (
                                <div key={module.id} className="neo-card neo-tap" onClick={() => handleModuleClick(module.id)} style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer', padding: 0 }}>
                                    <div style={{ padding: '16px 20px', borderBottom: `2.5px solid #141210` }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                            <span className="eyebrow" style={{ color: '#6E6A64' }}>Module {idx + 1}</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#141210' }}>{durStr}</span>
                                        </div>
                                        <h3 style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, margin: '0 0 8px' }}>{module.title}</h3>
                                        <p style={{ fontSize: 15, color: '#6E6A64', margin: 0, fontWeight: 500, lineHeight: 1.4, minHeight: '42px' }}>{module.description}</p>
                                    </div>
                                    <div style={{ padding: '16px 20px', background: '#FFFFFF', borderBottomLeftRadius: 9, borderBottomRightRadius: 9, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 14, fontWeight: 600, color: '#141210', marginBottom: 14 }}>
                                            <span className="row"><span style={{ fontSize: 16, marginRight: 6 }}>▶</span> {vids} videos</span>
                                            <span className="row"><span style={{ fontSize: 16, marginRight: 6 }}>❓</span> {quizzes} quizzes</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ flex: 1 }}>
                                                <div className="neo-bar" style={{ height: 16 }}>
                                                    <i style={{ width: `${progress}%`, background: '#3FB873' }} />
                                                </div>
                                            </div>
                                            <span style={{ fontSize: 14, fontWeight: 700, color: '#141210' }}>{progress}%</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="neo-card" style={{ padding: '40px', textAlign: 'center', color: '#6E6A64', fontWeight: 600 }}>
                        <p>No modules available for {selectedLanguage}.</p>
                    </div>
                )}
            </div>

            <FeedbackSurveyModal
                isOpen={isFeedbackOpen}
                language={selectedLanguage}
                onClose={() => setIsFeedbackOpen(false)}
                onSubmit={handleFeedbackSubmit}
            />
        </div>
    );
}

export default StudentDashboard;
