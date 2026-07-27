import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
  createMediaElementSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn()
  }));
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    gain: {
      exponentialRampToValueAtTime: vi.fn(),
      setValueAtTime: vi.fn()
    }
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
