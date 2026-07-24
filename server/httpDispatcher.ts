import { Agent, setGlobalDispatcher } from "undici";

let dispatcher: Agent | null = null;

export function installGlobalHttpDispatcher() {
  // Node 24.18's bundled Undici can terminate the process when a peer sends
  // FIN while a response body is paused by backpressure (nodejs/undici#5360).
  // The standalone Undici dispatcher includes the upstream parser fix.
  dispatcher ??= new Agent();
  setGlobalDispatcher(dispatcher);
}
