export type ClickAuditPlan = { expected: number; names: string[] };

/** An unrelated recording cannot stand in for a missing named scenario. */
export function assessClickAuditCoverage(plans: ClickAuditPlan[], recordedNames: string[]) {
  const plannedNames = [...new Set(plans.flatMap((plan) => plan.names))];
  const recorded = new Set(recordedNames);
  const missingNames = plannedNames.filter((name) => !recorded.has(name));
  const unspecifiedExpected = plans.reduce((sum, plan) => sum + Math.max(0, plan.expected - new Set(plan.names).size), 0);
  const overlaps = plans.flatMap((plan, index) => plan.names.filter((name) => plans.slice(0, index).some((earlier) => earlier.names.includes(name))));
  return { plannedNames, missingNames, unspecifiedExpected, overlaps: [...new Set(overlaps)],
    expected: plannedNames.length + unspecifiedExpected, missing: missingNames.length + unspecifiedExpected,
    extraNames: recordedNames.filter((name) => !plannedNames.includes(name)) };
}

/** Native names and desktop plans are disjoint; never hide either missing scope. */
export function summarizeClickAuditCoverage({ missingDesktop, expectedNativeNames, recordedNames, expectedTotal, recordedTotal }: {
  missingDesktop: number;
  expectedNativeNames: string[];
  recordedNames: string[];
  expectedTotal: number | null;
  recordedTotal: number;
}) {
  const plannedNativeNames = [...new Set(expectedNativeNames)];
  const recorded = new Set(recordedNames);
  const missingNativeNames = plannedNativeNames.filter((name) => !recorded.has(name));
  const missingNative = missingNativeNames.length;
  const missing = missingDesktop + missingNative;
  // A count-only deficit beyond already identified missing cases has no name;
  // retain it separately instead of counting those named cases a second time.
  const unnamedMissing = expectedTotal === null ? 0 : Math.max(0, expectedTotal - recordedTotal - missing);
  return { missingDesktop, missingNative, missing, unnamedMissing, missingNativeNames,
    totalCountMismatch: expectedTotal !== null && recordedTotal !== expectedTotal };
}
