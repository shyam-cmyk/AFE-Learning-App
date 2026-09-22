declare module "sherpa-onnx-node" {
    export interface Waveform {
        samples: Float32Array;
        sampleRate: number;
    }

    export interface OnlineRecognizerConfig {
        featConfig?: {
            sampleRate?: number;
            featureDim?: number;
        };

        modelConfig?: {
            transducer?: {
                encoder?: string;
                decoder?: string;
                joiner?: string;
            };
            paraformer?: {
                encoder?: string;
                decoder?: string;
            };
            zipformer2Ctc?: {
                model?: string;
            };
            nemoCtc?: {
                model?: string;
            };
            toneCtc?: {
                model?: string;
            };
            tokens?: string;
            numThreads?: number;
            provider?: string;
            debug?: number | boolean;
        };

        decodingMethod?: string;
        enableEndpoint?: boolean;
        rule1MinTrailingSilence?: number;
        rule2MinTrailingSilence?: number;
        rule3MinUtteranceLength?: number;
    }

    export interface OnlineRecognizerResult {
        text: string;
    }

    export interface OfflineRecognizerConfig {
        featConfig?: {
            sampleRate?: number;
            featureDim?: number;
        };
        modelConfig?: {
            nemoCtc?: {
                model?: string;
            };
            tokens?: string;
            numThreads?: number;
            provider?: string;
        };
    }

    export interface OfflineRecognizerResult {
        text: string;
    }

    export class OfflineStream {
        acceptWaveform(obj: Waveform): void;
    }

    export class OfflineRecognizer {
        constructor(config: OfflineRecognizerConfig);
        createStream(): OfflineStream;
        decode(stream: OfflineStream): void;
        getResult(stream: OfflineStream): OfflineRecognizerResult;
    }

    export class OnlineStream {
        acceptWaveform(obj: Waveform): void;
        inputFinished(): void;
    }

    export class OnlineRecognizer {
        constructor(config: OnlineRecognizerConfig);
        createStream(): OnlineStream;
        isReady(stream: OnlineStream): boolean;
        decode(stream: OnlineStream): void;
        isEndpoint(stream: OnlineStream): boolean;
        reset(stream: OnlineStream): void;
        getResult(stream: OnlineStream): OnlineRecognizerResult;
    }
}
