import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useNavigate,
  useParams
} from "react-router";
import { LibraryPage } from "./features/library/LibraryPage";
import { TrackEditorPage } from "./features/track/TrackEditorPage";
import { cn } from "./lib/cn";

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: {
            retry: false
          },
          queries: {
            retry: false
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function AppRoutes() {
  const isTrackRoute = Boolean(useMatch("/tracks/:trackId"));

  return (
    <main
      className={cn(
        "grid min-h-screen content-start gap-4 p-5 max-sm:gap-3 max-sm:p-3",
        isTrackRoute
          ? "grid-rows-[auto_minmax(0,1fr)_auto]"
          : "grid-rows-[auto_minmax(0,1fr)]"
      )}
    >
      <Routes>
        <Route path="/" element={<LibraryRoute />} />
        <Route path="/tracks/:trackId" element={<TrackRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

type LibraryLocationState = {
  activeTrackId?: unknown;
};

function readActiveTrackId(state: unknown) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const { activeTrackId } = state as LibraryLocationState;

  return typeof activeTrackId === "string" ? activeTrackId : null;
}

function LibraryRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTrackId = readActiveTrackId(location.state);

  return (
    <LibraryPage
      activeTrackId={activeTrackId}
      navigateToLibrary={() => navigate("/")}
      navigateToTrack={(trackId) =>
        navigate(`/tracks/${encodeURIComponent(trackId)}`, {
          state: { activeTrackId: trackId }
        })
      }
    />
  );
}

function TrackRoute() {
  const navigate = useNavigate();
  const { trackId } = useParams<"trackId">();

  if (!trackId) {
    return <Navigate to="/" replace />;
  }

  return (
    <TrackEditorPage
      navigateToLibrary={() =>
        navigate("/", {
          state: { activeTrackId: trackId }
        })
      }
      trackId={trackId}
    />
  );
}
