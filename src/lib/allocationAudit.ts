export type AllocationAuditDuty = {
  id: string;
  driverName?: string | null;
  vehicleId?: string | null;
  pickupTime?: string | null;
  finishTime?: string | null;
  leaveTime?: string | null;
  returnArrivalTime?: string | null;
  calculatedReturnPositionTime?: string | null;
  calculatedNextArrivalTime?: string | null;
};

export type AllocationIssue = {
  id: string;
  kind: "MISSING_DRIVER" | "MISSING_VEHICLE" | "DRIVER_OVERLAP" | "VEHICLE_OVERLAP" | "MISSING_TIME";
  severity: "FAIL" | "WARN";
  dutyIds: string[];
  resource: string;
  message: string;
};

type Interval = { duty: AllocationAuditDuty; start: number; end: number };

function clockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\\d{1,2}):(\\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function intervalFor(duty: AllocationAuditDuty): Interval | null {
  const start = clockMinutes(duty.pickupTime);
  const finish = clockMinutes(
    duty.finishTime ??
    duty.calculatedReturnPositionTime ??
    duty.returnArrivalTime ??
    duty.leaveTime
  );
  if (start === null || finish === null) return null;
  return { duty, start, end: finish < start ? finish + 1440 : finish };
}

/**
 * Audits the current allocation for missing assignments and overlapping
 * driver/vehicle commitments. This is a planning-integrity check, not a
 * replacement for the statutory drivers' hours or WTD engine.
 */
export function auditAllocations(duties: AllocationAuditDuty[]): AllocationIssue[] {
  const issues: AllocationIssue[] = [];
  const intervals: Interval[] = [];

  for (const duty of duties) {
    if (!duty.driverName?.trim()) {
      issues.push({
        id: `missing-driver-${duty.id}`, kind: "MISSING_DRIVER", severity: "FAIL",
        dutyIds: [duty.id], resource: "Driver not assigned",
        message: "No driver is assigned to this duty."
      });
    }
    if (!duty.vehicleId?.trim()) {
      issues.push({
        id: `missing-vehicle-${duty.id}`, kind: "MISSING_VEHICLE", severity: "FAIL",
        dutyIds: [duty.id], resource: "Vehicle not assigned",
        message: "No vehicle is assigned to this duty."
      });
    }
    const interval = intervalFor(duty);
    if (!interval) {
      issues.push({
        id: `missing-time-${duty.id}`, kind: "MISSING_TIME", severity: "WARN",
        dutyIds: [duty.id], resource: duty.driverName || duty.vehicleId || "Unassigned duty",
        message: "Start or finish time is missing or not recognised, so overlap cannot be verified."
      });
    } else {
      intervals.push(interval);
    }
  }

  const groups: Array<{ key: "driverName" | "vehicleId"; kind: "DRIVER_OVERLAP" | "VEHICLE_OVERLAP"; label: string }> = [
    { key: "driverName", kind: "DRIVER_OVERLAP", label: "Driver" },
    { key: "vehicleId", kind: "VEHICLE_OVERLAP", label: "Vehicle" }
  ];

  for (const group of groups) {
    const byResource = new Map<string, Interval[]>();
    for (const interval of intervals) {
      const value = interval.duty[group.key]?.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase("en-GB");
      const bucket = byResource.get(key) ?? [];
      bucket.push(interval, { ...interval, start: interval.start + 1440, end: interval.end + 1440 });
      byResource.set(key, bucket);
    }

    for (const [key, bucket] of byResource) {
      bucket.sort((a, b) => a.start - b.start || a.end - b.end);
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          if (b.start >= a.end) break;
          if (a.start < b.end && b.start < a.end) {
            const ids = [a.duty.id, b.duty.id];
            const id = `${group.kind.toLowerCase()}-${ids.slice().sort().join("-")}`;
            if (issues.some(issue => issue.id === id)) continue;
            issues.push({
              id, kind: group.kind, severity: "FAIL", dutyIds: ids,
              resource: group.label === "Driver" ? a.duty.driverName! : a.duty.vehicleId!,
              message: `${group.label} "${group.label === "Driver" ? a.duty.driverName : a.duty.vehicleId}" is allocated to overlapping duties ${ids.join(" and ")}.`
            });
          }
        }
      }
    }
  }

  const order: Record<AllocationIssue["kind"], number> = {
    DRIVER_OVERLAP: 0, VEHICLE_OVERLAP: 1, MISSING_DRIVER: 2, MISSING_VEHICLE: 3, MISSING_TIME: 4
  };
  return issues.sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
}
