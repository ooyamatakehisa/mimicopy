import assert from "node:assert/strict";
import { installAudioAuditProbe, type AudioAuditProbe } from "./audioAuditSignal";

// Topology-only self-check. The unchanged 224-case calibration separately tests
// actual recorder DSP/estimators; this does not claim browser or audio evidence.
type Connection = { destination: GraphNode; output: number; input: number };
class GraphNode {
  readonly connections: Connection[] = [];
  constructor(readonly context: GraphContext) {}
  connect(destination: GraphNode, output = 0, input = 0) {
    if (!this.connections.some((entry) => entry.destination === destination && entry.output === output && entry.input === input)) {
      this.connections.push({ destination, output, input });
    }
    return destination;
  }
  disconnect(destination?: GraphNode | number, output?: number, input?: number) {
    for (let index = this.connections.length - 1; index >= 0; index -= 1) {
      const entry = this.connections[index];
      const selectedOutput = typeof destination === "number" ? destination : output;
      if ((destination === undefined || typeof destination === "number" || entry.destination === destination) &&
          (selectedOutput === undefined || entry.output === selectedOutput) &&
          (input === undefined || entry.input === input)) this.connections.splice(index, 1);
    }
  }
}
class GraphGain extends GraphNode {}
class GraphSplitter extends GraphNode {
  constructor(context: GraphContext, readonly numberOfOutputs: number) { super(context); }
}
class RecorderNode extends GraphNode {
  readonly port = { onmessage: null, postMessage() {} };
}
class GraphContext {
  state: AudioContextState = "running";
  readonly destination = new GraphNode(this);
  readonly audioWorklet = { async addModule() {} };
  createMediaElementSource(_element: { getAttribute(): string; currentSrc: string; src: string }) {
    return new GraphNode(this);
  }
  resume() {}
}

const environment = globalThis as unknown as {
  AudioNode: typeof GraphNode;
  GainNode: typeof GraphGain;
  ChannelSplitterNode: typeof GraphSplitter;
  AudioContext: typeof GraphContext;
  AudioWorkletNode: typeof RecorderNode;
  window: { AudioContext: typeof GraphContext; __audioAuditProbe?: AudioAuditProbe };
};
environment.AudioNode = GraphNode;
environment.GainNode = GraphGain;
environment.ChannelSplitterNode = GraphSplitter;
environment.AudioContext = GraphContext;
environment.AudioWorkletNode = RecorderNode;
environment.window = { AudioContext: GraphContext };
installAudioAuditProbe();
const probe = environment.window.__audioAuditProbe;
assert.ok(probe);
const snapshots = [];
for (const channels of [6, 8] as const) {
  const context = new GraphContext();
  const source = context.createMediaElementSource({
    getAttribute: () => "Original audio", currentSrc: `/fixture.${channels === 8 ? "flac" : "wav"}`, src: ""
  });
  const splitter = new GraphSplitter(context, channels);
  source.connect(splitter);
  const musicGains: GraphGain[] = [];
  const musicEffect = new GraphNode(context);
  const musicOutput = new GraphGain(context);
  for (let index = 0; index < 3; index += 1) {
    const merger = new GraphNode(context);
    splitter.connect(merger, index * 2, 0);
    splitter.connect(merger, index * 2 + 1, 1);
    const gain = new GraphGain(context);
    merger.connect(gain);
    gain.connect(musicEffect);
    musicGains.push(gain);
  }
  musicEffect.connect(musicOutput);
  musicOutput.connect(context.destination);
  let cueMerger: GraphNode | null = null;
  let clickOutput: GraphGain | null = null;
  if (channels === 8) {
    cueMerger = new GraphNode(context);
    const cueProcessor = new GraphNode(context);
    clickOutput = new GraphGain(context);
    splitter.connect(cueMerger, 6, 0);
    splitter.connect(cueMerger, 7, 1);
    cueMerger.connect(cueProcessor);
    cueProcessor.connect(clickOutput);
    clickOutput.connect(context.destination);
  }
  await probe.ready();
  const snapshot = probe.status();
  assert.equal(snapshot.ready, true);
  assert.deepEqual(snapshot.sourceLabels, ["Original audio", "Separated stem audio", "Separated remainder audio"]);
  assert.equal(snapshot.transport?.sharedSourceChannels, channels);
  assert.equal(snapshot.transport?.musicSourceCount, 3);
  assert.equal(snapshot.transport?.cueChannelCount, channels === 8 ? 2 : 0);
  assert.deepEqual(snapshot.transport?.sourceUrls, [`/fixture.${channels === 8 ? "flac" : "wav"}`]);
  assert.equal(snapshot.destinationConnections, channels === 8 ? 2 : 1);
  assert.equal(source.connections.some((entry) => entry.destination instanceof RecorderNode), false);
  musicGains.forEach((gain, index) => {
    const taps = gain.connections.filter((entry) => entry.destination instanceof RecorderNode);
    assert.equal(taps.length, 1);
    assert.equal(taps[0].input, index);
  });
  const finalTapInputs = (node: GraphNode) => node.connections
    .filter((entry) => entry.destination instanceof RecorderNode).map((entry) => entry.input);
  assert.deepEqual(finalTapInputs(musicOutput), [3]);
  if (cueMerger && clickOutput) {
    assert.deepEqual(finalTapInputs(cueMerger), []);
    assert.deepEqual(finalTapInputs(clickOutput), [3], "The click destination is part of the final mix, never a fourth music source.");
  }
  snapshots.push(snapshot);
  context.state = "closed";
}
console.log(JSON.stringify({ method: "Synthetic graph discovery only", snapshots }, null, 2));
