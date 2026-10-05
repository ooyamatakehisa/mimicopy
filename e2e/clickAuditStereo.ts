type StereoWindow = { startFrame: number; endFrame: number; beatIndex?: number | null };

/** The fixture and click are duplicated stereo; the pitch DSP need not be bit-identical. */
export function assessClickAuditStereo(channel: "native" | "music" | "click", left: Float32Array, right: Float32Array,
  sampleRate: number, windows: StereoWindow[] = []) {
  const limits = { minimumCorrelation: .99999, maximumRmsRatioError: .001, maximumPulseCentroidLagMs: 1 };
  const measure = (startFrame: number, endFrame: number) => {
    let leftEnergy = 0, rightEnergy = 0, cross = 0, leftWeighted = 0, rightWeighted = 0, maximumDifference = 0;
    for (let frame = startFrame; frame < endFrame; frame++) {
      const l = left[frame], r = right[frame];
      leftEnergy += l * l; rightEnergy += r * r; cross += l * r;
      leftWeighted += frame * l * l; rightWeighted += frame * r * r;
      maximumDifference = Math.max(maximumDifference, Math.abs(l - r));
    }
    return { maximumDifference, leftEnergy, rightEnergy,
      correlation: leftEnergy && rightEnergy ? cross / Math.sqrt(leftEnergy * rightEnergy) : null,
      rmsRatio: leftEnergy ? Math.sqrt(rightEnergy / leftEnergy) : null,
      centroidRightMinusLeftMs: leftEnergy && rightEnergy ? (rightWeighted / rightEnergy - leftWeighted / leftEnergy) / sampleRate * 1000 : null };
  };
  const total = measure(0, left.length);
  const pulses = windows.map((window) => ({ ...window, ...measure(window.startFrame, window.endFrame) }));
  const failures: string[] = [];
  if (channel !== "music") {
    if (total.maximumDifference !== 0) failures.push(`Duplicated-stereo ${channel} PCM is not the exact left/right copy promised by the fixture/click synthesizer.`);
  } else {
    const invalid = (measurement: typeof total, requireCentroid: boolean) => {
      if (!measurement.leftEnergy && !measurement.rightEnergy) return false;
      return measurement.correlation === null || measurement.correlation < limits.minimumCorrelation ||
        measurement.rmsRatio === null || Math.abs(measurement.rmsRatio - 1) > limits.maximumRmsRatioError ||
        requireCentroid && (measurement.centroidRightMinusLeftMs === null || Math.abs(measurement.centroidRightMinusLeftMs) > limits.maximumPulseCentroidLagMs);
    };
    if (invalid(total, false)) failures.push("Duplicated-stereo music has a missing side, different level, or incoherent waveform.");
    for (const pulse of pulses) if (invalid(pulse, true)) failures.push(`Duplicated-stereo music beat ${pulse.beatIndex ?? "unknown"} has incompatible channel level/phase or >1ms centroid delay.`);
  }
  return { channel, method: channel === "music"
    ? "Music pitch processing may introduce tiny sample differences. Require >=0.99999 zero-lag correlation, RMS ratio within0.1%, and <=1ms per-identified-pulse energy-centroid difference; keep maximum sample residual as diagnostic. These independent level/coherence/timing limits are calibrated against missing/delayed/attenuated right output and bounded numerical noise."
    : "Exact equality for duplicated native fixture channels and the click processor's copied stereo output.", limits, total, pulses, failures };
}
