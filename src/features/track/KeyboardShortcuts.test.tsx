import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import type { MarkersState } from "./useMarkersState";
import type { PlaybackState } from "./usePlaybackState";

afterEach(cleanup);

function setup() {
  const togglePlayback = vi.fn();
  const onControlKeyDown = vi.fn();
  const onControlClick = vi.fn();
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
      <button type="button" onKeyDown={onControlKeyDown} onClick={onControlClick}>Mute guitar</button>
      <a href="#download" onKeyDown={onControlKeyDown}>Download</a>
      <input type="checkbox" aria-label="Auto next" onClick={onControlClick} />
      <input aria-label="Marker label" onKeyDown={onControlKeyDown} />
    </>
  );
  return { togglePlayback, onControlKeyDown, onControlClick, playback, markers };
}

describe("KeyboardShortcuts", () => {


  it.each(["Enter", " "])("prioritizes %j playback over focused button activation", (key) => {
    const { togglePlayback, onControlKeyDown } = setup();
    const button = screen.getByRole("button", { name: "Mute guitar" });
    button.focus();

    expect(fireEvent.keyDown(button, { key })).toBe(false);
    expect(onControlKeyDown).not.toHaveBeenCalled();
    expect(togglePlayback).toHaveBeenCalledOnce();
  });

  it("prioritizes Enter playback over a focused download link", () => {
    const { togglePlayback, onControlKeyDown } = setup();
    const link = screen.getByRole("link", { name: "Download" });
    link.focus();
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(onControlKeyDown).not.toHaveBeenCalled();
    expect(togglePlayback).toHaveBeenCalledOnce();
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

it("handles seek, rate and marker shortcuts with a focused button", () => {
  const { playback, markers, onControlKeyDown } = setup();
  const button = screen.getByRole("button", { name: "Mute guitar" });
  for (const [key, delta] of [["ArrowLeft", -5], ["ArrowRight", 5], ["j", -10], ["l", 10]] as const) {
    fireEvent.keyDown(button, { key });
    expect(playback.seekBySeconds).toHaveBeenLastCalledWith(delta);
  }
  fireEvent.keyDown(button, { key: ">", shiftKey: true });
  expect(playback.changePlaybackRate).toHaveBeenCalledWith("faster");
  fireEvent.keyDown(button, { key: "m" });
  expect(markers.addMarkerAt).toHaveBeenCalledWith(1, 10);
  expect(onControlKeyDown).not.toHaveBeenCalled();
});

it("cancels repeated playback keys without repeatedly toggling", () => {
  const { togglePlayback } = setup();
  const button = screen.getByRole("button", { name: "Mute guitar" });
  expect(fireEvent.keyDown(button, { key: " ", repeat: true })).toBe(false);
  expect(togglePlayback).not.toHaveBeenCalled();
});

it("activates focused controls with Alt+Enter without toggling playback", () => {
  const { togglePlayback, onControlClick } = setup();
  const button = screen.getByRole("button", { name: "Mute guitar" });
  fireEvent.keyDown(button, { key: "Enter", altKey: true });
  expect(onControlClick).toHaveBeenCalledOnce();
  expect(togglePlayback).not.toHaveBeenCalled();
});

it("prioritizes Space on a checkbox and keeps Alt+Enter available for changing it", () => {
  const { togglePlayback, onControlClick } = setup();
  const checkbox = screen.getByRole("checkbox", { name: "Auto next" });
  expect(fireEvent.keyDown(checkbox, { key: " " })).toBe(false);
  expect(togglePlayback).toHaveBeenCalledOnce();
  expect(onControlClick).not.toHaveBeenCalled();
  fireEvent.keyDown(checkbox, { key: "Enter", altKey: true });
  expect(checkbox).toBeChecked();
});
