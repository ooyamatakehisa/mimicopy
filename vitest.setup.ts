import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("tone/build/esm/core/context/Context.js", () => ({
  Context: class ContextMock {
    rawContext: AudioContext;

    constructor({ context }: { context: AudioContext }) {
      this.rawContext = context;
    }

    initialize() {
      return this;
    }
  }
}));

vi.mock("tone/build/esm/source/buffer/GrainPlayer.js", () => ({
  GrainPlayer: class GrainPlayerMock {
    detune: number;
    playbackRate: number;
    connect = vi.fn();
    dispose = vi.fn();
    start = vi.fn();
    stop = vi.fn();

    constructor({
      detune,
      playbackRate
    }: {
      detune: number;
      playbackRate: number;
    }) {
      this.detune = detune;
      this.playbackRate = playbackRate;
    }
  }
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const audioBuffer = {
  duration: 10,
  getChannelData: () => new Float32Array([-1, -0.5, 0.25, 1]),
  length: 4,
  numberOfChannels: 1
};

class AudioContextMock {
  currentTime = 0;
  destination = {};
  sampleRate = 44_100;
  state = "running";
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      exponentialRampToValueAtTime: vi.fn(),
      setValueAtTime: vi.fn(),
      value: 1
    }
  }));
  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  }));
  createOscillator = vi.fn(() => ({
    connect: vi.fn(),
    frequency: { value: 0 },
    start: vi.fn(),
    stop: vi.fn(),
    type: "sine"
  }));
  decodeAudioData = vi.fn(() => Promise.resolve(audioBuffer));
  close = vi.fn(() => Promise.resolve(undefined));
  resume = vi.fn(() => Promise.resolve(undefined));
}

const canvasContext = {
  clearRect: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fillRect: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: ""
};

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock
});

Object.defineProperty(globalThis, "AudioContext", {
  configurable: true,
  value: AudioContextMock
});

Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: vi.fn(() => "blob:mock-audio")
});

Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn()
});

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => canvasContext)
  });
}

if (typeof HTMLElement !== "undefined") {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: vi.fn(() => true)
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn()
    },
    setPointerCapture: {
      configurable: true,
      value: vi.fn()
    }
  });
}
