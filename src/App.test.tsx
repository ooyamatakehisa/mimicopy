import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { TrackDetail, TrackSummary } from "./lib/library";

const baseTimestamp = "2026-07-15T00:00:00.000Z";

function toSummary(track: TrackDetail): TrackSummary {
  return {
    createdAt: track.createdAt,
    duration: track.duration,
    id: track.id,
    markerCount: track.markerCount,
    mediaUrl: track.mediaUrl,
    sourceType: track.sourceType,
    title: track.title,
    updatedAt: track.updatedAt
  };
}

function createTrack(overrides: Partial<TrackDetail> = {}): TrackDetail {
  return {
    createdAt: baseTimestamp,
    duration: 10,
    id: "track-1",
    markerCount: overrides.markers?.length ?? 0,
    markers: [],
    mediaUrl: "/media/track-1.mp3",
    sourceType: "upload",
    title: "phrase.mp3",
    updatedAt: baseTimestamp,
    ...overrides
  };
}

function expectLoadedMessage(title: string) {
  expect(
    screen.getAllByText(`${title} を読み込みました。`).length
  ).toBeGreaterThan(0);
}

describe("App", () => {
  let tracks: TrackDetail[];

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    tracks = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const method = init?.method ?? "GET";

        if (url === "/api/tracks" && method === "GET") {
          return Response.json({ tracks: tracks.map(toSummary) });
        }

        if (url === "/api/tracks" && method === "POST") {
          const encodedName = init?.headers
            ? new Headers(init.headers).get("X-File-Name")
            : null;
          const title = encodedName ? decodeURIComponent(encodedName) : "phrase.mp3";
          const track = createTrack({ title });

          tracks = [track, ...tracks];

          return Response.json({ track }, { status: 201 });
        }

        if (url === "/api/tracks/track-1" && method === "GET") {
          return Response.json({ track: tracks[0] ?? createTrack() });
        }

        if (url === "/api/tracks/track-1" && method === "PATCH") {
          const track = { ...(tracks[0] ?? createTrack()), duration: 10 };
          tracks = [track];

          return Response.json({ track });
        }

        if (url === "/api/tracks/track-1/markers" && method === "PUT") {
          const body =
            typeof init?.body === "string"
              ? (JSON.parse(init.body) as { markers?: TrackDetail["markers"] })
              : {};
          const markers = Array.isArray(body.markers) ? body.markers : [];
          const track = {
            ...(tracks[0] ?? createTrack()),
            markerCount: markers.length,
            markers
          };
          tracks = [track];

          return Response.json({ track });
        }

        if (url === "/media/track-1.mp3") {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }

        return Response.json({ error: `Unhandled request: ${method} ${url}` }, {
          status: 500
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the library page", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Mimicopy" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Library" })).toBeVisible();
    expect(screen.getByPlaceholderText("https://www.youtube.com/watch?v=...")).toBeVisible();
  });

  it("opens a saved mp3 from the library", async () => {
    tracks = [
      createTrack({
        markerCount: 1,
        markers: [{ id: "marker-1", label: "Verse", time: 3 }],
        title: "saved-phrase.mp3"
      })
    ];

    render(<App />);

    const savedTrackButton = await screen.findByTitle("saved-phrase.mp3 を開く");

    fireEvent.click(savedTrackButton);

    await waitFor(() => {
      expectLoadedMessage("saved-phrase.mp3");
    });

    expect(window.location.pathname).toBe("/tracks/track-1");
    expect(screen.getByDisplayValue("Verse")).toBeVisible();
    expect(screen.getByLabelText("Verse time")).toHaveValue("0:03");
  });

  it("changes playback speed with keyboard shortcuts while a button is focused", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");
    render(<App />);

    await waitFor(() => {
      expectLoadedMessage("phrase.mp3");
    });

    const speedControls = screen.getByLabelText("Playback speed");
    const speedDownButton = screen.getByTitle("速度を下げる");

    speedDownButton.focus();

    fireEvent.keyDown(speedDownButton, { key: ",", shiftKey: true });
    expect(screen.getByText("0.75x")).toBeVisible();

    fireEvent.keyDown(speedDownButton, { key: ".", shiftKey: true });
    expect(within(speedControls).getByText("1x")).toBeVisible();
  });

  it("claims playback speed shortcuts before later page listeners", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");
    render(<App />);

    await waitFor(() => {
      expectLoadedMessage("phrase.mp3");
    });

    const speedControls = screen.getByLabelText("Playback speed");
    const speedDownButton = screen.getByTitle("速度を下げる");
    const windowListener = vi.fn();
    const documentListener = vi.fn();
    const listenerOptions = { capture: true } as const;

    window.addEventListener("keydown", windowListener, listenerOptions);
    document.addEventListener("keydown", documentListener, listenerOptions);

    try {
      speedDownButton.focus();
      fireEvent.keyDown(speedDownButton, {
        code: "Comma",
        key: "Unidentified",
        shiftKey: true
      });

      expect(within(speedControls).getByText("0.75x")).toBeVisible();
      expect(windowListener).not.toHaveBeenCalled();
      expect(documentListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowListener, listenerOptions);
      document.removeEventListener("keydown", documentListener, listenerOptions);
    }
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
    const file = new File([new Uint8Array([1, 2, 3])], "phrase.mp3", {
      type: "audio/mpeg"
    });

    try {
      expect(fileInput).not.toBeNull();
      fireEvent.change(fileInput as HTMLInputElement, {
        target: { files: [file] }
      });

      await waitFor(() => {
        expectLoadedMessage("phrase.mp3");
      });

      const speedDownButton = await screen.findByTitle("速度を下げる");
      const audio = container.querySelector<HTMLAudioElement>("audio");

      expect(audio).not.toBeNull();
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

  it("changes waveform zoom with the zoom controls", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");
    render(<App />);

    await waitFor(() => {
      expectLoadedMessage("phrase.mp3");
    });

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
      expectLoadedMessage("phrase.mp3");
    });

    fireEvent.change(await screen.findByLabelText("Marker time"), {
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
    const file = new File([new Uint8Array([1, 2, 3])], "phrase.mp3", {
      type: "audio/mpeg"
    });

    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] }
    });

    await waitFor(() => {
      expectLoadedMessage("phrase.mp3");
    });

    await screen.findByTitle("現在位置にマーカー追加");

    const audio = container.querySelector<HTMLAudioElement>("audio");

    expect(audio).not.toBeNull();
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
        expectLoadedMessage("phrase.mp3");
      });

      fireEvent.change(await screen.findByLabelText("Marker time"), {
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
