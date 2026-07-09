import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the editor shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Mimicopy" })).toBeVisible();
    expect(screen.getByText("0:00 / 0:00")).toBeVisible();
    expect(screen.getByPlaceholderText("https://www.youtube.com/watch?v=...")).toBeVisible();
  });

  it("changes playback speed with keyboard shortcuts while a button is focused", () => {
    render(<App />);
    const speedControls = screen.getByLabelText("Playback speed");
    const speedDownButton = screen.getByTitle("速度を下げる");

    speedDownButton.focus();

    fireEvent.keyDown(speedDownButton, { key: ",", shiftKey: true });
    expect(screen.getByText("0.75x")).toBeVisible();

    fireEvent.keyDown(speedDownButton, { key: ".", shiftKey: true });
    expect(within(speedControls).getByText("1x")).toBeVisible();
  });

  it("toggles playback with keyboard shortcuts while a button is focused", async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const { container } = render(<App />);
    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    const audio = container.querySelector<HTMLAudioElement>("audio");
    const file = new File([new Uint8Array([1, 2, 3])], "phrase.mp3", {
      type: "audio/mpeg"
    });

    try {
      expect(fileInput).not.toBeNull();
      expect(audio).not.toBeNull();
      fireEvent.change(fileInput as HTMLInputElement, {
        target: { files: [file] }
      });

      await waitFor(() => {
        expect(screen.getByText("phrase.mp3 を読み込みました。")).toBeVisible();
      });

      const speedDownButton = screen.getByTitle("速度を下げる");

      speedDownButton.focus();
      fireEvent.keyDown(speedDownButton, { key: " " });
      expect(playSpy).toHaveBeenCalledTimes(1);

      Object.defineProperty(audio as HTMLAudioElement, "paused", {
        configurable: true,
        value: false
      });

      fireEvent.keyDown(speedDownButton, { key: "k" });
      expect(pauseSpy).toHaveBeenCalledTimes(1);
    } finally {
      playSpy.mockRestore();
      pauseSpy.mockRestore();
    }
  });

  it("changes waveform zoom with the zoom controls", () => {
    render(<App />);
    const zoomControls = screen.getByLabelText("Waveform zoom");

    expect(within(zoomControls).getByText("1x")).toBeVisible();

    fireEvent.click(screen.getByTitle("波形を拡大"));
    expect(within(zoomControls).getByText("2x")).toBeVisible();

    fireEvent.click(screen.getByTitle("波形を縮小"));
    expect(within(zoomControls).getByText("1x")).toBeVisible();
  });

  it("loads an mp3 and adds a marker from an arbitrary time", async () => {
    const { container } = render(<App />);
    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    const file = new File([new Uint8Array([1, 2, 3])], "phrase.mp3", {
      type: "audio/mpeg"
    });

    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    });

    await waitFor(() => {
      expect(screen.getByText("phrase.mp3 を読み込みました。")).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Marker time"), {
      target: { value: "0:01" }
    });
    fireEvent.click(screen.getByTitle("入力時刻にマーカー追加"));

    expect(screen.getByText("Marker 1")).toBeVisible();
    expect(screen.getByDisplayValue("Marker 1")).toBeVisible();
    expect(screen.getByLabelText("Marker 1 time")).toHaveValue("0:01");
  });

  it("adds a marker at the current playback position and edits it", async () => {
    const { container } = render(<App />);
    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    const audio = container.querySelector<HTMLAudioElement>("audio");
    const file = new File([new Uint8Array([1, 2, 3])], "phrase.mp3", {
      type: "audio/mpeg"
    });

    expect(fileInput).not.toBeNull();
    expect(audio).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    });

    await waitFor(() => {
      expect(screen.getByText("phrase.mp3 を読み込みました。")).toBeVisible();
    });

    (audio as HTMLAudioElement).currentTime = 4;
    fireEvent.timeUpdate(audio as HTMLAudioElement);
    fireEvent.click(screen.getByTitle("現在位置にマーカー追加"));

    expect(screen.getByLabelText("Marker 1 time")).toHaveValue("0:04");

    const labelInput = screen.getByLabelText("Marker 1 label");
    const timeInput = screen.getByLabelText("Marker 1 time");

    fireEvent.change(labelInput, {
      target: { value: "Verse" }
    });
    fireEvent.change(timeInput, {
      target: { value: "0:07" }
    });

    expect(screen.getByDisplayValue("Verse")).toBeVisible();
    expect(screen.getByLabelText("Verse time")).toHaveValue("0:07");
  });

  it("drags a waveform marker to a new time", async () => {
    const rectMock = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRectMock(this: Element) {
        if (this.classList.contains("waveformSurface")) {
          return {
            bottom: 80,
            height: 80,
            left: 0,
            right: 100,
            toJSON: () => ({}),
            top: 0,
            width: 100,
            x: 0,
            y: 0
          };
        }

        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          toJSON: () => ({}),
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      });
    const { container } = render(<App />);
    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    const file = new File([new Uint8Array([1, 2, 3])], "phrase.mp3", {
      type: "audio/mpeg"
    });

    try {
      expect(fileInput).not.toBeNull();
      fireEvent.change(fileInput as HTMLInputElement, {
        target: { files: [file] }
      });

      await waitFor(() => {
        expect(screen.getByText("phrase.mp3 を読み込みました。")).toBeVisible();
      });

      fireEvent.change(screen.getByLabelText("Marker time"), {
        target: { value: "0:02" }
      });
      fireEvent.click(screen.getByTitle("入力時刻にマーカー追加"));

      const markerLine = container.querySelector<HTMLButtonElement>(".markerLine");

      expect(markerLine).not.toBeNull();
      expect(screen.getByLabelText("Marker 1 time")).toHaveValue("0:02");

      fireEvent.pointerDown(markerLine as HTMLButtonElement, {
        clientX: 20,
        pointerId: 1
      });
      fireEvent.pointerMove(markerLine as HTMLButtonElement, {
        clientX: 70,
        pointerId: 1
      });
      fireEvent.pointerUp(markerLine as HTMLButtonElement, {
        clientX: 70,
        pointerId: 1
      });

      expect(screen.getByLabelText("Marker 1 time")).toHaveValue("0:07");
    } finally {
      rectMock.mockRestore();
    }
  });
});
