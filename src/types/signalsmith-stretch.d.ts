declare module "signalsmith-stretch" {
  export type StretchNode = AudioWorkletNode & {
    configure(options: { blockMs: number; intervalMs: number; splitComputation: boolean }): Promise<void>;
    schedule(options: {
      active: boolean;
      semitones: number;
      tonalityHz: number;
      formantCompensation: boolean;
    }): Promise<unknown>;
    latency(): Promise<number>;
  };
  const createStretch: {
    (context: AudioContext, options: AudioWorkletNodeOptions): Promise<StretchNode>;
    moduleUrl?: string;
  };
  export default createStretch;
}
