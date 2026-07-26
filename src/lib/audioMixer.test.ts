import {
  createMixerGainNodes,
  disconnectMixerGainNodes,
  setMixerGainVolumes
} from "./audioMixer";

function createAudioContextStub() {
  const createdGains: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>;
    };
  }> = [];
  const audioContext = {
    createGain: vi.fn(() => {
      const gain = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn()
        }
      };

      createdGains.push(gain);

      return gain;
    }),
    currentTime: 12,
    destination: {}
  } as unknown as AudioContext;

  return { audioContext, createdGains };
}

describe("audio mixer graph", () => {
  it("connects one native gain per channel and applies effective volumes", () => {
    const { audioContext, createdGains } = createAudioContextStub();
    const gains = createMixerGainNodes(audioContext);

    setMixerGainVolumes({
      audioContext,
      gains,
      volumes: {
        original: 0.35,
        remainder: 0,
        stem: 1
      }
    });

    expect(createdGains).toHaveLength(3);
    for (const gain of createdGains) {
      expect(gain.connect).toHaveBeenCalledWith(audioContext.destination);
    }
    expect(gains.original.gain.setValueAtTime).toHaveBeenCalledWith(0.35, 12);
    expect(gains.stem.gain.setValueAtTime).toHaveBeenCalledWith(1, 12);
    expect(gains.remainder.gain.setValueAtTime).toHaveBeenCalledWith(0, 12);

    disconnectMixerGainNodes(gains);
    for (const gain of createdGains) {
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
    }
  });
});
