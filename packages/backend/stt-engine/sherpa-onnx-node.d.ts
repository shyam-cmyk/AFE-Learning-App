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

            tokens?: string;
            numThreads?: number;
            provider?: string;
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
