import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    OnlineRecognizer,
    OnlineStream,
} from "sherpa-onnx-node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MODEL_DIR = path.join(
    __dirname,
    "../sherpa-onnx-streaming-zipformer-en-20M-2023-02-17"
);

const OVERRIDE_MODEL_DIR = process.env.SHERPA_STT_MODEL_DIR
    ? path.resolve(process.env.SHERPA_STT_MODEL_DIR)
    : null;

const REQUESTED_MODEL_NAME =
    (process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL ?? "english")
        .trim()
        .toLowerCase();

const MODEL_NAME_ALIASES: Record<string, string[]> = {
    english: ["english", "en", "zipformer-en"],
    "indian-english": ["indian-english", "indian english", "indian-en", "zipformer-indian-en"],
    hinglish: ["hinglish", "hi-en", "hindi-english", "hindi english", "zipformer-hi-en"],
    hindi: ["hindi", "hi", "zipformer-hi"],
    tamil: ["tamil", "ta", "zipformer-ta"],
    telugu: ["telugu", "te", "zipformer-te"],
    marathi: ["marathi", "mr", "zipformer-mr"],
    gujarati: ["gujarati", "gu", "zipformer-gu"],
    kannada: ["kannada", "kn", "zipformer-kn"],
};

export const SUPPORTED_SPEECH_LANGUAGES = [
    "en",
    "hi",
    "hi-en",
    "ta",
    "te",
    "mr",
    "gu",
    "kn",
] as const;

export type SupportedSpeechLanguage =
    (typeof SUPPORTED_SPEECH_LANGUAGES)[number];

const LANGUAGE_ALIASES: Record<string, SupportedSpeechLanguage> = {
    en: "en",
    english: "en",
    "en-in": "en",
    "english-in": "en",
    hi: "hi",
    hindi: "hi",
    "hi-in": "hi",
    "hindi-in": "hi",
    "hi-en": "hi-en",
    "hinglish": "hi-en",
    "hindi-english": "hi-en",
    "english-hindi": "hi-en",
    "hi/en": "hi-en",
    "hin-eng": "hi-en",
    "hindi english": "hi-en",
    "english hindi": "hi-en",
    "hindi / hinglish": "hi-en",
    "hindi / english": "hi-en",
    "english / hindi": "hi-en",
    "hi / hinglish": "hi-en",
    "hi / english": "hi-en",
    "indian english": "hi-en",
    "english indian": "hi-en",
    bilingual: "hi-en",
    mixed: "hi-en",
    ta: "ta",
    tamil: "ta",
    "ta-in": "ta",
    te: "te",
    telugu: "te",
    "te-in": "te",
    mr: "mr",
    marathi: "mr",
    "mr-in": "mr",
    gu: "gu",
    gujarati: "gu",
    "gu-in": "gu",
    kn: "kn",
    kannada: "kn",
    "kn-in": "kn",
};

export function normalizeSpeechLanguage(
    language?: string | null
): SupportedSpeechLanguage {
    if (!language) {
        return "en";
    }

    const normalized = language.trim().toLowerCase();
    const compact = normalized
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (
        compact.includes("hinglish") ||
        compact.includes("indian english") ||
        compact.includes("mixed") ||
        (compact.includes("hindi") && compact.includes("english")) ||
        (compact.includes("hi") && compact.includes("english")) ||
        (compact.includes("hindi") && compact.includes("eng")) ||
        (compact.includes("hi") && compact.includes("eng"))
    ) {
        return "hi-en";
    }

    if (compact.includes("hindi") || compact.includes("hi")) {
        return "hi";
    }

    if (compact.includes("english") || compact.includes("eng")) {
        return "en";
    }

    return LANGUAGE_ALIASES[normalized] ?? LANGUAGE_ALIASES[compact] ?? "hi-en";
}

const SAMPLE_RATE = 16000;

function normalizeModelSelector(rawName?: string): string {
    const value = (rawName ?? REQUESTED_MODEL_NAME ?? "english")
        .trim()
        .toLowerCase();

    if (!value) {
        return "english";
    }

    for (const [key, aliases] of Object.entries(MODEL_NAME_ALIASES)) {
        if (aliases.includes(value) || key === value) {
            return key;
        }
    }

    return value.replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function findMatchingModelDirs(prefixes: string[]): string[] {
    const roots = [
        __dirname,
        process.cwd(),
    ];

    const results: string[] = [];

    for (const root of roots) {
        try {
            const entries = fs.readdirSync(root, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                for (const prefix of prefixes) {
                    if (entry.name.startsWith(prefix)) {
                        results.push(path.join(root, entry.name));
                    }
                }
            }
        } catch {
            // ignore missing directories in the current runtime location
        }
    }

    return Array.from(new Set(results));
}

function resolveModelDir(language: SupportedSpeechLanguage): string {
    const configuredModel = normalizeModelSelector(process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL);
    const candidateNames: string[] = [];

    if (OVERRIDE_MODEL_DIR) {
        candidateNames.push(path.basename(OVERRIDE_MODEL_DIR));
    }

    const explicitBaseNames = new Set<string>();

    if (configuredModel === "english") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-en");
    } else if (configuredModel === "indian-english") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-indian-en");
    } else if (configuredModel === "hinglish") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-hi-en");
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-hi");
    } else if (configuredModel === "hindi") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-hi");
    } else if (configuredModel === "tamil") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-ta");
    } else if (configuredModel === "telugu") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-te");
    } else if (configuredModel === "marathi") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-mr");
    } else if (configuredModel === "gujarati") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-gu");
    } else if (configuredModel === "kannada") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-kn");
    }

    if (language === "en") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-en");
    } else if (language === "hi-en") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-hi-en");
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-hi");
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-en");
    } else if (language === "hi") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-hi");
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-en");
    } else if (language === "ta") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-ta");
    } else if (language === "te") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-te");
    } else if (language === "mr") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-mr");
    } else if (language === "gu") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-gu");
    } else if (language === "kn") {
        explicitBaseNames.add("sherpa-onnx-streaming-zipformer-kn");
    }

    for (const prefix of explicitBaseNames) {
        candidateNames.push(prefix);
    }

    const candidateDirs: string[] = [];

    if (OVERRIDE_MODEL_DIR) {
        candidateDirs.push(OVERRIDE_MODEL_DIR);
    }

    for (const candidate of candidateNames) {
        candidateDirs.push(
            path.join(__dirname, `../${candidate}`),
            path.join(process.cwd(), `./${candidate}`),
            ...findMatchingModelDirs([candidate])
        );
    }

    const seen = new Set<string>();
    let foundDir: string | null = null;

    for (const candidateDir of candidateDirs) {
        if (!candidateDir || seen.has(candidateDir)) {
            continue;
        }
        seen.add(candidateDir);

        if (fs.existsSync(candidateDir) && fs.existsSync(path.join(candidateDir, "tokens.txt"))) {
            foundDir = candidateDir;
            break;
        }
    }

    if (foundDir) {
        console.log(`[Sherpa] Requested model: ${configuredModel}`);
        console.log(`[Sherpa] Active model directory: ${foundDir}`);
        return foundDir;
    }

    console.warn(
        `[Sherpa] No compatible streaming model found for language="${language}" and model="${configuredModel}". Falling back to English model at ${DEFAULT_MODEL_DIR}. ` +
        `Set STT_MODEL or SHERPA_STT_MODEL_DIR to a valid Sherpa streaming bundle to bypass the fallback.`
    );

    return DEFAULT_MODEL_DIR;
}

function findModelFile(modelDir: string, basename: string): string | null {
    if (!fs.existsSync(modelDir)) {
        return null;
    }

    const entries = fs.readdirSync(modelDir);
    const candidates = [
        `${basename}.int8.onnx`,
        `${basename}.onnx`,
        `${basename}-int8.onnx`,
        `${basename}-epoch-99-avg-1.int8.onnx`,
        `${basename}-epoch-10-avg-5-chunk-64-left-256.int8.onnx`,
        `${basename}-epoch-10-avg-5-chunk-64-left-256.onnx`,
    ];

    for (const candidate of candidates) {
        const filePath = path.join(modelDir, candidate);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    const prefixMatches = entries.filter((entry) => entry.startsWith(`${basename}`) && entry.endsWith(".onnx"));
    if (prefixMatches.length > 0) {
        return path.join(modelDir, prefixMatches[0]);
    }

    return null;
}

export class SherpaStreamingSTT {
    private recognizer: OnlineRecognizer;
    private stream: OnlineStream | null = null;
    private lastText = "";
    private readonly language: SupportedSpeechLanguage;

    constructor(language: SupportedSpeechLanguage = "en") {
        const initStart = Date.now();
        this.language = language;

        const configuredModel = normalizeModelSelector(process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL ?? REQUESTED_MODEL_NAME);

        console.log(`[Sherpa] Configured model selector: ${configuredModel}`);

        const modelDir = resolveModelDir(language);

        const encoder = findModelFile(modelDir, "encoder") ?? path.join(modelDir, "encoder-epoch-99-avg-1.int8.onnx");
        const decoder = findModelFile(modelDir, "decoder") ?? path.join(modelDir, "decoder-epoch-99-avg-1.int8.onnx");
        const joiner = findModelFile(modelDir, "joiner") ?? path.join(modelDir, "joiner-epoch-99-avg-1.int8.onnx");

        const tokens =
            fs.existsSync(path.join(modelDir, "tokens.txt"))
                ? path.join(modelDir, "tokens.txt")
                : null;

        if (!encoder || !decoder || !joiner || !tokens) {
            throw new Error(
                `[Sherpa] Missing required ONNX files in model directory: ${modelDir}. ` +
                `Expected encoder/decoder/joiner + tokens.txt with a valid Sherpa streaming bundle.`
            );
        }

        console.log("[Sherpa] Language:", language);
        console.log("[Sherpa] Model directory:", modelDir);
        console.log("[Sherpa] Encoder:", encoder);
        console.log("[Sherpa] Decoder:", decoder);
        console.log("[Sherpa] Joiner:", joiner);
        console.log("[Sherpa] Tokens:", tokens);

        this.recognizer = new OnlineRecognizer({
            featConfig: {
                sampleRate: SAMPLE_RATE,
                featureDim: 80,
            },

            modelConfig: {
                transducer: {
                    encoder,
                    decoder,
                    joiner,
                },

                tokens,

                numThreads: 2,

                provider: "cpu",
            },

            decodingMethod: "greedy_search",

            enableEndpoint: true,

            rule1MinTrailingSilence: 2.4,

            rule2MinTrailingSilence: 1.2,

            rule3MinUtteranceLength: 20,
        });

        const initTime = Date.now() - initStart;
        console.log("[Sherpa] Online recognizer initialized");
        console.log(`[Sherpa] Init time: ${initTime}ms | Sample rate: ${SAMPLE_RATE}Hz`);
    }

    start() {
        this.stream = this.recognizer.createStream();
        this.lastText = "";

        console.log("[Sherpa] Streaming session started");
    }

    processAudio(samples: Float32Array): string | null {
        if (!this.stream) {
            this.start();
        }

        if (!this.stream) {
            return null;
        }

        if (samples.length === 0) {
            return null;
        }

        this.stream.acceptWaveform({
            samples,
            sampleRate: SAMPLE_RATE,
        });

        while (this.recognizer.isReady(this.stream)) {
            this.recognizer.decode(this.stream);
        }

        const result = this.recognizer.getResult(this.stream);

        const text = result.text?.trim() || "";

        if (!text) {
            return null;
        }

        let delta = text;

        if (text.startsWith(this.lastText)) {
            delta = text.slice(this.lastText.length).trim();
        }

        this.lastText = text;

        return delta || null;
    }

    finish(): string | null {
        if (!this.stream) {
            return null;
        }

        this.stream.inputFinished();

        while (this.recognizer.isReady(this.stream)) {
            this.recognizer.decode(this.stream);
        }

        const result = this.recognizer.getResult(this.stream);

        const text = result.text?.trim() || "";

        this.stream = null;
        this.lastText = "";

        if (!text) {
            return null;
        }

        console.log("[Sherpa] Final:", text);

        return text;
    }

    reset() {
        this.stream = null;
        this.lastText = "";

        console.log("[Sherpa] Streaming session reset");
    }
}

let sherpaSTT: SherpaStreamingSTT | null = null;

export function initSherpaSTT(language: SupportedSpeechLanguage = "en") {
    if (!sherpaSTT || sherpaSTT["language"] !== language) {
        sherpaSTT = new SherpaStreamingSTT(language);
    }

    return sherpaSTT;
}

export function getSherpaSTT() {
    return sherpaSTT;
}