import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../../lib/beats";
import { useClickTrack } from "./useClickTrack";

const beatGrid: BeatGrid = {
  analyzedAt: "2026-07-20T00:00:00.000Z",
  beats: [{ isDownbeat: true, position: 1, time: 0.5 }],
  beatsPerBar: [4], downbeats: [0.5], source: "madmom"
};

function setup() {
  const resume = vi.fn(async (): Promise<void> => undefined);
  const close = vi.fn();
  const audioContext = { resume, close } as unknown as AudioContext;
  const setEnabled = vi.fn();
  const props = { audioContext, beatGrid: beatGrid as BeatGrid | null, hasCueTransport: true, setEnabled };
  return { ...renderHook(useClickTrack, { initialProps: props }), props, resume, close, setEnabled };
}

describe("useClickTrack preference", () => {
  it("controls the shared processor immediately across rapid toggles and releases its preference on unmount", () => {
    const hook = setup();
    expect(hook.result.current.isClickAvailable).toBe(true);
    act(() => {
      hook.result.current.toggleClickTrack();
      hook.result.current.toggleClickTrack();
      hook.result.current.toggleClickTrack();
    });
    expect(hook.result.current.isClickEnabled).toBe(true);
    expect(hook.setEnabled.mock.calls.map(([value]) => value)).toEqual([false, true, false, true]);
    expect(hook.resume).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(hook.setEnabled).toHaveBeenLastCalledWith(false);
    expect(hook.close).not.toHaveBeenCalled();
  });

  it("does not enable a click until the matching cue transport is available", () => {
    const hook = setup();
    hook.rerender({ ...hook.props, hasCueTransport: false });
    act(() => hook.result.current.toggleClickTrack());
    expect(hook.result.current.isClickEnabled).toBe(false);
    expect(hook.resume).not.toHaveBeenCalled();
  });

  it("turns off the old grid on reanalysis and refuses an empty grid", () => {
    const hook = setup();
    act(() => hook.result.current.toggleClickTrack());
    hook.rerender({ ...hook.props, beatGrid: null });
    expect(hook.result.current.isClickEnabled).toBe(false);
    expect(hook.setEnabled).toHaveBeenLastCalledWith(false);
    hook.rerender({ ...hook.props, beatGrid: { ...beatGrid, beats: [] } });
    expect(hook.result.current.isClickAvailable).toBe(false);
    act(() => hook.result.current.toggleClickTrack());
    expect(hook.result.current.isClickEnabled).toBe(false);
  });

  it("silences clicks when a playing source no longer matches the verified cue transport", () => {
    const hook = setup();
    act(() => hook.result.current.toggleClickTrack());
    expect(hook.result.current.isClickEnabled).toBe(true);
    hook.rerender({ ...hook.props, hasCueTransport: false });
    expect(hook.result.current.isClickAvailable).toBe(false);
    expect(hook.result.current.isClickEnabled).toBe(false);
    expect(hook.setEnabled).toHaveBeenLastCalledWith(false);
    hook.rerender(hook.props);
    expect(hook.result.current.isClickAvailable).toBe(true);
    expect(hook.result.current.isClickEnabled).toBe(false);
  });

  it("turns off and reports a failed trusted resume", async () => {
    const hook = setup();
    hook.resume.mockRejectedValueOnce(new Error("resume failed"));
    await act(async () => hook.result.current.toggleClickTrack());
    expect(hook.result.current.isClickEnabled).toBe(false);
    expect(hook.setEnabled).toHaveBeenLastCalledWith(false);
    expect(hook.result.current.clickErrorMessage).toContain("開始できません");
  });

  it("does not let an older failed resume cancel a later successful toggle", async () => {
    const hook = setup();
    let reject = (_error: Error) => {};
    hook.resume.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }));
    act(() => {
      hook.result.current.toggleClickTrack();
      hook.result.current.toggleClickTrack();
      hook.result.current.toggleClickTrack();
    });
    await act(async () => reject(new Error("old resume failed")));
    expect(hook.result.current.isClickEnabled).toBe(true);
    expect(hook.result.current.clickErrorMessage).toBeNull();
  });
  it("ignores an old context's resume rejection after graph replacement", async () => {
    const hook = setup();
    let reject = (_error: Error) => {};
    hook.resume.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }));
    act(() => hook.result.current.toggleClickTrack());
    hook.rerender({ ...hook.props, audioContext: { resume: vi.fn(async () => undefined) } as unknown as AudioContext });
    await act(async () => reject(new Error("disposed context")));
    expect(hook.result.current.isClickEnabled).toBe(true);
    expect(hook.result.current.clickErrorMessage).toBeNull();
  });

});
