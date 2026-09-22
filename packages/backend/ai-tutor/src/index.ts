import { getDatabase, aiChatHistory, aiSessions, students, modules, learningSummaries, eq, desc, sql, inArray, initializeDatabase } from '@backend/db';
import { randomUUID } from 'crypto';
import { Ollama } from 'ollama';
import { buildSystemPrompt, buildVoiceSystemPrompt } from './prompts.js';
import { loadContentManifest, getModuleById } from '@backend/content-engine';

import { DATA_PATHS } from '@afe/shared';
import { isLowEndDevice } from '@afe/shared/hardware';

// Ollama client (assumes Ollama is running locally)
let ollama: Ollama | null = null;
let contentManifest: any = null;
let contentRoot: string | undefined;

const OLLAMA_MODEL_CANDIDATES = [
    'qwen2.5:1.5b',
    'qwen2.5-coder:7b',
    'qwen2.5:7b',
    'llama3.2:3b',
    'llama3.1:8b',
    'gemma3:4b',
];

function sessionLogId(sessionId?: string): string {
    if (!sessionId) return 'unknown';
    return sessionId.slice(0, 8).toLowerCase();
}

function logLlmMetric(sessionId: string | undefined, label: string, value: number): void {
    console.log(`[AI-TUTOR][session=${sessionLogId(sessionId)}] [LLM] ${label}: ${value} ms`);
}

/**
 * Initialize the AI Tutor service with the correct database path and optional content root.
 */
export function initializeAiTutor(dbPath: string, contentRootPath?: string) {
    getDatabase(dbPath);
    if (contentRootPath) {
        contentRoot = contentRootPath;
        console.log(`[AiTutor] Initialized with content root: ${contentRootPath}`);
    }
}

function getOllamaClient(): Ollama {
    if (!ollama) {
        ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
    }
    return ollama;
}

async function getAvailableOllamaModels(): Promise<string[]> {
    try {
        const client = getOllamaClient();
        const response = await client.list();
        const models = Array.isArray(response?.models) ? response.models : [];
        return models
            .map((model) => typeof model?.name === 'string' ? model.name : '')
            .filter(Boolean);
    } catch (error) {
        console.warn('[AiTutor] Unable to list Ollama models:', error);
        return [];
    }
}

async function resolveOllamaModel(): Promise<string> {
    const installedModels = await getAvailableOllamaModels();

    for (const candidate of OLLAMA_MODEL_CANDIDATES) {
        const matches = installedModels.some((modelName) => modelName === candidate || modelName.startsWith(`${candidate}:`));
        if (matches) return candidate;
    }

    if (installedModels.length > 0) return installedModels[0];
    return OLLAMA_MODEL_CANDIDATES[0];
}

function getManifest() {
    if (!contentManifest) {
        // Use the initialized content root, or fall back to the hardcoded shared constant
        contentManifest = loadContentManifest(contentRoot || DATA_PATHS.ROOT);
    }
    return contentManifest;
}

async function generateSessionTitle(sessionId: string, firstMessage: string): Promise<string | null> {
    try {
        const client = getOllamaClient();
        const model = await resolveOllamaModel();
        const response = await client.chat({
            model,
            keep_alive: isLowEndDevice() ? 0 : '5m', // Unload immediately on low-end, default 5m otherwise
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant. Generate a short, concise title (3-5 words) for a chat session based on the user\'s first message. Do not use quotes or prefixes. Just the title.'
                },
                {
                    role: 'user',
                    content: firstMessage
                }
            ]
        });

        const title = response.message.content.trim();
        if (title) {
            await updateSessionTitle(sessionId, title);
            return title;
        }
    } catch (error) {
        console.error('Failed to generate session title:', error);
    }
    return null;
}

export async function sendMessage(
    studentId: string,
    message: string,
    sessionId: string,
    shouldCancel?: () => boolean,
    onChunk?: (chunk: string) => void,
    onTitleGenerated?: (title: string) => void
): Promise<{ response: string; cancelled: boolean }> {
    console.log('DEBUG: sendMessage arguments:', { studentId, sessionId });
    try {
        const db = getDatabase();
        const client = getOllamaClient();

        // Get session context
        const sessionResult = await db.select().from(aiSessions).where(eq(aiSessions.id, sessionId));
        const session = sessionResult[0];
        if (!session) throw new Error('Session not found');

        // Get student name
        const student = await db.select().from(students).where(eq(students.id, studentId));
        const studentName = student[0]?.name || 'Student';

        // Fetch module title if in tutor mode
        let moduleTitle: string | undefined;
        if (session.mode === 'tutor' && session.moduleId) {
            const manifest = getManifest();
            const module = getModuleById(manifest, session.moduleId);
            if (module) moduleTitle = module.title;
        }

        // Fetch student summary if available
        const summaryRecord = await db.select().from(learningSummaries).where(eq(learningSummaries.studentId, studentId)).orderBy(desc(learningSummaries.lastUpdatedAt)).limit(1);
        const studentSummary = summaryRecord[0]?.summaryText;

        // Build system prompt
        const systemPrompt = session.mode === 'tutor'
            ? buildSystemPrompt(undefined, moduleTitle, undefined, studentSummary)
            : `You are a helpful and friendly AI assistant. Answer questions clearly and concisely. ${studentSummary ? `Here is context on the student: ${studentSummary}` : ''}`;

        console.log(`DEBUG: Using systemPrompt for mode ${session.mode}: ${systemPrompt}`);

        // Get recent chat history for this SESSION
        const history = await db
            .select()
            .from(aiChatHistory)
            .where(eq(aiChatHistory.sessionId, sessionId))
            .orderBy(aiChatHistory.timestamp)
            .limit(20);

        const isFirstMessage = history.length === 0;

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt },
        ];

        history.forEach((h) => {
            messages.push({
                role: h.role as 'user' | 'assistant',
                content: h.content,
            });
        });

        messages.push({ role: 'user', content: message });

        let aiResponse = '';
        let cancelled = false;
        const model = await resolveOllamaModel();
        const llmStart = performance.now();
        console.log(`[AI-TUTOR][session=${sessionLogId(sessionId)}] [LLM] Started`);

        let firstTokenAt: number | null = null;

        if (onChunk) {
            const stream = await client.chat({
                model,
                messages,
                stream: true,
                keep_alive: isLowEndDevice() ? '1m' : '5m', // 1 minute to save RAM on 4GB laptops
            });

            for await (const part of stream) {
                if (shouldCancel?.()) {
                    cancelled = true;
                    break;
                }
                const chunk = part.message.content;
                if (chunk && firstTokenAt === null) {
                    firstTokenAt = performance.now();
                    logLlmMetric(sessionId, 'TTFT', Math.round(firstTokenAt - llmStart));
                }
                aiResponse += chunk;
                onChunk(chunk);
            }
        } else {
            if (shouldCancel?.()) {
                return { response: '', cancelled: true };
            }
            const response = await client.chat({
                model,
                messages,
                keep_alive: isLowEndDevice() ? '1m' : '5m',
            });
            aiResponse = response.message.content;
        }

        if (cancelled) {
            aiResponse = aiResponse.trim();
            if (aiResponse.length > 0) {
                aiResponse += '\n\n*(response stopped)*';
            } else {
                aiResponse = '*(response stopped)*';
            }
        }

        const now = new Date().toISOString();

        // Save messages and update session
        await db.transaction(async (tx) => {
            await tx.insert(aiChatHistory).values({
                id: randomUUID(),
                sessionId,
                role: 'user',
                content: message,
                timestamp: now,
            });

            if (aiResponse) {
                await tx.insert(aiChatHistory).values({
                    id: randomUUID(),
                    sessionId,
                    role: 'assistant',
                    content: aiResponse,
                    timestamp: now,
                });
            }

            await tx.update(aiSessions)
                .set({ lastMessageAt: now })
                .where(eq(aiSessions.id, sessionId));
        });

        // Trigger title generation if it's the first message
        if (isFirstMessage) {
            // Run asynchronously, don't await the result directly, but since we are in a request handler,
            // we should probably at least trigger it. 
            // Better to await it here to ensure it finishes before we return if we want to update UI immediately? 
            // Or just fire and forget. Let's fire and forget but handle the promise.
            generateSessionTitle(sessionId, message).then(title => {
                if (title && onTitleGenerated) {
                    onTitleGenerated(title);
                }
            });
        }

        return { response: aiResponse, cancelled };
    } catch (error) {
        console.error('AI Tutor error:', error);
        return {
            response: "I'm sorry, I'm currently unavailable. Please make sure Ollama is running locally.",
            cancelled: false,
        };
    }
}

// =============================
// Sentence-boundary streaming
// =============================

/**
 * Split accumulated text into complete sentences for TTS.
 *
 * Rules:
 *  - Split on [.!?] when followed by a space + uppercase letter (new sentence)
 *  - Split on [.!?] at end of string
 *  - Do NOT split on "1. " "2. " (numbered lists) — those get stripped in TTS layer anyway
 *  - Minimum 10 chars to avoid tiny garbage fragments
 */
function extractSentences(buffer: string): { sentences: string[]; remainder: string } {
    const sentences: string[] = [];

    // Matches: sentence-ending punctuation followed by whitespace+uppercase (next sentence)
    // Uses a lookahead so we don't consume the uppercase char
    const sentenceEndRegex = /[.!?](?=\s+[A-Z]|\s*$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = sentenceEndRegex.exec(buffer)) !== null) {
        const end = match.index + match[0].length;
        const sentence = buffer.substring(lastIndex, end).trim();
        if (sentence.length >= 10) {
            sentences.push(sentence);
        }
        lastIndex = end;
        // Skip whitespace after the sentence end
        while (lastIndex < buffer.length && /\s/.test(buffer[lastIndex])) {
            lastIndex++;
        }
        sentenceEndRegex.lastIndex = lastIndex;
    }

    const remainder = buffer.substring(lastIndex).trim();
    return { sentences, remainder };
}

/**
 * Send a voice message — streams from Ollama and fires onSentence at each
 * sentence boundary so TTS can synthesize in parallel.
 * Uses the concise voice system prompt.
 */
export async function sendVoiceMessage(
    studentId: string,
    message: string,
    sessionId: string,
    onSentence: (sentence: string) => void,
    onChunk?: (chunk: string) => void,
    onTitleGenerated?: (title: string) => void
): Promise<string> {
    console.log('DEBUG: sendVoiceMessage arguments:', { studentId, sessionId });
    try {
        const db = getDatabase();
        const client = getOllamaClient();

        // Get session context
        const sessionResult = await db.select().from(aiSessions).where(eq(aiSessions.id, sessionId));
        const session = sessionResult[0];
        if (!session) throw new Error('Session not found');

        // Get student name
        const student = await db.select().from(students).where(eq(students.id, studentId));
        const studentName = student[0]?.name || 'Student';

        // Fetch module title if in tutor mode
        let moduleTitle: string | undefined;
        if (session.mode === 'tutor' && session.moduleId) {
            const manifest = getManifest();
            const module = getModuleById(manifest, session.moduleId);
            if (module) moduleTitle = module.title;
        }

        // Fetch student summary
        const summaryRecord = await db.select().from(learningSummaries).where(eq(learningSummaries.studentId, studentId)).orderBy(desc(learningSummaries.lastUpdatedAt)).limit(1);
        const studentSummary = summaryRecord[0]?.summaryText;

        // Use concise voice prompt
        const systemPrompt = buildVoiceSystemPrompt(undefined, moduleTitle, undefined, studentSummary);

        // Get recent chat history for this SESSION
        const history = await db
            .select()
            .from(aiChatHistory)
            .where(eq(aiChatHistory.sessionId, sessionId))
            .orderBy(aiChatHistory.timestamp)
            .limit(50);

        const isFirstMessage = history.length === 0;

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt },
        ];

        history.forEach((h) => {
            messages.push({
                role: h.role as 'user' | 'assistant',
                content: h.content,
            });
        });

        messages.push({ role: 'user', content: message });

        let aiResponse = '';
        let sentenceBuffer = '';
        const model = await resolveOllamaModel();
        const llmStart = performance.now();
        console.log(`[AI-TUTOR][session=${sessionLogId(sessionId)}] [LLM] Started`);

        const stream = await client.chat({
            model,
            messages,
            stream: true,
            keep_alive: isLowEndDevice() ? '1m' : '5m',
        });

        let firstTokenAt: number | null = null;

        for await (const part of stream) {
            const chunk = part.message.content;
            if (chunk && firstTokenAt === null) {
                firstTokenAt = performance.now();
                logLlmMetric(sessionId, 'TTFT', Math.round(firstTokenAt - llmStart));
            }
            aiResponse += chunk;
            sentenceBuffer += chunk;

            if (onChunk) onChunk(chunk);

            // Check for complete sentences
            const { sentences, remainder } = extractSentences(sentenceBuffer);
            for (const sentence of sentences) {
                onSentence(sentence);
            }
            sentenceBuffer = remainder;
        }

        // Flush any remaining text as the final sentence
        if (sentenceBuffer.trim().length > 0) {
            onSentence(sentenceBuffer.trim());
        }

        logLlmMetric(sessionId, 'Total response latency', Math.round(performance.now() - llmStart));

        const now = new Date().toISOString();

        // Save messages and update session
        await db.transaction(async (tx) => {
            await tx.insert(aiChatHistory).values({
                id: randomUUID(),
                sessionId,
                role: 'user',
                content: message,
                timestamp: now,
            });

            await tx.insert(aiChatHistory).values({
                id: randomUUID(),
                sessionId,
                role: 'assistant',
                content: aiResponse,
                timestamp: now,
            });

            await tx.update(aiSessions)
                .set({ lastMessageAt: now })
                .where(eq(aiSessions.id, sessionId));
        });

        // Trigger title generation for first message
        if (isFirstMessage) {
            generateSessionTitle(sessionId, message).then(title => {
                if (title && onTitleGenerated) {
                    onTitleGenerated(title);
                }
            });
        }

        return aiResponse;
    } catch (error) {
        console.error('AI Tutor voice error:', error);
        return "I'm sorry, I'm currently unavailable. Please make sure Ollama is running.";
    }
}

export async function getSessions(studentId: string) {
    return await getDatabase()
        .select()
        .from(aiSessions)
        .where(eq(aiSessions.studentId, studentId))
        .orderBy(aiSessions.lastMessageAt);
}

export async function createSession(
    studentId: string,
    title: string,
    mode: 'tutor' | 'chat',
    moduleId?: string
) {
    const id = randomUUID();
    const now = new Date().toISOString();
    await getDatabase().insert(aiSessions).values({
        id,
        studentId,
        title,
        mode,
        moduleId,
        createdAt: now,
        lastMessageAt: now,
    });

    // Initial AI greeting if it's a new chat
    // We could add a default message here or let the frontend do it.

    return await getDatabase().select().from(aiSessions).where(eq(aiSessions.id, id)).then(res => res[0]);
}

export async function deleteSession(sessionId: string) {
    await getDatabase().delete(aiSessions).where(eq(aiSessions.id, sessionId));
}

export async function updateSessionTitle(sessionId: string, title: string) {
    await getDatabase()
        .update(aiSessions)
        .set({ title })
        .where(eq(aiSessions.id, sessionId));
}

export async function getSessionHistory(sessionId: string) {
    return await getDatabase()
        .select()
        .from(aiChatHistory)
        .where(eq(aiChatHistory.sessionId, sessionId))
        .orderBy(aiChatHistory.timestamp);
}

export async function clearChatHistory(studentId: string): Promise<void> {
    // This now deletes all sessions for the student which cascades to history
    await getDatabase().delete(aiSessions).where(eq(aiSessions.studentId, studentId));
}

/**
 * Check if Ollama is available
 */
export async function isOllamaAvailable(): Promise<boolean> {
    try {
        const client = getOllamaClient();
        await client.list(); // Simple ping to check if Ollama is running
        return true;
    } catch {
        return false;
    }
}

export async function generateLearningSummary(
    studentId: string,
    previousSummary?: string,
    dbPath?: string
): Promise<{ summary: string; progressNote?: string }> {
    const db = getDatabase(dbPath);
    const client = getOllamaClient();
    const model = await resolveOllamaModel();

    // 1. Fetch all chat history for this student (across all sessions)
    const sessions = await db.select().from(aiSessions).where(eq(aiSessions.studentId, studentId));
    const sessionIds = sessions.map((s) => s.id);

    let chatContext = '';
    if (sessionIds.length > 0) {
        const history = await db
            .select()
            .from(aiChatHistory)
            .where(inArray(aiChatHistory.sessionId, sessionIds))
            .orderBy(aiChatHistory.timestamp);

        // Take last 50 messages to avoid context window issues
        const recentHistory = history.slice(-50);
        chatContext = recentHistory
            .map((h) => `${h.role === 'user' ? 'Student' : 'AI'}: ${h.content}`)
            .join('\n');
    }

    if (!chatContext) {
        return { summary: "No chat history available to generate a summary." };
    }

    // 2. Generate Summary (<300 words)
    const summaryResponse = await client.chat({
        model,
        keep_alive: isLowEndDevice() ? 0 : '5m', // Unload immediately logic on low-end
        messages: [
            {
                role: 'system',
                content: 'You are an educational psychologist. Analyze the student\'s chat history and provide a concise learning summary (< 300 words). Focus on what they have learned, their strengths, and areas where they needed help. Use a supportive tone.'
            },
            { role: 'user', content: `Chat History:\n${chatContext}` }
        ]
    });

    const summary = summaryResponse.message.content.trim();

    // 3. Generate Progress Note if previous summary exists (<100 words)
    let progressNote: string | undefined;
    if (previousSummary) {
        const progressResponse = await client.chat({
            model,
            keep_alive: isLowEndDevice() ? 0 : '5m', // Unload immediately on low-end
            messages: [
                {
                    role: 'system',
                    content: 'You are an educational psychologist. Compare the NEW learning summary with the PREVIOUS one. Write a very brief note (< 100 words) highlighting the progress made or new topics covered. Be specific.'
                },
                {
                    role: 'user',
                    content: `PREVIOUS SUMMARY: ${previousSummary}\n\nNEW SUMMARY: ${summary}`
                }
            ]
        });
        progressNote = progressResponse.message.content.trim();
    }

    return { summary, progressNote };
}

export * from './prompts.js';
