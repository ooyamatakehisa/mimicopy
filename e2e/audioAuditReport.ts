import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { evaluateAudioAudit } from "./audioAuditGate";
import type { AudioMeasurement } from "./audioAuditSignal";

type Case = {
  category: string; name: string; mask: number; rate: number; uiMask: number;
  expectedAudible: boolean[]; maxClockSpreadMs: number; signal: AudioMeasurement;
  issues: string[];
};
type Report = {
  protocol?: string;
  runId: string; startedAt: string; finishedAt: string; complete: boolean;
  suiteFinished: boolean; userAgent: string; errors: string[]; cases: Case[];
};
const directory = path.resolve(process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT ?? "audio-audit.local/manual");
const files = (await readdir(directory)).filter((file) => file.endsWith(".json") && !file.startsWith("edge-") && !file.includes("keyboard") && !file.includes("calibration") && !file.includes("summary"));
const reports = await Promise.all(files.map(async (file) => ({ file, report: JSON.parse(await readFile(path.join(directory, file), "utf8")) as Report })));
type Edge = { engine: string; id: string; runId: string; outcome: string; reason: string | null;
  observations: { name: string; measured: boolean; measurementError: string | null; checks: Record<string, unknown> }[] };
const edgeFiles = (await readdir(directory)).filter((file) => file.startsWith("edge-summary-") && file.endsWith(".json"));
const edges = (await Promise.all(edgeFiles.map(async (file) => {
  const parsed = JSON.parse(await readFile(path.join(directory, file), "utf8")) as { results: Edge[] };
  return parsed.results.map((result) => ({ file, ...result }));
}))).flat();
const keyboardFiles = (await readdir(directory)).filter((file) => file.endsWith("-keyboard.json"));
const keyboards = await Promise.all(keyboardFiles.map(async (file) => {
  const entries = JSON.parse(await readFile(path.join(directory, file), "utf8")) as { toggled: boolean }[];
  return { file, cases: entries.length, activatedButton: entries.filter((entry) => entry.toggled).length };
}));
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
const natural = (entry: Case) => !["injected-drift", "end"].includes(entry.category);
const corroboratedOutputMismatch = (entry: Case) => (["original", "stem", "remainder"] as const).some((id, index) => {
  const source = entry.signal.rms[id];
  const output = entry.signal.mixedToneRms[id];
  return entry.expectedAudible[index] ? source < 0.0005 && output < 0.0005 : source > 0.00015 && output > 0.00015;
});
const summarize = (report: Report) => {
  const categories: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};
  for (const entry of report.cases) {
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    for (const issue of entry.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
  }
  const signalPairs = report.cases.filter(natural).flatMap((entry) => entry.signal.pairs
    .filter((pair) => pair.lagMs !== null).map((pair) => ({ case: entry.name, pair: `${pair.first}/${pair.second}`, lagMs: pair.lagMs })));
  const significantPairs = signalPairs.filter((pair) => Math.abs(pair.lagMs ?? 0) > 20);
  const coverageErrors: string[] = [];
  if (report.suiteFinished && categories["state-matrix"]) {
    const matrix = report.cases.filter((entry) => entry.category === "state-matrix");
    if (matrix.length !== 256 || new Set(matrix.map((entry) => `${entry.rate}:${entry.mask}`)).size !== 256) coverageErrors.push("Incomplete 64-state/four-speed matrix");
    const transitions = report.cases.filter((entry) => entry.category === "button-transition");
    if (transitions.length !== 384 || new Set(transitions.map((entry) => entry.name)).size !== 384) coverageErrors.push("Incomplete 384 directed button transitions");
    for (const category of ["paused-state", "resume-state", "seek-state"]) {
      if (new Set(report.cases.filter((entry) => entry.category === category).map((entry) => entry.mask)).size !== 64) coverageErrors.push(`Incomplete ${category} matrix`);
    }
    if (report.cases.length !== 852) coverageErrors.push("Expected 852 full-run captures");
  }
  if (report.suiteFinished && categories["long-state-sync"]) {
    const longStates = report.cases.filter((entry) => entry.category === "long-state-sync");
    if (longStates.length !== 56 || new Set(longStates.map((entry) => `${entry.rate}:${entry.mask}`)).size !== 56) coverageErrors.push("Incomplete 14-state/four-speed long capture matrix");
    if (categories["volume-slider"] !== 15 || categories["rapid-play-pause"] !== 2) coverageErrors.push("Incomplete supplementary slider or transport matrix");
  }
  return {
    gate: evaluateAudioAudit(report),
    runId: report.runId, completed: report.complete && report.suiteFinished && !coverageErrors.length, cases: report.cases.length,
    categories, issueCounts, errors: report.errors, coverageErrors,
    outputMismatchCases: report.cases.filter((entry) => entry.issues.some((issue) => /unexpected-output|missing-output/.test(issue))).length,
    corroboratedOutputMismatchCases: report.cases.filter(corroboratedOutputMismatch).length,
    wrongUiCases: report.cases.filter((entry) => entry.mask !== entry.uiMask).length,
    wrongRateCases: report.cases.filter((entry) => entry.issues.some((issue) => issue.includes("wrong-playback-rate"))).length,
    naturalMaxClockSpreadMs: Math.max(0, ...report.cases.filter(natural).map((entry) => entry.maxClockSpreadMs)),
    measuredSignalPairs: signalPairs.length, significantSignalPairs: significantPairs,
    maxMeasuredSignalLagMs: signalPairs.length ? Math.max(...signalPairs.map((pair) => Math.abs(pair.lagMs ?? 0))) : null
  };
};
const summary = {
  generatedAt: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceModified: execFileSync("git", ["diff", "--name-only", "--", "src"], { encoding: "utf8" }).trim(),
  reports: reports.map(({ report }) => summarize(report)), keyboards, edges
};
await writeFile(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2));

const sections = reports.map(({ file, report }) => {
  const totals = summarize(report);
  const categories = Object.entries(totals.categories).map(([key, count]) => `<span>${escape(key)}: ${count}</span>`).join(" · ");
  const rows = report.cases.map((entry) => {
    const path = `/${entry.category}/${entry.name.replace("after rapid 48 toggles", "after rapid 48 state assignments")}/`;
    const gateIssues = [...totals.gate.failures, ...totals.gate.inconclusive]
      .filter((issue) => issue.key.includes(path)).map((issue) => issue.reason);
    const issues = [...new Set([...entry.issues, ...gateIssues])];
    const level = (channel: "original" | "stem" | "remainder") => entry.signal.mixedToneRms[channel].toFixed(6);
    const lags = entry.signal.pairs.map((pair) => `${pair.first}/${pair.second}: ${pair.lagMs === null ? `未確定 (${pair.confidence})` : `${pair.lagMs.toFixed(1)} ms`}`).join("; ");
    return `<tr data-issue="${issues.length > 0}" data-search="${escape(`${entry.category} ${entry.name} ${issues.join(" ")}`)}"><td>${escape(entry.category)}</td><td>${escape(entry.name)}<br><small>mask ${entry.mask} / UI ${entry.uiMask}; expected ${entry.expectedAudible.map((audible) => audible ? "ON" : "OFF").join(" / ")}</small></td><td>${level("original")}<br>${level("stem")}<br>${level("remainder")}<br><small>個別音源: ${entry.signal.rms.original.toFixed(6)} / ${entry.signal.rms.stem.toFixed(6)} / ${entry.signal.rms.remainder.toFixed(6)}</small></td><td>${entry.maxClockSpreadMs.toFixed(1)} ms</td><td>${escape(lags)}</td><td>${issues.length ? escape(issues.join(", ")) : "測定項目に異常なし"}</td></tr>`;
  }).join("");
  return `<section><h2>${escape(report.runId)}</h2><p>${totals.completed ? "予定ケース完了" : "未完了"} · ${report.cases.length} ケース · 確認された失敗 ${totals.gate.failures.length} / 判定不能・未完了 ${totals.gate.inconclusive.length} · 出力異常の候補 ${totals.outputMismatchCases}（各音源の波形でも確認 ${totals.corroboratedOutputMismatchCases}） · ボタン不一致 ${totals.wrongUiCases} · 速度不一致 ${totals.wrongRateCases}</p><p><a href="${escape(file)}">全測定データ JSON</a></p><p class="muted">${escape(report.userAgent)}<br>${escape(report.startedAt)} → ${escape(report.finishedAt)}</p><p>${categories}</p>${report.errors.length ? `<pre>${escape(report.errors.join("\n"))}</pre>` : ""}<details><summary>ケースごとの結果</summary><table><thead><tr><th>分類</th><th>操作・期待値</th><th>最終出力RMS<br>原音 / ギター / その他</th><th>再生位置の最大差</th><th>波形の相対遅延</th><th>検出事項</th></tr></thead><tbody>${rows}</tbody></table></details></section>`;
}).join("");
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mimicopy 音声監査</title><style>body{font:15px/1.65 system-ui;background:#f3f6f8;color:#182c37;margin:0;padding:32px;max-width:1800px}h1{font-size:30px}h2{font-size:21px}section{background:white;border:1px solid #d9e2e8;border-radius:12px;padding:24px;margin:24px 0}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #dde5eb;text-align:left;padding:9px;vertical-align:top}th{background:#edf3f7;position:sticky;top:0}tr[data-issue=true]{background:#fff8ee}small,.muted{color:#576975}a{color:#006a72}summary{cursor:pointer;font-weight:700}input{padding:8px}pre{white-space:pre-wrap;background:#fff0ed;padding:16px}</style><h1>Mimicopy 3音源・ソロ／ミュート監査</h1><p>本番アプリのコンポーネント・再生処理を使い、音源とAPIだけを隔離した検証環境で測定。実行時の本番コードをそのまま検証します。</p><p>ソロ／ミュート6ビットの全64状態、4速度で256ケース。1ボタンのオン／オフは全384方向。停止・再開・シークは各64ケース。短いケースは音の有無と再生位置を測定し、波形の同期は長い録音のみで評価しています。</p><p>RMSは最終ミックスを音源別周波数帯で測定。周波数帯の漏れによる誤検出を避けるため、「各音源の波形でも確認」は個別音源のRMSと最終出力の両方が期待に反するケースのみです。波形遅延は共通のAudioContextで録音した転調前の各音源の振幅変化から推定。音が無い場合、相関が不足する場合、探索範囲±250msを超える場合は未確定です。スピーカーやBluetoothの音を録音した結果ではありません。</p><p>判定基準：鳴るべき音のRMS &lt; 0.0005、消えるべき音のRMS &gt; 0.00015を検出。再生位置差と測定できた波形遅延は20ms超を記録。無音の音源の再生位置差だけでは、聴こえる同期ずれとは断定できません。旧方式の個別音源への100msずれ注入は別分類です。新方式は1つの再生時計を持ち、共通シークと左右の音声チャンネルも検証します。</p><p>Revision: <code>${escape(summary.revision)}</code> · <a href="summary.json">集計JSON</a> · <a href="gate-summary.json">厳密な合否・網羅性判定</a> · <a href="signal-calibration.json">測定器の校正</a></p><label><input type="checkbox" id="flagged"> 検出事項のあるケースのみ</label> <input id="filter" placeholder="state-matrix / 0.25x / missing-output" size="45">${sections}<script>function filter(){const only=document.querySelector('#flagged').checked;const text=document.querySelector('#filter').value.toLowerCase();document.querySelectorAll('tbody tr').forEach(row=>row.hidden=(only&&row.dataset.issue!=='true')||!row.dataset.search.toLowerCase().includes(text))}document.querySelector('#flagged').onchange=filter;document.querySelector('#filter').oninput=filter;</script></html>`;
const extra = `<section><h2>実際のキーボード操作</h2>${keyboards.map((entry) => `<p><a href="${escape(entry.file)}">${escape(entry.file)}</a>: ${entry.cases} ケース中、対象ボタンが切り替わったのは ${entry.activatedButton} ケース</p>`).join("")}</section><section><h2>読み込み・エラー・タブ切り替え</h2>${edges.map((edge) => `<details><summary>${escape(edge.engine)} / ${escape(edge.id)}: ${escape(edge.outcome)}</summary><p>${escape(edge.reason ?? "")}</p><a href="${escape(edge.file)}">測定データ</a><pre>${escape(JSON.stringify(edge.observations, null, 2))}</pre></details>`).join("")}</section>`;
await writeFile(path.join(directory, "index.html"), html.replace("<script>function filter", `${extra}<script>function filter`));
console.log(JSON.stringify(summary, null, 2));
