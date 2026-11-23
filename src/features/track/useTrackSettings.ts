import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router";
import { readTrackSettings, writeTrackSettings, type TrackSettings } from "../../lib/trackSettings";

export function useTrackSettings() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastSearch = useRef(location.search);
  const [draft, setDraft] = useState(() => ({
    settings: readTrackSettings(location.search),
    edited: false
  }));

  useLayoutEffect(() => {
    if (location.search === lastSearch.current) return;
    lastSearch.current = location.search;
    setDraft({ settings: readTrackSettings(location.search), edited: false });
  }, [location.search]);

  useEffect(() => {
    if (!draft.edited) return;
    const search = writeTrackSettings(location.search, draft.settings);
    if (search === location.search) return;

    // Keep sliders and pinch zoom responsive while grouping URL writes during a gesture.
    const timer = window.setTimeout(() => {
      lastSearch.current = search;
      void navigate({ pathname: location.pathname, search, hash: location.hash }, {
        replace: true, state: location.state
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, location, navigate]);

  const setters = useMemo(() => {
    const setter = <Key extends keyof TrackSettings>(key: Key) =>
      (action: SetStateAction<TrackSettings[Key]>) => {
        setDraft((current) => {
          const previous = current.settings[key];
          const value = typeof action === "function" ? action(previous) : action;
          if (value === previous) return current;
          return { settings: { ...current.settings, [key]: value }, edited: true };
        });
      };

    return {
      setChannels: setter("channels"),
      setPlaybackRate: setter("playbackRate"),
      setSemitones: setter("semitones"),
      setWaveformZoom: setter("waveformZoom")
    };
  }, []);

  return { ...draft.settings, ...setters };
}
