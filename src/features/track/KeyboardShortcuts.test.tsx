import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import type { MarkersState } from "./useMarkersState";
import type { PlaybackState } from "./usePlaybackState";

function setup() {
  const togglePlayback = vi.fn();
  const onControlKeyDown = vi.fn();
  const playback = {
    currentTime: 1,
    duration: 10,
    togglePlayback,
    seekBySeconds: vi.fn(),
    changePlaybackRate: vi.fn()
  } as unknown as PlaybackState;
  const markers = {
    sortedMarkers: [],
    selectedMarkerId: null,
    selectMarker: vi.fn(),
    addMarkerAt: vi.fn()
  } as unknown as MarkersState;
  render(
    <>
      <KeyboardShortcuts playback={playback} markers={markers} />
      <button type="button" onKeyDown={onControlKeyDown}>Mute guitar</button>
      <a href="#download" onKeyDown={onControlKeyDown}>Download</a>
      <input aria-label="Marker label" onKeyDown={onControlKeyDown} />
    </>
  );
  return { togglePlayback, onControlKeyDown };
}

describe("KeyboardShortcuts", () => {
  afterEach(cleanup);

  it.each(["Enter", " "])("preserves native %j activation on a focused button", (key) => {
    const { togglePlayback, onControlKeyDown } = setup();
    const button = screen.getByRole("button", { name: "Mute guitar" });
    button.focus();

    // JSDOM does not perform the browser's default keyboard click. Verify that
    // its prerequisite event remains uncancelled and reaches the control.
    expect(fireEvent.keyDown(button, { key })).toBe(true);
    expect(onControlKeyDown).toHaveBeenCalledOnce();
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("preserves Enter activation of a download link", () => {
    const { togglePlayback, onControlKeyDown } = setup();
    const link = screen.getByRole("link", { name: "Download" });
    link.focus();
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
    expect(onControlKeyDown).toHaveBeenCalledOnce();
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it.each(["Enter", " ", "k"])("keeps %j playback shortcuts on the page", (key) => {
    const { togglePlayback } = setup();
    expect(fireEvent.keyDown(document.body, { key })).toBe(false);
    expect(togglePlayback).toHaveBeenCalledOnce();
  });

  it("keeps K as a playback shortcut when a button has focus", () => {
    const { togglePlayback, onControlKeyDown } = setup();
    const button = screen.getByRole("button", { name: "Mute guitar" });
    button.focus();
    expect(fireEvent.keyDown(button, { key: "k" })).toBe(false);
    expect(togglePlayback).toHaveBeenCalledOnce();
    expect(onControlKeyDown).not.toHaveBeenCalled();
  });

  it.each(["Enter", " ", "k"])("does not handle %j typed into an input", (key) => {
    const { togglePlayback, onControlKeyDown } = setup();
    const input = screen.getByRole("textbox", { name: "Marker label" });
    input.focus();
    expect(fireEvent.keyDown(input, { key })).toBe(true);
    expect(onControlKeyDown).toHaveBeenCalledOnce();
    expect(togglePlayback).not.toHaveBeenCalled();
  });
});
