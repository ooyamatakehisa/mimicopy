import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { YoutubeBeatGridAnalysis } from "./lib/beats";
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

function expectTrackEditorLoaded(title: string) {
  expect(
    within(screen.getByLabelText("Audio editor")).getByRole("heading", {
      name: title
    })
  ).toBeVisible();
  expect(
    screen.queryByText(`${title} を読み込みました。`)
  ).not.toBeInTheDocument();
}

function createClickTrackAnalysis(): YoutubeBeatGridAnalysis {
  return {
    beatGrid: {
      analyzedAt: "2026-07-20T00:00:00.000Z",
      beats: [
        { isDownbeat: true, position: 1, time: 0.5 },
        { isDownbeat: false, position: 2, time: 1 },
        { isDownbeat: false, position: 3, time: 1.5 }
      ],
      beatsPerBar: [4],
      downbeats: [0.5],
      source: "madmom"
    },
    reference: {
      duration: 10,
      sourceType: "youtube",
      title: "Reference groove",
      url: "https://www.youtube.com/watch?v=DFRdswY-WHU"
    }
  };
}

describe("App", () => {
  let savedClickTrack: YoutubeBeatGridAnalysis | null;
  let tracks: TrackDetail[];

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    savedClickTrack = null;
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
          const body =
            typeof init?.body === "string"
              ? (JSON.parse(init.body) as { duration?: unknown; title?: unknown })
              : {};
          const currentTrack = tracks[0] ?? createTrack();
          const track = {
            ...currentTrack,
            duration:
              typeof body.duration === "number" ? body.duration : currentTrack.duration,
            title:
              typeof body.title === "string" ? body.title.trim() : currentTrack.title,
            updatedAt: "2026-07-16T00:00:00.000Z"
          };
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

        if (url === "/api/tracks/track-1/beat-grid" && method === "GET") {
          return Response.json(
            savedClickTrack ?? { beatGrid: null, reference: null }
          );
        }

        if (
          url === "/api/tracks/track-1/beat-grid/youtube" &&
          method === "POST"
        ) {
          savedClickTrack = createClickTrackAnalysis();
          return Response.json(savedClickTrack);
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
      expectTrackEditorLoaded("saved-phrase.mp3");
    });

    expect(
      within(screen.getByRole("button", { name: "ライブラリへ戻る" })).queryByText(
        "Library"
      )
    ).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/tracks/track-1");
    expect(screen.getByDisplayValue("Verse")).toBeVisible();
    expect(screen.getByLabelText("Verse time")).toHaveValue("0:03");
  });

  it("renames a saved mp3 from the library", async () => {
    tracks = [
      createTrack({
        title: "saved-phrase.mp3"
      })
    ];

    render(<App />);

    await screen.findByTitle("saved-phrase.mp3 を開く");

    fireEvent.click(screen.getByTitle("表示名を編集"));
    fireEvent.change(screen.getByLabelText("saved-phrase.mp3 display name"), {
      target: { value: "Shadowing drill" }
    });
    fireEvent.click(screen.getByTitle("表示名を保存"));

    await waitFor(() => {
      expect(screen.getByTitle("Shadowing drill を開く")).toBeVisible();
    });

    expect(screen.getByText("Shadowing drill に変更しました。")).toBeVisible();
    expect(tracks[0]?.title).toBe("Shadowing drill");
  });

  it("renames a saved mp3 from the track editor", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");

    render(<App />);

    await waitFor(() => {
      expectTrackEditorLoaded("phrase.mp3");
    });

    fireEvent.click(screen.getByTitle("表示名を編集"));
    fireEvent.change(screen.getByLabelText("phrase.mp3 display name"), {
      target: { value: "Focused phrase" }
    });
    fireEvent.click(screen.getByTitle("表示名を保存"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Focused phrase" })
      ).toBeVisible();
    });

    expect(screen.getByText("Focused phrase に変更しました。")).toBeVisible();
    expect(tracks[0]?.title).toBe("Focused phrase");

    fireEvent.click(screen.getByTitle("ライブラリへ戻る"));

    await waitFor(() => {
      expect(screen.getByTitle("Focused phrase を開く")).toBeVisible();
    });
  });

  it("changes playback speed with keyboard shortcuts while a button is focused", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");
    render(<App />);

    await waitFor(() => {
      expectTrackEditorLoaded("phrase.mp3");
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
      expectTrackEditorLoaded("phrase.mp3");
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
        expectTrackEditorLoaded("phrase.mp3");
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
      expectTrackEditorLoaded("phrase.mp3");
    });

    const zoomControls = screen.getByLabelText("Waveform zoom");

    expect(within(zoomControls).getByText("1x")).toBeVisible();

    fireEvent.click(screen.getByTitle("波形を拡大"));
    expect(within(zoomControls).getByText("2x")).toBeVisible();

    for (const zoom of [
      "4x",
      "8x",
      "12x",
      "16x",
      "20x",
      "24x",
      "28x",
      "32x"
    ]) {
      fireEvent.click(screen.getByTitle("波形を拡大"));
      expect(within(zoomControls).getByText(zoom)).toBeVisible();
    }

    expect(screen.getByTitle("波形を拡大")).toBeDisabled();

    fireEvent.click(screen.getByTitle("波形を縮小"));
    expect(within(zoomControls).getByText("28x")).toBeVisible();
  });

  it("changes waveform zoom with trackpad pinch gestures", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");
    render(<App />);

    await waitFor(() => {
      expectTrackEditorLoaded("phrase.mp3");
    });

    const waveform = screen.getByRole("slider", { name: "再生位置" });
    const zoomControls = screen.getByLabelText("Waveform zoom");

    fireEvent.wheel(waveform, { deltaY: -100 });
    expect(within(zoomControls).getByText("1x")).toBeVisible();

    fireEvent.wheel(waveform, { ctrlKey: true, deltaY: -10 });
    expect(within(zoomControls).getByText("1.11x")).toBeVisible();

    fireEvent.wheel(waveform, { ctrlKey: true, deltaY: -10 });
    expect(within(zoomControls).getByText("1.22x")).toBeVisible();

    fireEvent.wheel(waveform, { ctrlKey: true, deltaY: 100 });
    expect(within(zoomControls).getByText("1x")).toBeVisible();
  });

  it("analyzes beats and toggles the click track", async () => {
    tracks = [createTrack()];
    window.history.replaceState(null, "", "/tracks/track-1");
    const view = render(<App />);

    await waitFor(() => {
      expectTrackEditorLoaded("phrase.mp3");
    });

    const clickTrackControls = screen.getByLabelText("Click track");
    const clickSourceInput = screen.getByLabelText("Click source YouTube URL");
    const clickButton = screen.getByTitle("クリック音をオン/オフ");

    expect(clickButton).toBeDisabled();
    await waitFor(() => {
      expect(
        within(clickTrackControls).getByText("No beat grid")
      ).toBeVisible();
    });

    fireEvent.change(clickSourceInput, {
      target: { value: "https://www.youtube.com/watch?v=DFRdswY-WHU" }
    });
    fireEvent.click(screen.getByTitle("クリック用YouTubeを解析"));

    await waitFor(() => {
      expect(
        within(clickTrackControls).getByText(/3 beats \/ 1 downbeats/)
      ).toBeVisible();
    });
    expect(within(clickTrackControls).getByText(/Reference groove/)).toBeVisible();

    expect(clickButton).not.toBeDisabled();
    fireEvent.click(clickButton);
    expect(clickButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(clickButton);
    expect(clickButton).toHaveAttribute("aria-pressed", "false");

    view.unmount();
    render(<App />);

    await waitFor(() => {
      expect(
        within(screen.getByLabelText("Click track")).getByText(
          /3 beats \/ 1 downbeats/
        )
      ).toBeVisible();
    });
    expect(screen.getByTitle("クリック音をオン/オフ")).toBeEnabled();
    expect(screen.getByLabelText("Click source YouTube URL")).toHaveValue(
      "https://www.youtube.com/watch?v=DFRdswY-WHU"
    );
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
      expectTrackEditorLoaded("phrase.mp3");
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
      expectTrackEditorLoaded("phrase.mp3");
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
        expectTrackEditorLoaded("phrase.mp3");
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
