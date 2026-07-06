import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the editor shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Mimicopy" })).toBeVisible();
    expect(screen.getByText("0:00 / 0:00")).toBeVisible();
    expect(screen.getByPlaceholderText("https://www.youtube.com/watch?v=...")).toBeVisible();
  });

  it("changes playback speed with keyboard shortcuts", () => {
    render(<App />);
    const speedControls = screen.getByLabelText("Playback speed");

    fireEvent.keyDown(window, { key: ",", shiftKey: true });
    expect(screen.getByText("0.75x")).toBeVisible();

    fireEvent.keyDown(window, { key: ".", shiftKey: true });
    expect(within(speedControls).getByText("1x")).toBeVisible();
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
    fireEvent.click(screen.getByTitle("マーカー追加"));

    expect(screen.getAllByText("Marker 1")).toHaveLength(2);
    expect(screen.getByText("0:01")).toBeVisible();
  });
});
