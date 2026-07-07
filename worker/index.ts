import { Container, getContainer } from "@cloudflare/containers";

const BACKEND_INSTANCE_NAME = "mimicopy-backend";

export class MimicopyBackend extends Container {
  defaultPort = 8080;
  sleepAfter = "2h";
}

type Env = {
  ASSETS: Fetcher;
  MIMICOPY_BACKEND: DurableObjectNamespace<MimicopyBackend>;
};

function isBackendRequest(pathname: string) {
  return pathname.startsWith("/api") || pathname.startsWith("/media");
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (isBackendRequest(url.pathname)) {
      const backend = getContainer(env.MIMICOPY_BACKEND, BACKEND_INSTANCE_NAME);

      return backend.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
