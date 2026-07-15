import {
  ArrowLeft,
  Clock3,
  Gauge,
  Link,
  ListMusic,
  LoaderCircle,
  MapPin,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut
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
  updateMarker,
  type Marker
} from "./lib/markers";
import {
  getErrorMessage,
  parseTrackListResponse,
  parseTrackResponse,
  type LibrarySourceType,
  type TrackDetail,
  type TrackSummary
} from "./lib/library";
import {
  buildWaveformPeaks,
  centerWaveformRange,
  defaultWaveformZoom,
  getWaveformRange,
  keepTimeInWaveformRange,
  nextWaveformZoom,
  timeToWaveformPercent,
  waveformPercentToTime,
  type WaveformPeak,
  type WaveformZoom
} from "./lib/waveform";
import { Button, IconButton } from "./components/ui/button";
import { SectionHeader, Surface } from "./components/ui/surface";
import { StatusBadge } from "./components/ui/status-badge";
import { TextInput } from "./components/ui/text-input";
import { cn } from "./lib/cn";

type AudioSource = {
  kind: LibrarySourceType;
  name: string;
  url: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";

type DynamicStyle = CSSProperties & {
  [key: `--${string}`]: string;
};

type SourceOptions = {
  currentTrackId: string | null;
  durationHint?: number;
  markers?: Marker[];
};

type AppRoute =
  | {
      name: "library";
    }
  | {
      name: "track";
      trackId: string;
    };

const libraryDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "numeric"
});

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']")
  );
}

async function decodePeaksFromArrayBuffer(arrayBuffer: ArrayBuffer) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return {
      duration: audioBuffer.duration,
      peaks: buildWaveformPeaks(audioBuffer, 4_800)
    };
  } finally {
    await audioContext.close();
  }
}

async function parseJsonResponse(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, fallback));
  }

  return body;
}

function toTrackSummary(track: TrackDetail): TrackSummary {
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

function formatLibraryDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return libraryDateFormatter.format(date);
}

function getSourceTypeLabel(sourceType: LibrarySourceType) {
  if (sourceType === "youtube") {
    return "YouTube";
  }

  if (sourceType === "imported") {
    return "Imported";
  }

  return "MP3";
}

function getInitialRoute(): AppRoute {
  const match = window.location.pathname.match(/^\/tracks\/([^/]+)\/?$/);

  if (match?.[1]) {
    return {
      name: "track",
      trackId: decodeURIComponent(match[1])
    };
  }

  return { name: "library" };
}

function getRoutePath(route: AppRoute) {
  if (route.name === "track") {
    return `/tracks/${encodeURIComponent(route.trackId)}`;
  }

  return "/";
}

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const draggingMarkerIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [route, setRoute] = useState<AppRoute>(getInitialRoute);
  const [libraryTracks, setLibraryTracks] = useState<TrackSummary[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingMarkers, setIsSavingMarkers] = useState(false);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
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
  const [markerTimeDrafts, setMarkerTimeDrafts] = useState<
    Record<string, string>
  >({});
  const [waveformSize, setWaveformSize] = useState({ height: 0, width: 0 });
  const [waveformZoom, setWaveformZoom] =
    useState<WaveformZoom>(defaultWaveformZoom);
  const [waveformStart, setWaveformStart] = useState(0);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);

  const sortedMarkers = useMemo(() => sortMarkers(markers), [markers]);
  const selectedMarker = useMemo(
    () => sortedMarkers.find((marker) => marker.id === selectedMarkerId) ?? null,
    [selectedMarkerId, sortedMarkers]
  );
  const waveformRange = useMemo(
    () => getWaveformRange(duration, waveformZoom, waveformStart),
    [duration, waveformStart, waveformZoom]
  );
  const visibleMarkers = useMemo(
    () =>
      sortedMarkers.filter(
        (marker) =>
          marker.time >= waveformRange.start && marker.time <= waveformRange.end
      ),
    [sortedMarkers, waveformRange.end, waveformRange.start]
  );
  const playheadPercent = timeToWaveformPercent(currentTime, waveformRange);
  const playheadStyle: DynamicStyle = {
    "--marker-left": "0%",
    "--playhead-left": `${playheadPercent}%`
  };
  const currentTrack = useMemo(
    () => libraryTracks.find((track) => track.id === currentTrackId) ?? null,
    [currentTrackId, libraryTracks]
  );
  const routeTrackId = route.name === "track" ? route.trackId : null;

  const navigateToRoute = useCallback((nextRoute: AppRoute) => {
    const nextPath = getRoutePath(nextRoute);

    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }

    setRoute(nextRoute);
  }, []);

  const navigateToLibrary = useCallback(() => {
    navigateToRoute({ name: "library" });
  }, [navigateToRoute]);

  const navigateToTrack = useCallback(
    (trackId: string) => {
      navigateToRoute({ name: "track", trackId });
    },
    [navigateToRoute]
  );

  const updateLibraryTrack = useCallback((track: TrackDetail) => {
    const summary = toTrackSummary(track);

    setLibraryTracks((currentTracks) => {
      const withoutTrack = currentTracks.filter(
        (currentTrackItem) => currentTrackItem.id !== summary.id
      );

      return [summary, ...withoutTrack].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
    });
  }, []);

  const setSource = useCallback((source: AudioSource, options: SourceOptions) => {
    setCurrentTrackId(options.currentTrackId);
    setAudioSource(source);
    setLoadState("loading");
    setMessage(`${source.name} を読み込み中です。`);
    setPeaks([]);
    setDuration(options.durationHint ?? 0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackRate(defaultPlaybackRate);
    setMarkers(sortMarkers(options.markers ?? []));
    setSelectedMarkerId(null);
    setMarkerInput("0:00");
    setMarkerTimeDrafts({});
    setWaveformZoom(defaultWaveformZoom);
    setWaveformStart(0);
  }, []);

  const resetWorkspace = useCallback(() => {
    setCurrentTrackId(null);
    setAudioSource(null);
    setLoadState("idle");
    setMessage("MP3かYouTube URLを読み込んでください。");
    setPeaks([]);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackRate(defaultPlaybackRate);
    setMarkers([]);
    setSelectedMarkerId(null);
    setMarkerInput("0:00");
    setMarkerTimeDrafts({});
    setWaveformZoom(defaultWaveformZoom);
    setWaveformStart(0);
  }, []);

  const loadLibrary = useCallback(() => {
    setIsLibraryLoading(true);

    void fetch("/api/tracks")
      .then((response) =>
        parseJsonResponse(response, "ライブラリ一覧を読み込めませんでした。")
      )
      .then(parseTrackListResponse)
      .then(setLibraryTracks)
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "ライブラリ一覧を読み込めませんでした。"
        );
      })
      .finally(() => {
        setIsLibraryLoading(false);
      });
  }, []);

  const saveTrackDuration = useCallback(
    async (trackId: string, nextDuration: number) => {
      const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        body: JSON.stringify({ duration: nextDuration }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const body = await parseJsonResponse(
        response,
        "曲の長さを保存できませんでした。"
      );
      const track = parseTrackResponse(body);

      updateLibraryTrack(track);

      return track;
    },
    [updateLibraryTrack]
  );

  const completeTrackLoad = useCallback(
    (track: TrackDetail, decoded: Awaited<ReturnType<typeof decodePeaksFromArrayBuffer>>) => {
      const decodedDuration = decoded.duration || track.duration;

      setSource(
        {
          kind: track.sourceType,
          name: track.title,
          url: track.mediaUrl
        },
        {
          currentTrackId: track.id,
          durationHint: decodedDuration,
          markers: track.markers
        }
      );
      setPeaks(decoded.peaks);
      setDuration(decodedDuration);
      setLoadState("ready");
      setMessage(`${track.title} を読み込みました。`);
      updateLibraryTrack({ ...track, duration: decodedDuration });
      navigateToTrack(track.id);

      if (Math.abs(decodedDuration - track.duration) > 0.25) {
        void saveTrackDuration(track.id, decodedDuration).catch(() => undefined);
      }
    },
    [navigateToTrack, saveTrackDuration, setSource, updateLibraryTrack]
  );

  const loadTrackFromLibrary = useCallback(
    (trackId: string) => {
      setLoadState("loading");
      setMessage("保存済みMP3を読み込んでいます。");

      void fetch(`/api/tracks/${encodeURIComponent(trackId)}`)
        .then((response) =>
          parseJsonResponse(response, "保存済みMP3を読み込めませんでした。")
        )
        .then(parseTrackResponse)
        .then(async (track) => {
          setSource(
            {
              kind: track.sourceType,
              name: track.title,
              url: track.mediaUrl
            },
            {
              currentTrackId: track.id,
              durationHint: track.duration,
              markers: track.markers
            }
          );

          const mediaResponse = await fetch(track.mediaUrl);

          if (!mediaResponse.ok) {
            throw new Error("保存済みMP3ファイルを読み込めませんでした。");
          }

          const arrayBuffer = await mediaResponse.arrayBuffer();
          const decoded = await decodePeaksFromArrayBuffer(arrayBuffer);

          completeTrackLoad(track, decoded);
        })
        .catch((error: unknown) => {
          setLoadState("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "保存済みMP3を読み込めませんでした。"
          );
        });
    },
    [completeTrackLoad, setSource]
  );

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

  const renameMarker = useCallback((markerId: string, label: string) => {
    setMarkers((currentMarkers) =>
      updateMarker(currentMarkers, markerId, { label })
    );
  }, []);

  const finishRenamingMarker = useCallback((markerId: string) => {
    setMarkers((currentMarkers) =>
      currentMarkers.map((marker) =>
        marker.id === markerId && marker.label.trim().length === 0
          ? { ...marker, label: "Marker" }
          : marker
      )
    );
  }, []);

  const moveMarkerTo = useCallback(
    (markerId: string, time: number) => {
      const nextTime = clampTime(time, duration);

      setMarkers((currentMarkers) =>
        sortMarkers(updateMarker(currentMarkers, markerId, { time: nextTime }))
      );
      setSelectedMarkerId(markerId);
      setMarkerInput(formatTime(nextTime));
      setMarkerTimeDrafts((currentDrafts) =>
        markerId in currentDrafts
          ? { ...currentDrafts, [markerId]: formatTime(nextTime) }
          : currentDrafts
      );
    },
    [duration]
  );

  const changeMarkerTimeInput = useCallback(
    (markerId: string, value: string) => {
      setMarkerTimeDrafts((currentDrafts) => ({
        ...currentDrafts,
        [markerId]: value
      }));

      const parsedTime = parseTimeInput(value, duration);

      if (parsedTime !== null) {
        moveMarkerTo(markerId, parsedTime);
      }
    },
    [duration, moveMarkerTo]
  );

  const finishMarkerTimeInput = useCallback((markerId: string) => {
    setMarkerTimeDrafts((currentDrafts) => {
      const { [markerId]: _markerDraft, ...nextDrafts } = currentDrafts;

      return nextDrafts;
    });
  }, []);

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
    setMarkerTimeDrafts((currentDrafts) => {
      const { [markerId]: _markerDraft, ...nextDrafts } = currentDrafts;

      return nextDrafts;
    });
  }, []);

  const changeWaveformZoom = useCallback(
    (direction: "in" | "out") => {
      setWaveformZoom((currentZoom) => {
        const nextZoom = nextWaveformZoom(currentZoom, direction);

        setWaveformStart(centerWaveformRange(currentTime, duration, nextZoom));

        return nextZoom;
      });
    },
    [currentTime, duration]
  );

  const handleShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }

      const command = getShortcutCommand(event);

      if (!command) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

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

      const input = event.currentTarget;

      setIsUploading(true);
      setLoadState("loading");
      setMessage(`${file.name} を保存しています。`);

      void fetch("/api/tracks", {
        body: file,
        headers: {
          "Content-Type": file.type || "audio/mpeg",
          "X-File-Name": encodeURIComponent(file.name)
        },
        method: "POST"
      })
        .then((response) =>
          parseJsonResponse(response, "MP3を保存できませんでした。")
        )
        .then(parseTrackResponse)
        .then(async (track) => {
          const decoded = await file
            .arrayBuffer()
            .then(decodePeaksFromArrayBuffer);

          completeTrackLoad(track, decoded);
        })
        .catch((error: unknown) => {
          setLoadState("error");
          setMessage(
            error instanceof Error ? error.message : "MP3の保存に失敗しました。"
          );
        })
        .finally(() => {
          input.value = "";
          setIsUploading(false);
        });
    },
    [completeTrackLoad]
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
        .then((response) =>
          parseJsonResponse(response, "YouTube変換に失敗しました。")
        )
        .then(parseTrackResponse)
        .then(async (track) => {
          const response = await fetch(track.mediaUrl);

          if (!response.ok) {
            throw new Error("変換済みMP3を読み込めませんでした。");
          }

          const arrayBuffer = await response.arrayBuffer();
          const decoded = await decodePeaksFromArrayBuffer(arrayBuffer);

          completeTrackLoad(track, decoded);
          setYoutubeUrl("");
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
    [completeTrackLoad, youtubeUrl]
  );

  const deleteTrackFromLibrary = useCallback(
    (trackId: string) => {
      const track = libraryTracks.find(
        (libraryTrack) => libraryTrack.id === trackId
      );

      if (!track || !window.confirm(`${track.title} を削除しますか？`)) {
        return;
      }

      void fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "DELETE"
      })
        .then((response) =>
          parseJsonResponse(response, "保存済みMP3を削除できませんでした。")
        )
        .then(() => {
          setLibraryTracks((currentTracks) =>
            currentTracks.filter(
              (currentTrackItem) => currentTrackItem.id !== trackId
            )
          );

          if (currentTrackId === trackId) {
            resetWorkspace();
          }

          if (routeTrackId === trackId) {
            navigateToLibrary();
          }
        })
        .catch((error: unknown) => {
          setMessage(
            error instanceof Error
              ? error.message
              : "保存済みMP3を削除できませんでした。"
          );
        });
    },
    [currentTrackId, libraryTracks, navigateToLibrary, resetWorkspace, routeTrackId]
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

      seekTo(waveformPercentToTime(ratio, waveformRange, duration));
    },
    [duration, seekTo, waveformRange]
  );

  const moveMarkerFromPointer = useCallback(
    (markerId: string, clientX: number) => {
      const waveform = waveformRef.current;

      if (!waveform || !duration) {
        return;
      }

      const bounds = waveform.getBoundingClientRect();

      if (bounds.width <= 0) {
        return;
      }

      const ratio = clampTime((clientX - bounds.left) / bounds.width, 1);
      const nextTime = waveformPercentToTime(ratio, waveformRange, duration);

      moveMarkerTo(markerId, nextTime);
    },
    [duration, moveMarkerTo, waveformRange]
  );

  const startDraggingMarker = useCallback((markerId: string) => {
    draggingMarkerIdRef.current = markerId;
    setDraggingMarkerId(markerId);
  }, []);

  const stopDraggingMarker = useCallback(() => {
    draggingMarkerIdRef.current = null;
    setDraggingMarkerId(null);
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getInitialRoute());
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (route.name !== "track") {
      return;
    }

    if (currentTrackId === route.trackId && audioSource) {
      return;
    }

    loadTrackFromLibrary(route.trackId);
  }, [audioSource, currentTrackId, loadTrackFromLibrary, route]);

  useEffect(() => {
    if (!currentTrackId || loadState !== "ready") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsSavingMarkers(true);

      void fetch(`/api/tracks/${encodeURIComponent(currentTrackId)}/markers`, {
        body: JSON.stringify({
          markers: sortedMarkers.map((marker) => ({
            id: marker.id,
            label: marker.label.trim() || "Marker",
            time: marker.time
          }))
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      })
        .then((response) =>
          parseJsonResponse(response, "マーカーを保存できませんでした。")
        )
        .then(parseTrackResponse)
        .then(updateLibraryTrack)
        .catch((error: unknown) => {
          setMessage(
            error instanceof Error
              ? error.message
              : "マーカーを保存できませんでした。"
          );
        })
        .finally(() => {
          setIsSavingMarkers(false);
        });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentTrackId, loadState, sortedMarkers, updateLibraryTrack]);

  useEffect(() => {
    const moveDraggedMarker = (clientX: number) => {
      const markerId = draggingMarkerIdRef.current;

      if (markerId) {
        moveMarkerFromPointer(markerId, clientX);
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingMarkerIdRef.current) {
        return;
      }

      event.preventDefault();
      moveDraggedMarker(event.clientX);
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingMarkerIdRef.current) {
        return;
      }

      event.preventDefault();
      moveDraggedMarker(event.clientX);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDraggingMarker);
    window.addEventListener("pointercancel", stopDraggingMarker);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDraggingMarker);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDraggingMarker);
      window.removeEventListener("pointercancel", stopDraggingMarker);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDraggingMarker);
    };
  }, [moveMarkerFromPointer, stopDraggingMarker]);

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
    if (route.name !== "track") {
      return undefined;
    }

    const shortcutListenerOptions = { capture: true } as const;

    window.addEventListener("keydown", handleShortcut, shortcutListenerOptions);

    return () => {
      window.removeEventListener(
        "keydown",
        handleShortcut,
        shortcutListenerOptions
      );
    };
  }, [handleShortcut, route.name]);

  useEffect(() => {
    setWaveformStart((currentStart) =>
      keepTimeInWaveformRange(currentTime, duration, waveformZoom, currentStart)
    );
  }, [currentTime, duration, waveformZoom]);

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
  }, [route.name]);

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
    gradient.addColorStop(0, "#00a99d");
    gradient.addColorStop(0.5, "#3a86ff");
    gradient.addColorStop(1, "#ff6b4a");

    context.fillStyle = "rgba(255, 255, 255, 0.035)";
    context.fillRect(0, 0, cssWidth, cssHeight);

    if (peaks.length === 0) {
      context.fillStyle = "rgba(244, 247, 245, 0.18)";
      context.fillRect(0, cssHeight / 2 - 1, cssWidth, 2);
      return;
    }

    const centerY = cssHeight / 2;
    const hasTimeline = duration > 0 && waveformRange.end > waveformRange.start;
    const startIndex = hasTimeline
      ? Math.max(
          0,
          Math.floor((waveformRange.start / duration) * peaks.length)
        )
      : 0;
    const endIndex = hasTimeline
      ? Math.min(
          peaks.length,
          Math.max(
            startIndex + 1,
            Math.ceil((waveformRange.end / duration) * peaks.length)
          )
        )
      : peaks.length;
    const visiblePeaks = peaks.slice(startIndex, endIndex);
    const barWidth = Math.max(1, cssWidth / visiblePeaks.length);

    context.fillStyle = gradient;

    for (let index = 0; index < visiblePeaks.length; index += 1) {
      const peak = visiblePeaks[index];
      const min = Math.min(0, peak.min);
      const max = Math.max(0, peak.max);
      const x = index * barWidth;
      const y = centerY - max * centerY;
      const barHeight = Math.max(1, (max - min) * centerY);

      context.fillRect(x, y, Math.max(1, barWidth * 0.82), barHeight);
    }
  }, [duration, peaks, route.name, waveformRange, waveformSize]);

  return (
    <main
      className={cn(
        "grid min-h-screen content-start gap-4 p-5 max-sm:gap-3 max-sm:p-3",
        route.name === "library"
          ? "grid-rows-[auto_minmax(0,1fr)]"
          : "grid-rows-[auto_minmax(0,1fr)_auto]"
      )}
    >
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

      <Surface
        as="header"
        className="flex min-h-[82px] items-center justify-between gap-4 rounded-[2rem] p-4 max-lg:flex-col max-lg:items-stretch"
      >
        <button
          className="flex min-w-60 items-center gap-3 rounded-full bg-white/[0.03] p-1.5 pr-5 text-left transition hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal max-lg:w-full"
          type="button"
          title="ライブラリへ"
          onClick={navigateToLibrary}
        >
          <span className="grid size-11 place-items-center rounded-full border border-teal/30 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.38),transparent_30%),linear-gradient(135deg,rgba(67,224,202,0.95),rgba(122,167,255,0.72))] text-base font-black text-[#061210] shadow-[0_14px_36px_rgba(67,224,202,0.2)]">
            M
          </span>
          <span className="grid min-w-0 gap-1">
            <h1 className="m-0 text-xl font-semibold leading-none text-ink">
              Mimicopy
            </h1>
            <span className="truncate text-sm text-muted max-sm:whitespace-normal">
              {route.name === "track" && currentTrack
                ? `${currentTrack.title} ・ ${
                    isSavingMarkers ? "マーカー保存中" : "保存済み"
                  }`
                : "保存済みMP3ライブラリ"}
            </span>
          </span>
        </button>

        {route.name === "library" ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3 max-lg:w-full max-lg:flex-col max-lg:items-stretch">
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="audio/mpeg,.mp3"
              onChange={handleFileChange}
            />
            <Button
              title="MP3を選択"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <Upload size={18} />
              )}
              <span>{isUploading ? "保存中" : "MP3"}</span>
            </Button>

            <form
              className="grid h-11 min-w-[300px] max-w-[680px] flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] py-0 pl-4 pr-1 transition-[background,border-color,box-shadow] focus-within:border-teal/55 focus-within:bg-white/[0.09] focus-within:shadow-[0_0_0_4px_rgba(67,224,202,0.1)] max-lg:w-full max-lg:min-w-0"
              onSubmit={handleYoutubeSubmit}
            >
              <label className="sr-only" htmlFor="youtube-url">
                YouTube URL
              </label>
              <Link className="text-muted" size={18} aria-hidden="true" />
              <input
                id="youtube-url"
                className="min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-quiet"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
              />
              <IconButton
                type="submit"
                title="YouTubeを変換"
                disabled={isConverting}
              >
                {isConverting ? (
                  <LoaderCircle className="animate-spin" size={18} />
                ) : (
                  <Plus size={18} />
                )}
              </IconButton>
            </form>
          </div>
        ) : (
          <Button title="ライブラリへ戻る" onClick={navigateToLibrary}>
            <ArrowLeft size={18} />
            <span>Library</span>
          </Button>
        )}
      </Surface>

      {route.name === "library" ? (
        <Surface
          className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[2.25rem]"
          aria-label="Saved MP3 library"
        >
          <SectionHeader
            title="Library"
            description={`${libraryTracks.length} saved MP3s`}
            action={
              <IconButton
                title="一覧を更新"
                disabled={isLibraryLoading}
                onClick={loadLibrary}
              >
                {isLibraryLoading ? (
                  <LoaderCircle className="animate-spin" size={18} />
                ) : (
                  <RefreshCcw size={18} />
                )}
              </IconButton>
            }
          />

          <div className="mx-4 mb-1 mt-4 grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-full border border-white/8 bg-white/[0.045] px-3 text-sm text-muted max-sm:grid-cols-1 max-sm:items-start max-sm:rounded-3xl max-sm:px-3 max-sm:py-3">
            <StatusBadge state={loadState}>{loadState}</StatusBadge>
            <span className="min-w-0 truncate">{message}</span>
          </div>

          <div className="min-h-0 overflow-auto p-4">
            {libraryTracks.length === 0 ? (
              <div className="grid min-h-[360px] place-items-center content-center gap-4 rounded-[2rem] border border-dashed border-white/14 bg-[radial-gradient(circle_at_50%_0%,rgba(67,224,202,0.12),transparent_36%),rgba(255,255,255,0.035)] text-center text-quiet">
                <span className="grid size-16 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-teal">
                  <ListMusic size={24} aria-hidden="true" />
                </span>
                <span className="text-sm">
                  {isLibraryLoading
                    ? "読み込み中"
                    : "保存済みMP3はまだありません"}
                </span>
              </div>
            ) : (
              libraryTracks.map((track) => (
                <div
                  key={track.id}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-stretch overflow-hidden rounded-[1.75rem] border border-white/8 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-[background,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.075] hover:shadow-tight [&+&]:mt-3",
                    track.id === currentTrackId &&
                      "border-teal/45 bg-teal/12 shadow-[0_18px_44px_rgba(67,224,202,0.1)]"
                  )}
                >
                  <button
                    className="grid min-w-0 grid-cols-[44px_minmax(220px,1fr)_96px_90px_112px_148px] items-center gap-3 bg-transparent px-4 py-4 text-left text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue max-[1040px]:grid-cols-[44px_minmax(180px,1fr)_90px_86px_108px] max-[1040px]:[&>span:nth-of-type(6)]:hidden max-lg:grid-cols-[44px_minmax(0,1fr)] max-lg:[&>span:nth-of-type(n+3)]:hidden"
                    type="button"
                    title={`${track.title} を開く`}
                    onClick={() => navigateToTrack(track.id)}
                  >
                    <span className="grid size-11 place-items-center rounded-2xl bg-teal/12 text-teal">
                      <Music2 size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-base font-semibold leading-tight text-ink">
                        {track.title}
                      </strong>
                    </span>
                    <span className="truncate">{getSourceTypeLabel(track.sourceType)}</span>
                    <span className="truncate">{formatTime(track.duration)}</span>
                    <span className="truncate">{track.markerCount} markers</span>
                    <span className="truncate">
                      Updated {formatLibraryDate(track.updatedAt)}
                    </span>
                  </button>
                  <IconButton
                    className="m-2 self-center"
                    variant="danger"
                    title="保存済みMP3を削除"
                    onClick={() => deleteTrackFromLibrary(track.id)}
                  >
                    <Trash2 size={17} />
                  </IconButton>
                </div>
              ))
            )}
          </div>
        </Surface>
      ) : (
        <>
          <Surface
            className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[2.25rem]"
            aria-label="Audio editor"
          >
            <SectionHeader
              title={currentTrack?.title ?? "曲を読み込み中"}
              description={isSavingMarkers ? "マーカー保存中" : message}
              action={
                <span className="whitespace-nowrap text-sm font-bold tabular-nums text-ink">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              }
            />

            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,390px)] items-stretch gap-4 p-4 max-lg:grid-cols-1">
              <section
                className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-white/8 bg-white/[0.04]"
                aria-label="Waveform"
              >
                <div className="mx-3 mt-3 grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-full border border-white/8 bg-black/18 px-3 text-sm text-muted max-sm:grid-cols-1 max-sm:items-start max-sm:rounded-3xl max-sm:px-3 max-sm:py-3">
                  <StatusBadge state={loadState}>{loadState}</StatusBadge>
                  <span className="min-w-0 truncate">{message}</span>
                  <span className="whitespace-nowrap font-bold tabular-nums text-ink">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div
                  ref={waveformRef}
                  className="waveformSurface relative m-3 h-[clamp(320px,48vh,580px)] min-h-0 cursor-crosshair overflow-hidden rounded-[1.75rem] border border-white/8 bg-[radial-gradient(circle_at_15%_10%,rgba(67,224,202,0.16),transparent_24%),radial-gradient(circle_at_85%_90%,rgba(255,138,101,0.12),transparent_25%),linear-gradient(rgba(244,247,245,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(244,247,245,0.045)_1px,transparent_1px),linear-gradient(180deg,#111816_0%,#070908_100%)] bg-[length:auto,auto,100%_25%,84px_100%,auto] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[1.75rem] after:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_34%,rgba(0,0,0,0.18))] focus-visible:shadow-[inset_0_0_0_2px_rgba(122,167,255,0.72)] max-sm:h-[clamp(240px,42vh,380px)]"
                  role="slider"
                  aria-label="再生位置"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0, Math.floor(duration))}
                  aria-valuenow={Math.floor(currentTime)}
                  tabIndex={0}
                  onPointerDown={handleWaveformPointerDown}
                >
                  <canvas ref={canvasRef} className="block size-full" />
                  {visibleMarkers.map((marker) => {
                    const markerLeft = `${timeToWaveformPercent(
                      marker.time,
                      waveformRange
                    )}%`;
                    const style: DynamicStyle = {
                      "--marker-left": markerLeft,
                      "--playhead-left": "0%"
                    };

                    return (
                      <button
                        key={marker.id}
                        className={cn(
                          "markerLine absolute inset-y-0 left-[var(--marker-left)] z-20 w-3 cursor-ew-resize touch-none border-0 border-l-2 border-coral bg-transparent p-0 before:absolute before:left-[-7px] before:top-4 before:size-3 before:rotate-45 before:rounded-[3px] before:border-2 before:border-[#07100f] before:bg-coral before:shadow-[0_10px_24px_rgba(255,138,101,0.28)] hover:border-blue hover:before:bg-blue focus-visible:border-blue focus-visible:outline-none focus-visible:before:bg-blue",
                          marker.id === selectedMarkerId &&
                            "border-coral before:bg-coral",
                          marker.id === draggingMarkerId &&
                            "border-ink before:bg-ink"
                        )}
                        draggable
                        style={style}
                        type="button"
                        title={`${marker.label} ${formatTime(marker.time)}`}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", marker.id);
                          setSelectedMarkerId(marker.id);
                          startDraggingMarker(marker.id);
                          moveMarkerFromPointer(marker.id, event.clientX);
                        }}
                        onDrag={(event) => {
                          if (
                            draggingMarkerIdRef.current !== marker.id ||
                            event.clientX <= 0
                          ) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          moveMarkerFromPointer(marker.id, event.clientX);
                        }}
                        onDragEnd={(event) => {
                          event.stopPropagation();

                          if (event.clientX > 0) {
                            moveMarkerFromPointer(marker.id, event.clientX);
                          }

                          stopDraggingMarker();
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          setSelectedMarkerId(marker.id);
                          startDraggingMarker(marker.id);
                          event.currentTarget.setPointerCapture(event.pointerId);
                          moveMarkerFromPointer(marker.id, event.clientX);
                        }}
                        onPointerMove={(event) => {
                          if (draggingMarkerIdRef.current !== marker.id) {
                            return;
                          }

                          event.stopPropagation();
                          moveMarkerFromPointer(marker.id, event.clientX);
                        }}
                        onPointerUp={(event) => {
                          event.stopPropagation();
                          stopDraggingMarker();

                          if (
                            event.currentTarget.hasPointerCapture(
                              event.pointerId
                            )
                          ) {
                            event.currentTarget.releasePointerCapture(
                              event.pointerId
                            );
                          }
                        }}
                        onPointerCancel={(event) => {
                          stopDraggingMarker();

                          if (
                            event.currentTarget.hasPointerCapture(
                              event.pointerId
                            )
                          ) {
                            event.currentTarget.releasePointerCapture(
                              event.pointerId
                            );
                          }
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedMarkerId(marker.id);
                          seekTo(marker.time);
                        }}
                      />
                    );
                  })}
                  <div
                    className="pointer-events-none absolute inset-y-0 left-[var(--playhead-left)] z-30 w-0.5 bg-teal shadow-[0_0_0_1px_rgba(7,16,15,0.78),0_0_24px_rgba(67,224,202,0.48)]"
                    style={playheadStyle}
                  />
                </div>
              </section>

              <aside
                className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-white/8 bg-white/[0.04] max-lg:min-h-[330px]"
                aria-label="Markers"
              >
                <SectionHeader
                  title="Markers"
                  description={selectedMarker ? selectedMarker.label : "No selection"}
                  action={
                    <IconButton
                      title="選択マーカーへ戻る"
                      disabled={sortedMarkers.length === 0}
                      onClick={returnToMarker}
                    >
                      <RotateCcw size={18} />
                    </IconButton>
                  }
                />

                <div className="mx-3 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[1.5rem] border border-white/8 bg-black/18 p-2.5 focus-within:border-teal/55 focus-within:shadow-[0_0_0_4px_rgba(67,224,202,0.1)] max-sm:grid-cols-1">
                  <MapPin className="text-muted" size={18} aria-hidden="true" />
                  <label className="sr-only" htmlFor="marker-time">
                    Marker time
                  </label>
                  <TextInput
                    id="marker-time"
                    value={markerInput}
                    onChange={(event) => setMarkerInput(event.target.value)}
                    placeholder="1:23"
                  />
                  <IconButton
                    title="現在位置を入力"
                    onClick={() => setMarkerInput(formatTime(currentTime))}
                  >
                    <Clock3 size={18} />
                  </IconButton>
                  <IconButton
                    variant="accent"
                    title="入力時刻にマーカー追加"
                    disabled={!audioSource}
                    onClick={addMarkerFromInput}
                  >
                    <Plus size={18} />
                  </IconButton>
                </div>

                <div className="min-h-0 overflow-auto p-3">
                  {sortedMarkers.length === 0 ? (
                    <div className="grid min-h-32 place-items-center rounded-[1.5rem] border border-dashed border-white/14 bg-white/[0.035] text-center text-quiet">
                      No markers
                    </div>
                  ) : (
                    sortedMarkers.map((marker) => (
                      <div
                        key={marker.id}
                        className={cn(
                          "mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[1.5rem] border border-white/8 bg-white/[0.055] transition-[background,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.075] hover:shadow-tight max-sm:grid-cols-1",
                          marker.id === selectedMarkerId &&
                            "border-coral/45 bg-coral/12"
                        )}
                      >
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_80px] items-center gap-2 py-2 pl-2 max-sm:grid-cols-1 max-sm:p-2">
                          <TextInput
                            aria-label={`${marker.label} label`}
                            className="markerLabelInput"
                            value={marker.label}
                            onBlur={() => finishRenamingMarker(marker.id)}
                            onChange={(event) =>
                              renameMarker(marker.id, event.target.value)
                            }
                          />
                          <TextInput
                            aria-label={`${marker.label} time`}
                            className="markerTimeInput text-right tabular-nums"
                            inputMode="numeric"
                            value={
                              markerTimeDrafts[marker.id] ??
                              formatTime(marker.time)
                            }
                            onBlur={() => finishMarkerTimeInput(marker.id)}
                            onChange={(event) =>
                              changeMarkerTimeInput(marker.id, event.target.value)
                            }
                          />
                        </div>
                        <IconButton
                          className="max-sm:w-full"
                          title="マーカーへ移動"
                          onClick={() => {
                            setSelectedMarkerId(marker.id);
                            seekTo(marker.time);
                          }}
                        >
                          <MapPin size={17} />
                        </IconButton>
                        <IconButton
                          className="mr-2 max-sm:mx-2 max-sm:mb-2 max-sm:w-auto"
                          variant="danger"
                          title="マーカー削除"
                          onClick={() => deleteMarker(marker.id)}
                        >
                          <Trash2 size={17} />
                        </IconButton>
                      </div>
                    ))
                  )}
                </div>
              </aside>
            </div>
          </Surface>

          <Surface
            as="footer"
            className="flex min-h-[76px] items-center justify-between gap-4 rounded-full px-4 py-3 max-xl:rounded-[2rem] max-lg:flex-col max-lg:items-stretch"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                size="transport"
                variant="primary"
                title={isPlaying ? "停止" : "再生"}
                disabled={!audioSource}
                onClick={togglePlayback}
              >
                {isPlaying ? <Pause size={21} /> : <Play size={21} />}
                <span>{isPlaying ? "停止" : "再生"}</span>
              </Button>
              <Button
                size="transport"
                title="5秒戻る"
                disabled={!audioSource}
                onClick={() => seekTo(seekBy(currentTime, -5, duration))}
              >
                <span>-5s</span>
              </Button>
              <Button
                size="transport"
                title="5秒進む"
                disabled={!audioSource}
                onClick={() => seekTo(seekBy(currentTime, 5, duration))}
              >
                <span>+5s</span>
              </Button>
              <Button
                size="transport"
                title="10秒戻る"
                disabled={!audioSource}
                onClick={() => seekTo(seekBy(currentTime, -10, duration))}
              >
                <span>-10s</span>
              </Button>
              <Button
                size="transport"
                title="10秒進む"
                disabled={!audioSource}
                onClick={() => seekTo(seekBy(currentTime, 10, duration))}
              >
                <span>+10s</span>
              </Button>
              <Button
                size="transport"
                variant="accent"
                title="現在位置にマーカー追加"
                disabled={!audioSource}
                onClick={() => addMarkerAt(currentTime)}
              >
                <MapPin size={18} />
                <span>Marker</span>
              </Button>
            </div>

            <div
              className="flex min-w-44 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:justify-start"
              aria-label="Waveform zoom"
            >
              <ZoomOut className="text-muted" size={18} aria-hidden="true" />
              <IconButton
                title="波形を縮小"
                disabled={waveformZoom === 1}
                onClick={() => changeWaveformZoom("out")}
              >
                <ZoomOut size={17} />
              </IconButton>
              <strong className="min-w-11 text-center tabular-nums text-ink">
                {waveformZoom}x
              </strong>
              <IconButton
                title="波形を拡大"
                disabled={waveformZoom === 16}
                onClick={() => changeWaveformZoom("in")}
              >
                <ZoomIn size={17} />
              </IconButton>
            </div>

            <div
              className="flex min-w-44 items-center justify-end gap-2 rounded-full border border-white/8 bg-white/[0.04] p-1 max-lg:w-full max-lg:justify-start"
              aria-label="Playback speed"
            >
              <Gauge className="text-muted" size={18} aria-hidden="true" />
              <IconButton
                title="速度を下げる"
                onClick={() =>
                  setPlaybackRate((currentRate) =>
                    nextPlaybackRate(currentRate, "slower")
                  )
                }
              >
                <span>,</span>
              </IconButton>
              <strong className="min-w-11 text-center tabular-nums text-ink">
                {playbackRate}x
              </strong>
              <IconButton
                title="速度を上げる"
                onClick={() =>
                  setPlaybackRate((currentRate) =>
                    nextPlaybackRate(currentRate, "faster")
                  )
                }
              >
                <span>.</span>
              </IconButton>
            </div>
          </Surface>
        </>
      )}
    </main>
  );
}
