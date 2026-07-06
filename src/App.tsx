import {
  Clock3,
  Gauge,
  Link,
  LoaderCircle,
  MapPin,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  clampTime,
  defaultPlaybackRate,
  formatTime,
  getShortcutCommand,
  nextPlaybackRate,
  parseTimeInput,
  seekBy,
  type PlaybackRate
} from "./lib/playback";
import {
  createMarker,
  findReturnMarker,
  removeMarker,
  sortMarkers,
  type Marker
} from "./lib/markers";
import { buildWaveformPeaks, type WaveformPeak } from "./lib/waveform";

type AudioSource = {
  kind: "file" | "youtube";
  name: string;
  url: string;
  objectUrl?: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";

type ConvertResponse = {
  mediaUrl?: unknown;
  title?: unknown;
  duration?: unknown;
  error?: unknown;
};

type DynamicStyle = CSSProperties & {
  [key: `--${string}`]: string;
};

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select, button, a, [contenteditable='true']")
  );
}

async function decodePeaksFromArrayBuffer(arrayBuffer: ArrayBuffer) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return {
      duration: audioBuffer.duration,
      peaks: buildWaveformPeaks(audioBuffer, 1_200)
    };
  } finally {
    await audioContext.close();
  }
}

function getConvertedSource(body: ConvertResponse) {
  if (typeof body.mediaUrl !== "string" || body.mediaUrl.length === 0) {
    throw new Error(
      typeof body.error === "string" ? body.error : "YouTube conversion failed."
    );
  }

  return {
    duration: typeof body.duration === "number" ? body.duration : 0,
    title: typeof body.title === "string" ? body.title : "YouTube audio",
    url: body.mediaUrl
  };
}

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const previousObjectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("MP3かYouTube URLを読み込んでください。");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [peaks, setPeaks] = useState<WaveformPeak[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] =
    useState<PlaybackRate>(defaultPlaybackRate);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [markerInput, setMarkerInput] = useState("0:00");
  const [waveformSize, setWaveformSize] = useState({ height: 0, width: 0 });

  const sortedMarkers = useMemo(() => sortMarkers(markers), [markers]);
  const selectedMarker = useMemo(
    () => sortedMarkers.find((marker) => marker.id === selectedMarkerId) ?? null,
    [selectedMarkerId, sortedMarkers]
  );
  const playheadPercent =
    duration > 0 ? (clampTime(currentTime, duration) / duration) * 100 : 0;
  const playheadStyle: DynamicStyle = {
    "--marker-left": "0%",
    "--playhead-left": `${playheadPercent}%`
  };

  const setSource = useCallback((source: AudioSource) => {
    if (previousObjectUrlRef.current) {
      URL.revokeObjectURL(previousObjectUrlRef.current);
    }

    previousObjectUrlRef.current = source.objectUrl ?? null;
    setAudioSource(source);
    setLoadState("loading");
    setMessage(`${source.name} を読み込み中です。`);
    setPeaks([]);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackRate(defaultPlaybackRate);
    setMarkers([]);
    setSelectedMarkerId(null);
    setMarkerInput("0:00");
  }, []);

  const seekTo = useCallback(
    (time: number) => {
      const nextTime = clampTime(time, duration);
      const audio = audioRef.current;

      if (audio) {
        audio.currentTime = nextTime;
      }

      setCurrentTime(nextTime);
    },
    [duration]
  );

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !audioSource) {
      return;
    }

    if (audio.paused) {
      void audio.play().catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "再生に失敗しました。");
      });
      return;
    }

    audio.pause();
  }, [audioSource]);

  const addMarkerAt = useCallback(
    (time: number) => {
      if (!audioSource) {
        return;
      }

      const nextTime = clampTime(time, duration);
      const marker = createMarker(
        crypto.randomUUID(),
        nextTime,
        sortedMarkers.length
      );

      setMarkers((currentMarkers) => sortMarkers([...currentMarkers, marker]));
      setSelectedMarkerId(marker.id);
      setMarkerInput(formatTime(nextTime));
    },
    [audioSource, duration, sortedMarkers.length]
  );

  const addMarkerFromInput = useCallback(() => {
    const parsedTime = parseTimeInput(markerInput, duration);

    addMarkerAt(parsedTime ?? currentTime);
  }, [addMarkerAt, currentTime, duration, markerInput]);

  const returnToMarker = useCallback(() => {
    const marker = findReturnMarker(markers, selectedMarkerId, currentTime);

    if (!marker) {
      return;
    }

    setSelectedMarkerId(marker.id);
    seekTo(marker.time);
  }, [currentTime, markers, seekTo, selectedMarkerId]);

  const deleteMarker = useCallback((markerId: string) => {
    setMarkers((currentMarkers) => removeMarker(currentMarkers, markerId));
    setSelectedMarkerId((currentMarkerId) =>
      currentMarkerId === markerId ? null : currentMarkerId
    );
  }, []);

  const handleShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }

      const command = getShortcutCommand(event);

      if (!command) {
        return;
      }

      event.preventDefault();

      if (command.type === "togglePlayback") {
        togglePlayback();
        return;
      }

      if (command.type === "seek") {
        seekTo(seekBy(currentTime, command.deltaSeconds, duration));
        return;
      }

      if (command.type === "speed") {
        setPlaybackRate((currentRate) =>
          nextPlaybackRate(currentRate, command.direction)
        );
        return;
      }

      if (command.type === "addMarker") {
        addMarkerAt(currentTime);
        return;
      }

      returnToMarker();
    },
    [addMarkerAt, currentTime, duration, returnToMarker, seekTo, togglePlayback]
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      setSource({
        kind: "file",
        name: file.name,
        objectUrl,
        url: objectUrl
      });

      void file
        .arrayBuffer()
        .then(decodePeaksFromArrayBuffer)
        .then(({ duration: decodedDuration, peaks: decodedPeaks }) => {
          setPeaks(decodedPeaks);
          setDuration(decodedDuration);
          setLoadState("ready");
          setMessage(`${file.name} を読み込みました。`);
        })
        .catch((error: unknown) => {
          setLoadState("error");
          setMessage(
            error instanceof Error ? error.message : "波形の解析に失敗しました。"
          );
        });
    },
    [setSource]
  );

  const handleYoutubeSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!youtubeUrl.trim()) {
        setMessage("YouTube URLを入力してください。");
        return;
      }

      setIsConverting(true);
      setLoadState("loading");
      setMessage("YouTube音声をmp3に変換しています。");

      void fetch("/api/youtube", {
        body: JSON.stringify({ url: youtubeUrl }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
        .then(async (response) => {
          const body = (await response.json()) as ConvertResponse;

          if (!response.ok) {
            throw new Error(
              typeof body.error === "string"
                ? body.error
                : "YouTube conversion failed."
            );
          }

          return getConvertedSource(body);
        })
        .then(async (convertedSource) => {
          setSource({
            kind: "youtube",
            name: convertedSource.title,
            url: convertedSource.url
          });

          const response = await fetch(convertedSource.url);
          const arrayBuffer = await response.arrayBuffer();
          const decoded = await decodePeaksFromArrayBuffer(arrayBuffer);

          setDuration(decoded.duration || convertedSource.duration);
          setPeaks(decoded.peaks);
          setLoadState("ready");
          setMessage(`${convertedSource.title} を読み込みました。`);
        })
        .catch((error: unknown) => {
          setLoadState("error");
          setMessage(
            error instanceof Error ? error.message : "YouTube変換に失敗しました。"
          );
        })
        .finally(() => {
          setIsConverting(false);
        });
    },
    [setSource, youtubeUrl]
  );

  const handleWaveformPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) {
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();
      const ratio = clampTime(
        (event.clientX - bounds.left) / bounds.width,
        1
      );

      seekTo(duration * ratio);
    },
    [duration, seekTo]
  );

  useEffect(() => {
    return () => {
      if (previousObjectUrlRef.current) {
        URL.revokeObjectURL(previousObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.playbackRate = playbackRate;
  }, [audioSource?.url, playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !isPlaying) {
      return undefined;
    }

    let frameId = 0;

    const update = () => {
      setCurrentTime(audio.currentTime);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isPlaying]);

  useEffect(() => {
    window.addEventListener("keydown", handleShortcut);

    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [handleShortcut]);

  useEffect(() => {
    const waveform = waveformRef.current;

    if (!waveform) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect;
      setWaveformSize({ height, width });
    });

    observer.observe(waveform);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const cssWidth = Math.max(1, Math.floor(waveformSize.width));
    const cssHeight = Math.max(1, Math.floor(waveformSize.height));
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.floor(cssWidth * pixelRatio);
    const height = Math.floor(cssHeight * pixelRatio);

    canvas.width = width;
    canvas.height = height;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    const gradient = context.createLinearGradient(0, 0, cssWidth, cssHeight);
    gradient.addColorStop(0, "#2a9d8f");
    gradient.addColorStop(0.55, "#f4a261");
    gradient.addColorStop(1, "#e76f51");

    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    context.fillRect(0, 0, cssWidth, cssHeight);

    if (peaks.length === 0) {
      context.fillStyle = "rgba(247, 247, 242, 0.18)";
      context.fillRect(0, cssHeight / 2 - 1, cssWidth, 2);
      return;
    }

    const centerY = cssHeight / 2;
    const barWidth = Math.max(1, cssWidth / peaks.length);

    context.fillStyle = gradient;

    for (let index = 0; index < peaks.length; index += 1) {
      const peak = peaks[index];
      const min = Math.min(0, peak.min);
      const max = Math.max(0, peak.max);
      const x = index * barWidth;
      const y = centerY - max * centerY;
      const barHeight = Math.max(1, (max - min) * centerY);

      context.fillRect(x, y, Math.max(1, barWidth * 0.82), barHeight);
    }
  }, [peaks, waveformSize]);

  return (
    <main className="appShell">
      <audio
        ref={audioRef}
        preload="metadata"
        src={audioSource?.url}
        onDurationChange={(event) => {
          setDuration(event.currentTarget.duration || duration);
        }}
        onEnded={() => {
          setIsPlaying(false);
        }}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || duration);
        }}
        onPause={() => {
          setIsPlaying(false);
        }}
        onPlay={() => {
          setIsPlaying(true);
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
      />

      <header className="topBar">
        <div className="brandBlock">
          <span className="brandMark">M</span>
          <div>
            <h1>Mimicopy</h1>
            <p>{audioSource?.name ?? "耳コピ用ワークスペース"}</p>
          </div>
        </div>

        <div className="sourceControls">
          <input
            ref={fileInputRef}
            className="srOnly"
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={handleFileChange}
          />
          <button
            className="controlButton"
            type="button"
            title="MP3を選択"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={18} />
            <span>MP3</span>
          </button>

          <form className="youtubeForm" onSubmit={handleYoutubeSubmit}>
            <label className="srOnly" htmlFor="youtube-url">
              YouTube URL
            </label>
            <Link size={18} aria-hidden="true" />
            <input
              id="youtube-url"
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
            />
            <button
              className="iconButton"
              type="submit"
              title="YouTubeを変換"
              disabled={isConverting}
            >
              {isConverting ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}
            </button>
          </form>
        </div>
      </header>

      <section className="studioGrid" aria-label="Audio editor">
        <section className="workspace" aria-label="Waveform">
          <div className="timelineMeta">
            <span className={`statusPill ${loadState}`}>{loadState}</span>
            <span>{message}</span>
            <span className="timeReadout">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div
            ref={waveformRef}
            className="waveformSurface"
            role="slider"
            aria-label="再生位置"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, Math.floor(duration))}
            aria-valuenow={Math.floor(currentTime)}
            tabIndex={0}
            onPointerDown={handleWaveformPointerDown}
          >
            <canvas ref={canvasRef} className="waveformCanvas" />
            {sortedMarkers.map((marker) => {
              const markerLeft =
                duration > 0 ? `${(marker.time / duration) * 100}%` : "0%";
              const style: DynamicStyle = {
                "--marker-left": markerLeft,
                "--playhead-left": "0%"
              };

              return (
                <button
                  key={marker.id}
                  className={`markerLine ${
                    marker.id === selectedMarkerId ? "selected" : ""
                  }`}
                  style={style}
                  type="button"
                  title={`${marker.label} ${formatTime(marker.time)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedMarkerId(marker.id);
                    seekTo(marker.time);
                  }}
                />
              );
            })}
            <div
              className="playhead"
              style={playheadStyle}
            />
          </div>
        </section>

        <aside className="markerPanel" aria-label="Markers">
          <div className="panelHeader">
            <div>
              <h2>Markers</h2>
              <p>{selectedMarker ? selectedMarker.label : "No selection"}</p>
            </div>
            <button
              className="iconButton"
              type="button"
              title="選択マーカーへ戻る"
              disabled={sortedMarkers.length === 0}
              onClick={returnToMarker}
            >
              <RotateCcw size={18} />
            </button>
          </div>

          <div className="markerComposer">
            <MapPin size={18} aria-hidden="true" />
            <label className="srOnly" htmlFor="marker-time">
              Marker time
            </label>
            <input
              id="marker-time"
              value={markerInput}
              onChange={(event) => setMarkerInput(event.target.value)}
              placeholder="1:23"
            />
            <button
              className="iconButton"
              type="button"
              title="現在位置を入力"
              onClick={() => setMarkerInput(formatTime(currentTime))}
            >
              <Clock3 size={18} />
            </button>
            <button
              className="iconButton accent"
              type="button"
              title="マーカー追加"
              disabled={!audioSource}
              onClick={addMarkerFromInput}
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="markerList">
            {sortedMarkers.length === 0 ? (
              <div className="emptyMarkers">No markers</div>
            ) : (
              sortedMarkers.map((marker) => (
                <div
                  key={marker.id}
                  className={`markerItem ${
                    marker.id === selectedMarkerId ? "selected" : ""
                  }`}
                >
                  <button
                    className="markerJump"
                    type="button"
                    title="マーカーへ移動"
                    onClick={() => {
                      setSelectedMarkerId(marker.id);
                      seekTo(marker.time);
                    }}
                  >
                    <span>{marker.label}</span>
                    <strong>{formatTime(marker.time)}</strong>
                  </button>
                  <button
                    className="iconButton danger"
                    type="button"
                    title="マーカー削除"
                    onClick={() => deleteMarker(marker.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </section>

      <footer className="transportBar">
        <div className="transportCluster">
          <button
            className="transportButton primary"
            type="button"
            title={isPlaying ? "停止" : "再生"}
            disabled={!audioSource}
            onClick={togglePlayback}
          >
            {isPlaying ? <Pause size={21} /> : <Play size={21} />}
            <span>{isPlaying ? "停止" : "再生"}</span>
          </button>
          <button
            className="transportButton"
            type="button"
            title="5秒戻る"
            disabled={!audioSource}
            onClick={() => seekTo(seekBy(currentTime, -5, duration))}
          >
            <span>-5s</span>
          </button>
          <button
            className="transportButton"
            type="button"
            title="5秒進む"
            disabled={!audioSource}
            onClick={() => seekTo(seekBy(currentTime, 5, duration))}
          >
            <span>+5s</span>
          </button>
          <button
            className="transportButton"
            type="button"
            title="10秒戻る"
            disabled={!audioSource}
            onClick={() => seekTo(seekBy(currentTime, -10, duration))}
          >
            <span>-10s</span>
          </button>
          <button
            className="transportButton"
            type="button"
            title="10秒進む"
            disabled={!audioSource}
            onClick={() => seekTo(seekBy(currentTime, 10, duration))}
          >
            <span>+10s</span>
          </button>
        </div>

        <div className="speedCluster">
          <Gauge size={18} />
          <button
            className="iconButton"
            type="button"
            title="速度を下げる"
            onClick={() =>
              setPlaybackRate((currentRate) =>
                nextPlaybackRate(currentRate, "slower")
              )
            }
          >
            <span>,</span>
          </button>
          <strong>{playbackRate}x</strong>
          <button
            className="iconButton"
            type="button"
            title="速度を上げる"
            onClick={() =>
              setPlaybackRate((currentRate) =>
                nextPlaybackRate(currentRate, "faster")
              )
            }
          >
            <span>.</span>
          </button>
        </div>
      </footer>
    </main>
  );
}
