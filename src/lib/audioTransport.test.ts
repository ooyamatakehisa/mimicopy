import {
  getContextTimeForMediaTime,
  getTransportMediaTime,
  startSynchronizedAudioPlayers,
  type TransportAnchor
} from "./audioTransport";

describe("audio transport helpers", () => {
  const anchor: TransportAnchor = {
    contextTime: 10,
    mediaTime: 4,
    playbackRate: 0.5
  };

  it("derives media time from the shared audio clock", () => {
    expect(
      getTransportMediaTime({
        anchor,
        contextTime: 14,
        duration: 20
      })
    ).toBe(6);
  });

  it("does not move before the scheduled start and clamps at duration", () => {
    expect(
      getTransportMediaTime({
        anchor,
        contextTime: 9,
        duration: 20
      })
    ).toBe(4);
    expect(
      getTransportMediaTime({
        anchor,
        contextTime: 100,
        duration: 20
      })
    ).toBe(20);
  });

  it("maps track times back onto the same audio clock", () => {
    expect(getContextTimeForMediaTime(anchor, 6)).toBe(14);
    expect(getContextTimeForMediaTime(null, 6)).toBeNull();
  });

  it("starts every decoded track on the exact same context frame", () => {
    const players = [
      { start: vi.fn() },
      { start: vi.fn() },
      { start: vi.fn() }
    ];

    startSynchronizedAudioPlayers(players, 12.03, 4.5);

    for (const player of players) {
      expect(player.start).toHaveBeenCalledWith(12.03, 4.5);
    }
  });
});
