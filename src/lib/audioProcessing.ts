/** Controls for the processing graph attached to one native media transport. */
export type AudioProcessingControl = {
  element: HTMLMediaElement;
  /** Delay from native source samples to processed output, in wall-clock seconds. */
  latencySeconds: number;
  /** Close the final output gate immediately; safe after disposal. */
  silence(): void;
  /** Reset buffered audio and apply the latest playback-rate/pitch settings. */
  prepare(): Promise<void>;
  /** Only the current transport operation may reopen the final output gate. */
  open(): void;
};
