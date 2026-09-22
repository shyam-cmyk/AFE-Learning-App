import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sherpaOnnx from "sherpa-onnx-node";

const {
    OnlineRecognizer,
    OfflineRecognizer,
} = sherpaOnnx;

type OnlineStream = import("sherpa-onnx-node").OnlineStream;
type OnlineRecognizerType = import("sherpa-onnx-node").OnlineRecognizer;
type OfflineRecognizerType = import("sherpa-onnx-node").OfflineRecognizer;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MODEL_DIR = path.join(
    __dirname,
    "../sherpa-onnx-streaming-zipformer-en-20M-2023-02-17"
);

const MODEL_ROOTS = [
    __dirname,
    path.resolve(__dirname, ".."),
    process.cwd(),
    path.join(process.cwd(), "packages/backend/stt-engine"),
];

const OVERRIDE_MODEL_DIR = process.env.SHERPA_STT_MODEL_DIR
    ? path.resolve(process.env.SHERPA_STT_MODEL_DIR)
    : null;

const REQUESTED_MODEL_NAME =
    (process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL ?? "auto")
        .trim()
        .toLowerCase();

const MODEL_NAME_ALIASES: Record<string, string[]> = {
    english: ["english", "en", "zipformer-en"],
    "indian-english": ["indian-english", "indian english", "indian-en", "zipformer-indian-en"],
    hinglish: ["hinglish", "hi-en", "hindi-english", "hindi english", "zipformer-hi-en"],
    hindi: ["hindi", "hi", "zipformer-hi"],
    marathi: ["marathi", "mr", "zipformer-mr"],
};

export const SUPPORTED_SPEECH_LANGUAGES = [
    "auto",
    "en",
    "hi",
    "hi-en",
    "mr",
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
    mr: "mr",
    marathi: "mr",
    "mr-in": "mr",
};

export function normalizeSpeechLanguage(
    language?: string | null
): SupportedSpeechLanguage {
    if (!language) {
        return "auto";
    }

    const normalized = language.trim().toLowerCase();
    const compact = normalized
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (
        compact.includes("auto") ||
        compact.includes("multilingual") ||
        compact.includes("mixed") ||
        compact.includes("any language") ||
        compact.includes("all languages")
    ) {
        return "auto";
    }

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

    if (compact.includes("marathi") || compact === "mr") {
        return "mr";
    }

    if (compact.includes("hindi") || compact === "hi") {
        return "hi";
    }

    if (compact.includes("english") || compact.includes("eng")) {
        return "en";
    }

    return LANGUAGE_ALIASES[normalized] ?? LANGUAGE_ALIASES[compact] ?? "auto";
}

const SAMPLE_RATE = 16000;

function normalizeModelSelector(rawName?: string): string {
    const value = (rawName ?? REQUESTED_MODEL_NAME ?? "auto")
        .trim()
        .toLowerCase();

    if (!value) {
        return "auto";
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

export function resolveModelCandidates(
    languageOrSelector?: SupportedSpeechLanguage | string | null
): string[] {
    const rawValue = (languageOrSelector ?? process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL ?? "auto")
        .trim()
        .toLowerCase();

    const selector = normalizeModelSelector(rawValue);
    const language = normalizeSpeechLanguage(languageOrSelector ?? selector);

    const orderedNames: string[] = [];
    const pushUnique = (name: string | null | undefined) => {
        if (!name) {
            return;
        }

        const cleaned = name.trim().toLowerCase();
        if (cleaned && !orderedNames.includes(cleaned)) {
            orderedNames.push(cleaned);
        }
    };

    const preferenceOrder = (() => {
        if (selector === "english") {
            // Keep the app English-only, but prefer the Indian-English runtime
            // for local Indian-accented spoken English. This improves accuracy
            // for phrases like "what is cloud computing" without reintroducing
            // non-English language selection.
            return ["sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (selector === "indian-english") {
            return ["sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (selector === "hinglish") {
            return ["sherpa-onnx-indic-conformer", "sherpa-onnx-streaming-zipformer-hi-en", "sherpa-onnx-streaming-zipformer-hi", "sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (selector === "hindi") {
            return ["sherpa-onnx-indic-conformer", "sherpa-onnx-streaming-zipformer-hi", "sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (selector === "marathi" || language === "mr") {
            return ["sherpa-onnx-indic-conformer", "sherpa-onnx-streaming-zipformer-mr", "sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (language === "en") {
            // English-only sessions should still use the English model tuned for
            // Indian English pronunciation, while staying within the English scope.
            return ["sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (language === "hi-en") {
            return ["sherpa-onnx-indic-conformer", "sherpa-onnx-streaming-zipformer-hi-en", "sherpa-onnx-streaming-zipformer-hi", "sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (language === "hi") {
            return ["sherpa-onnx-streaming-zipformer-hi", "sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        if (selector === "auto" || language === "auto") {
            return ["sherpa-onnx-indic-conformer", "sherpa-onnx-streaming-zipformer-hi-en", "sherpa-onnx-streaming-zipformer-hi", "sherpa-onnx-streaming-zipformer-indian-en", "sherpa-onnx-streaming-zipformer-en"];
        }

        return ["sherpa-onnx-streaming-zipformer-en"];
    })();

    for (const candidate of preferenceOrder) {
        pushUnique(candidate);
    }

    if (selector !== "auto" && selector !== "english" && selector !== "indian-english" && selector !== "hinglish" && selector !== "hindi" && selector !== "marathi") {
        pushUnique(selector);
    }

    if (orderedNames.length === 0) {
        pushUnique("sherpa-onnx-streaming-zipformer-en");
    }

    return orderedNames;
}

function findMatchingModelDirs(prefixes: string[]): string[] {
    const results: string[] = [];

    for (const root of MODEL_ROOTS) {
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

function hasCompatibleOnlineModel(modelDir: string): boolean {
    if (!modelDir || !fs.existsSync(modelDir)) {
        return false;
    }

    const tokensPath = path.join(modelDir, "tokens.txt");
    if (!fs.existsSync(tokensPath)) {
        return false;
    }

    const singleModelCandidates = [
        "model.onnx",
        "model.int8.onnx",
        "zipformer2.onnx",
        "zipformer2.int8.onnx",
    ];

    const hasSingleModel = singleModelCandidates.some((file) =>
        fs.existsSync(path.join(modelDir, file))
    );

    const encoderFiles = [
        "encoder.onnx",
        "encoder.int8.onnx",
        "encoder-epoch-99-avg-1.int8.onnx",
        "encoder-epoch-10-avg-5-chunk-64-left-256.int8.onnx",
    ];

    const decoderFiles = [
        "decoder.onnx",
        "decoder.int8.onnx",
        "decoder-epoch-99-avg-1.int8.onnx",
        "decoder-epoch-10-avg-5-chunk-64-left-256.int8.onnx",
    ];

    const joinerFiles = [
        "joiner.onnx",
        "joiner.int8.onnx",
        "joiner-epoch-99-avg-1.int8.onnx",
        "joiner-epoch-10-avg-5-chunk-64-left-256.int8.onnx",
    ];

    const hasEncoder = encoderFiles.some((file) => fs.existsSync(path.join(modelDir, file)));
    const hasDecoder = decoderFiles.some((file) => fs.existsSync(path.join(modelDir, file)));
    const hasJoiner = joinerFiles.some((file) => fs.existsSync(path.join(modelDir, file)));

    // Online Paraformer requires a Sherpa-compatible single model file. An
    // arbitrary encoder/decoder pair is not sufficient and can abort native
    // initialization, so only accept complete transducer bundles here.
    return hasSingleModel || (hasEncoder && hasDecoder && hasJoiner);
}

function resolveModelDir(language: SupportedSpeechLanguage): string {
    const configuredModel = normalizeModelSelector(process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL);
    const candidateNames = resolveModelCandidates(language);

    if (OVERRIDE_MODEL_DIR) {
        const overrideName = path.basename(OVERRIDE_MODEL_DIR);
        if (overrideName) {
            candidateNames.unshift(overrideName);
        }
    }

    const candidateDirs: string[] = [];

    if (OVERRIDE_MODEL_DIR) {
        candidateDirs.push(OVERRIDE_MODEL_DIR);
    }

    for (const candidate of candidateNames) {
        candidateDirs.push(
            path.join(__dirname, `./${candidate}`),
            path.join(__dirname, `../${candidate}`),
            path.join(process.cwd(), `./${candidate}`),
            path.join(process.cwd(), `packages/backend/stt-engine/${candidate}`),
            ...findMatchingModelDirs([candidate])
        );
    }

    if (configuredModel === "english" || configuredModel === "indian-english" || configuredModel === "hinglish" || configuredModel === "hindi") {
        const configuredModelDir = path.join(__dirname, `../${normalizeModelSelector(configuredModel)}`);
        candidateDirs.push(configuredModelDir);
    }

    const seen = new Set<string>();
    let foundDir: string | null = null;

    for (const candidateDir of candidateDirs) {
        if (!candidateDir || seen.has(candidateDir)) {
            continue;
        }
        seen.add(candidateDir);

        if (hasCompatibleOnlineModel(candidateDir)) {
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

function findSingleModelFile(modelDir: string): string | null {
    for (const filename of ["model.int8.onnx", "model.onnx", "zipformer2.int8.onnx", "zipformer2.onnx"]) {
        const filePath = path.join(modelDir, filename);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    return null;
}

export class SherpaStreamingSTT {
    private recognizer: OnlineRecognizerType | OfflineRecognizerType;
    private stream: OnlineStream | null = null;
    private offlineSamples: number[] = [];
    private offlineMode = false;
    private lastText = "";
    private readonly language: SupportedSpeechLanguage;
    private sessionStartedAt: number | null = null;
    private firstPartialAt: number | null = null;
    private finalAt: number | null = null;

    constructor(language: SupportedSpeechLanguage = "en") {
        const initStart = Date.now();
        this.language = language;

        const configuredModel = normalizeModelSelector(process.env.STT_MODEL ?? process.env.SHERPA_STT_MODEL ?? REQUESTED_MODEL_NAME);

        console.log(`[Sherpa] Configured model selector: ${configuredModel}`);

        let modelDir = resolveModelDir(language);
        if (!hasCompatibleOnlineModel(modelDir)) {
            modelDir = DEFAULT_MODEL_DIR;
            console.warn(`[Sherpa] Selected model bundle is not compatible with the online recognizer. Falling back to English bundle: ${modelDir}`);
        }

        const encoder = findModelFile(modelDir, "encoder") ?? path.join(modelDir, "encoder-epoch-99-avg-1.int8.onnx");
        const decoder = findModelFile(modelDir, "decoder") ?? path.join(modelDir, "decoder-epoch-99-avg-1.int8.onnx");
        const joiner = findModelFile(modelDir, "joiner");
        const singleModel = findSingleModelFile(modelDir);

        const tokens =
            fs.existsSync(path.join(modelDir, "tokens.txt"))
                ? path.join(modelDir, "tokens.txt")
                : null;

        const hasEncoder = fs.existsSync(encoder);
        const hasDecoder = fs.existsSync(decoder);
        const hasTransducer = !!joiner && fs.existsSync(joiner);
        const hasSingleTransducer = !!singleModel;
        if (!tokens) {
            throw new Error(
                `[Sherpa] Missing tokens.txt in model directory: ${modelDir}. ` +
                `Expected tokens.txt with a valid Sherpa model bundle.`
            );
        }

        if (!hasSingleTransducer && (!hasEncoder || !hasDecoder)) {
            throw new Error(
                `[Sherpa] Missing encoder/decoder files in model directory: ${modelDir}. ` +
                `Expected encoder.onnx/encoder.int8.onnx and decoder.onnx/decoder.int8.onnx.`
            );
        }

        console.log("[Sherpa] Language:", language);
        console.log("[Sherpa] Model directory:", modelDir);
        this.offlineMode = hasSingleTransducer;
        console.log("[Sherpa] Model type:", hasSingleTransducer ? "IndicConformer CTC (offline decode)" : hasTransducer ? "transducer" : "unsupported");
        if (singleModel) console.log("[Sherpa] Model:", singleModel);
        console.log("[Sherpa] Encoder:", encoder);
        console.log("[Sherpa] Decoder:", decoder);
        if (joiner) console.log("[Sherpa] Joiner:", joiner);
        console.log("[Sherpa] Tokens:", tokens);

        // Match Sherpa-ONNX config schema for the actual model architecture.
        const modelConfig: any = {
            tokens,
            numThreads: 2,
            provider: "cpu",
        };

        if (hasSingleTransducer && singleModel) {
            modelConfig.nemoCtc = {
                model: singleModel,
            };
        } else if (hasTransducer && joiner) {
            modelConfig.transducer = {
                encoder,
                decoder,
                joiner,
            };
        } else {
            throw new Error(
                `[Sherpa] Unsupported online model layout in ${modelDir}. ` +
                `Expected a transducer model with encoder.onnx, decoder.onnx, joiner.onnx, and tokens.txt.`
            );
        }

        if (this.offlineMode && singleModel) {
            this.recognizer = new OfflineRecognizer({
                featConfig: {
                    sampleRate: SAMPLE_RATE,
                    featureDim: 80,
                },
                modelConfig,
            });
        } else {
            this.recognizer = new OnlineRecognizer({
                featConfig: {
                    sampleRate: SAMPLE_RATE,
                    featureDim: 80,
                },

                modelConfig,

                decodingMethod: "greedy_search",

                enableEndpoint: true,

                rule1MinTrailingSilence: 2.4,

                rule2MinTrailingSilence: 1.2,

                rule3MinUtteranceLength: 20,
            });
        }

        const initTime = Date.now() - initStart;
        console.log(`[Sherpa] ${this.offlineMode ? "Offline" : "Online"} recognizer initialized`);
        console.log(`[Sherpa] Init time: ${initTime}ms | Sample rate: ${SAMPLE_RATE}Hz`);
    }

    start() {
        this.sessionStartedAt = performance.now();
        this.firstPartialAt = null;
        this.finalAt = null;

        if (this.offlineMode) {
            this.offlineSamples = [];
            this.lastText = "";
            console.log("[Sherpa] Hindi/Marathi recording started");
            return;
        }

        const recognizer = this.recognizer as OnlineRecognizerType;
        this.stream = recognizer.createStream();
        this.lastText = "";

        console.log("[Sherpa] Streaming session started");
    }

    processAudio(samples: Float32Array): string | null {
        if (this.offlineMode) {
            if (samples.length > 0) {
                this.offlineSamples.push(...samples);
            }
            return null;
        }

        const recognizer = this.recognizer as OnlineRecognizerType;
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

        while (recognizer.isReady(this.stream)) {
            recognizer.decode(this.stream);
        }

        const result = recognizer.getResult(this.stream);

        const text = result.text?.trim() || "";

        if (!text) {
            return null;
        }

        let delta = text;

        if (text.startsWith(this.lastText)) {
            delta = text.slice(this.lastText.length).trim();
        }

        this.lastText = text;

        if (this.firstPartialAt === null && this.sessionStartedAt !== null && delta) {
            this.firstPartialAt = performance.now();
            const ttft = Math.round(this.firstPartialAt - this.sessionStartedAt);
            console.log(`[STT] TTFT: ${ttft} ms`);
        }

        return delta || null;
    }

    finish(): string | null {
        if (this.offlineMode) {
            if (this.offlineSamples.length === 0) {
                return null;
            }

            const hasSpeech = this.offlineSamples.some((sample) => Math.abs(sample) >= 0.01);
            if (!hasSpeech) {
                this.offlineSamples = [];
                this.lastText = "";
                return null;
            }

            const recognizer = this.recognizer as OfflineRecognizerType;
            const stream = recognizer.createStream();
            stream.acceptWaveform({
                samples: Float32Array.from(this.offlineSamples),
                sampleRate: SAMPLE_RATE,
            });
            recognizer.decode(stream);
            const text = recognizer.getResult(stream).text?.trim() || "";

            this.offlineSamples = [];
            this.lastText = "";

            if (text) {
                console.log("[Sherpa] Final Hindi/Marathi:", text);
            }

            return text || null;
        }

        const recognizer = this.recognizer as OnlineRecognizerType;
        if (!this.stream) {
            return null;
        }

        this.stream.inputFinished();

        while (recognizer.isReady(this.stream)) {
            recognizer.decode(this.stream);
        }

        const result = recognizer.getResult(this.stream);

        const text = result.text?.trim() || "";

        this.stream = null;
        this.lastText = "";
        this.finalAt = performance.now();

        if (this.sessionStartedAt !== null && text) {
            const finalLatency = Math.round(this.finalAt - this.sessionStartedAt);
            console.log(`[STT] Final transcript latency: ${finalLatency} ms`);
        }

        if (!text) {
            return null;
        }

        console.log("[Sherpa] Final:", text);

        return text;
    }

    reset() {
        this.stream = null;
        this.offlineSamples = [];
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