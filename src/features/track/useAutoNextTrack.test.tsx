import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { autoNextStorageKey, useAutoNextTrack } from "./useAutoNextTrack";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("defaults off, persists locally and advances only when enabled", () => {
  const advance = vi.fn();
  const sequence = { advance, autoPlayRequested: false, nextTrackId: "next", queueLabel: "練習", consumeAutoPlay: vi.fn() };
  const hook = renderHook(() => useAutoNextTrack(sequence));
  act(() => hook.result.current.onPlaybackEnded());
  expect(advance).not.toHaveBeenCalled();
  act(() => hook.result.current.setEnabled(true));
  expect(localStorage.getItem(autoNextStorageKey)).toBe("true");
  act(() => hook.result.current.onPlaybackEnded());
  expect(advance).toHaveBeenCalledOnce();
  hook.unmount();
  const restored = renderHook(() => useAutoNextTrack(sequence));
  expect(restored.result.current.enabled).toBe(true);
  act(() => restored.result.current.setEnabled(false));
  act(() => restored.result.current.onPlaybackEnded());
  expect(advance).toHaveBeenCalledOnce();
});

it("remains usable when local storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const { result } = renderHook(() => useAutoNextTrack());
  expect(result.current.enabled).toBe(false);
  act(() => result.current.setEnabled(true));
  expect(result.current.enabled).toBe(true);
  expect(() => result.current.onPlaybackEnded()).not.toThrow();
});
