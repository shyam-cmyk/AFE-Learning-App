import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AVATARS } from '@afe/shared';
import { ipc } from '../lib/ipc.ts';
import { ConfirmModal } from '../components/ConfirmModal.js';

const PROTOTYPE_AVATARS: Record<string, { emoji: string, bg: string }> = {
  Lion:      { emoji: '🦁', bg: '#FFE08A' },
  Elephant:  { emoji: '🐘', bg: '#C7D2FE' },
  Tiger:     { emoji: '🐯', bg: '#FFD0A6' },
  Panda:     { emoji: '🐼', bg: '#E6E6E6' },
  Eagle:     { emoji: '🦅', bg: '#FFE0C2' },
  Parrot:    { emoji: '🦜', bg: '#A7F3D0' },
  Owl:       { emoji: '🦉', bg: '#FED7AA' },
  Penguin:   { emoji: '🐧', bg: '#BFDBFE' },
  Dolphin:   { emoji: '🐬', bg: '#99F6E4' },
  Butterfly: { emoji: '🦋', bg: '#FBCFE8' },
};

const GRADES = [6, 7, 8, 9, 10, 11, 12];
const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
];
function langNative(code: string) { return (LANGUAGES.find(l => l.code === code) || LANGUAGES[0]).native; }

function Chip({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return <button type="button" className={`neo-chip${active ? ' neo-chip--on' : ''}`} onClick={onClick}>{children}</button>;
}

function Footer() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '30px 0 20px', fontSize: 14, color: '#6E6A64', fontWeight: 600 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#3FB873', border: `2px solid #141210`, display: 'inline-block' }} />
      <span>Amazon Future Engineer · Works offline</span>
    </div>
  );
}

function Avatar({ name, size = 54 }: { name: string, size?: number }) {
  const a = PROTOTYPE_AVATARS[name] || { emoji: name || '👤', bg: '#FFE08A' };
  return <div className="neo-ava" style={{ width: size, height: size, background: a.bg, fontSize: size * 0.5, flexShrink: 0 }}>{a.emoji}</div>;
}

function AvatarSelection() {
    const navigate = useNavigate();
    const [selectedAvatar, setSelectedAvatar] = useState<typeof AVATARS[number]['id']>(AVATARS[0].id);
    const [username, setUsername] = useState('');
    const [grade, setGrade] = useState<number | null>(null);
    const [lang, setLang] = useState('en');
    const [generating, setGenerating] = useState(false);
    const [creating, setCreating] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const avatarObj = AVATARS.find((a) => a.id === selectedAvatar);
        if (avatarObj) {
            handleGenerateUsername(avatarObj.name);
        }
    }, [selectedAvatar]);

    async function handleGenerateUsername(avatarName: string) {
        try {
            setGenerating(true);
            const name = await ipc.generateUniqueUsername(avatarName);
            setUsername(name);
        } catch (error) {
            console.error('Failed to generate username:', error);
        } finally {
            setGenerating(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!username) {
            setErrorMessage('Username is generating. Please wait.');
            return;
        }
        if (grade === null) return;

        try {
            setCreating(true);
            const emoji = AVATARS.find((a) => a.id === selectedAvatar)?.emoji || '🎓';
            const student = await ipc.createStudent(username, emoji, grade, lang);
            await ipc.startSession(student.id, lang);
            navigate(`/dashboard/${student.id}`);
        } catch (error: any) {
            console.error('Failed to create student:', error);
            let msg = error?.message || 'Failed to create student. Please try again.';
            if (msg.includes('Username already exists')) {
                msg = 'Username already exists';
            } else {
                msg = msg.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').replace(/^Error:\s*/i, '');
            }
            setErrorMessage(msg);
        } finally {
            setCreating(false);
        }
    }

    const currentAvatarObj = AVATARS.find((a) => a.id === selectedAvatar);
    const avatarName = currentAvatarObj?.name || 'Lion';
    const canProceed = grade !== null && username.trim().length > 0;
    const H2 = { fontSize: 15, fontWeight: 700, color: '#141210', margin: '0 0 14px', textTransform: 'uppercase' as const, letterSpacing: '1px' };

    return (
        <div className="neo-root" style={{ display: 'flex', flexDirection: 'column', padding: '32px 24px 0' }}>
            <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', flex: 1 }}>
                <button type="button" className="neo-btn" onClick={() => navigate(-1)} style={{ marginBottom: 24, padding: '8px 16px', fontSize: 15 }}>← Back</button>
                <h1 className="h-hero" style={{ fontSize: 'clamp(30px,4.5vw,42px)', margin: '0 0 8px' }}>Make your profile</h1>
                <p style={{ fontSize: 18, color: '#6E6A64', fontWeight: 500, margin: '0 0 30px' }}>Pick an animal, name yourself, and choose the language you learn in.</p>
                
                <form onSubmit={handleSubmit}>
                    <h2 style={H2}>Pick your animal</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(80px,1fr))', gap: 12, marginBottom: 26 }}>
                        {AVATARS.map((avatar) => {
                            const name = avatar.name;
                            const sel = selectedAvatar === avatar.id;
                            const a = PROTOTYPE_AVATARS[name] || { emoji: avatar.emoji, bg: '#fff' };
                            return (
                                <button type="button" key={avatar.id} className="neo-flat neo-tap" onClick={() => setSelectedAvatar(avatar.id)}
                                    style={{ aspectRatio: '1', cursor: 'pointer', background: sel ? a.bg : '#fff',
                                    boxShadow: sel ? `4px 4px 0 0 #FF7A3D` : `3px 3px 0 0 #141210`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>
                                    {a.emoji}
                                </button>
                            );
                        })}
                    </div>

                    <div className="neo-card" style={{ padding: '20px', marginBottom: 30 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#6E6A64', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 14 }}>Your name</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                            <Avatar name={avatarName} size={50} />
                            <input className="neo-input" value={username} onChange={e => setUsername(e.target.value.slice(0, 24))} spellCheck={false}
                                style={{ flex: '1 1 200px', minWidth: 160, fontSize: 22, fontWeight: 700, color: '#141210', padding: '10px 14px' }} />
                            <button type="button" className="neo-btn" onClick={() => handleGenerateUsername(avatarName)} style={{ padding: '11px 16px', fontSize: 14 }} disabled={generating}>
                                {generating ? '🎲 ...' : '🎲 Surprise me'}
                            </button>
                        </div>
                        <p style={{ fontSize: 14, color: '#9A958E', fontWeight: 500, margin: '12px 0 0' }}>We made one up for you. Keep it, or type your own.</p>
                    </div>

                    <h2 style={H2}>Your grade</h2>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 30 }}>
                        {GRADES.map(g => <Chip key={g} active={grade === g} onClick={() => setGrade(g)}>Grade {g}</Chip>)}
                    </div>

                    <h2 style={H2}>Language you learn in</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(124px,1fr))', gap: 12, marginBottom: 30 }}>
                        {LANGUAGES.map(l => {
                            const sel = lang === l.code;
                            return (
                                <button type="button" key={l.code} className="neo-flat neo-tap" onClick={() => setLang(l.code)}
                                    style={{ padding: '12px 14px', cursor: 'pointer', textAlign: 'left', background: sel ? '#FFE6D6' : '#fff',
                                    boxShadow: sel ? `4px 4px 0 0 #FF7A3D` : `3px 3px 0 0 #141210` }}>
                                    <div style={{ fontSize: 18, fontWeight: 700, color: '#141210' }}>{l.native}</div>
                                    <div style={{ fontSize: 13, color: '#6E6A64', fontWeight: 600 }}>{l.label}</div>
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ fontSize: 16, color: '#6E6A64', fontWeight: 600, marginBottom: 20 }}>
                        You're <strong style={{ color: '#141210' }}>{currentAvatarObj?.emoji} {username || '…'}</strong>
                        {grade ? <>, <strong style={{ color: '#141210' }}>Grade {grade}</strong></> : ''}, learning in <strong style={{ color: '#141210' }}>{langNative(lang)}</strong>.
                    </div>

                    <button type="submit" className="neo-btn neo-btn--primary neo-btn--lg neo-btn--block" disabled={!canProceed || creating}
                        style={{ marginBottom: 16 }}>
                        {grade === null ? 'Pick your grade to start' : username.trim().length === 0 ? 'Add a name to start' : creating ? 'Creating...' : 'Start learning →'}
                    </button>
                </form>
            </div>
            <ConfirmModal 
                isOpen={!!errorMessage}
                title="Notice"
                message={errorMessage || ''}
                confirmText="Try Again"
                cancelText="Close"
                onConfirm={() => setErrorMessage(null)}
                onCancel={() => setErrorMessage(null)}
            />
            <Footer />
        </div>
    );
}

export default AvatarSelection;
