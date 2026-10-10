export type AllocationJob = {
  id: string;
  startTime: string | null;
  pickupTime?: string | null;
  endTime: string | null;
  origin: string | null;
  destination: string | null;
  seats?: number | null;
  currentDriver?: string | null;
  currentVehicle?: string | null;
};

export type AllocationVehicle = { id: string; capacity: number | null };

export type AutoAllocationInput = {
  jobs: AllocationJob[];
  drivers: string[];
  vehicles: AllocationVehicle[];
  depot: string;
  /** Keys are normalised "from|to" labels. Values are driving minutes. */
  travelMinutes: Record<string, number>;
  maxDriverShiftMinutes?: number;
  beamWidth?: number;
  changePenalty?: number;
};

export type ProposedAssignment = {
  jobId: string;
  driver: string;
  vehicle: string;
  estimatedDeadheadMinutes: number;
  explanation: string[];
};

export type AllocationRejection = { jobId: string; reason: string };

export type AutoAllocationResult = {
  assignments: ProposedAssignment[];
  unallocated: AllocationRejection[];
  totalDeadheadMinutes: number;
  changedDriverCount: number;
  changedVehicleCount: number;
  complete: boolean;
  notes: string[];
};

type PlacedJob = AllocationJob & { start: number; shiftStart: number; end: number };
type State = {
  assignments: ProposedAssignment[];
  driverLast: Map<string, PlacedJob>;
  vehicleLast: Map<string, PlacedJob>;
  driverFirstStart: Map<string, number>;
  deadhead: number;
  changes: number;
  unallocated: AllocationRejection[];
};

export const parseClockMinutes = (value: string | null | undefined): number | null => {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const normalise = (value: string) => value.trim().toLocaleLowerCase("en-GB");
const routeKey = (from: string, to: string) => `${normalise(from)}|${normalise(to)}`;
const getTravel = (input: AutoAllocationInput, from: string, to: string) => {
  const value = input.travelMinutes[routeKey(from, to)];
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const forwardSpan = (start: number, end: number) => end >= start ? end - start : end + 1440 - start;
const cloneState = (state: State): State => ({
  assignments: [...state.assignments],
  driverLast: new Map(state.driverLast),
  vehicleLast: new Map(state.vehicleLast),
  driverFirstStart: new Map(state.driverFirstStart),
  deadhead: state.deadhead,
  changes: state.changes,
  unallocated: [...state.unallocated]
});

function checkResource(
  input: AutoAllocationInput,
  previous: PlacedJob | undefined,
  job: PlacedJob,
  firstStart: number | undefined,
  resourceName: string,
  isDriver: boolean
): { ok: true; deadhead: number } | { ok: false; reason: string } {
  const from = previous?.destination ?? input.depot;
  const to = job.origin;
  if (!to) return { ok: false, reason: `Duty ${job.id} has no origin, so repositioning cannot be verified.` };
  const travel = getTravel(input, from, to);
  if (travel === null) return { ok: false, reason: `Missing route estimate from "${from}" to "${to}" for ${resourceName}.` };
  const available = previous ? forwardSpan(previous.end, job.start) : job.pickupTime ? Math.max(0, forwardSpan(firstStart ?? job.shiftStart, job.start) - 30) : job.start;
  if (travel > available) return { ok: false, reason: `${resourceName} cannot reach duty ${job.id}: ${travel} min repositioning, only ${available} min available.` };
  if (previous && previous.end > job.start && forwardSpan(job.start, previous.end) < 720) {
    return { ok: false, reason: `${resourceName} has overlapping duties ${previous.id} and ${job.id}.` };
  }
  if (isDriver) {
    const shiftStart = firstStart ?? job.start;
    const shiftLength = forwardSpan(shiftStart, job.end);
    if (shiftLength > (input.maxDriverShiftMinutes ?? 900)) {
      return { ok: false, reason: `${resourceName} would exceed the ${input.maxDriverShiftMinutes ?? 900}-minute shift limit.` };
    }
  }
  return { ok: true, deadhead: travel };
}

/**
 * Suggests an allocation using a bounded beam search. It never invents missing
 * route times: a candidate is only accepted when the required repositioning
 * estimate exists. Results are proposals and must be reviewed before applying.
 */
export function autoAllocate(input: AutoAllocationInput): AutoAllocationResult {
  const notes: string[] = [];
  const maxShift = input.maxDriverShiftMinutes ?? 900;
  const jobs: PlacedJob[] = [];
  const invalid: AllocationRejection[] = [];

  for (const raw of input.jobs) {
    const shiftStart = parseClockMinutes(raw.startTime);
    const start = parseClockMinutes(raw.pickupTime ?? raw.startTime);
    const end = parseClockMinutes(raw.endTime);
    if (shiftStart === null || start === null || end === null || !raw.origin?.trim() || !raw.destination?.trim()) {
      invalid.push({ jobId: raw.id, reason: "Missing or invalid start/end time, origin or destination. This duty was not auto-allocated." });
      continue;
    }
    jobs.push({ ...raw, start, shiftStart, end: end < start ? end + 1440 : end });
  }
  const ambiguousOvernightIds = new Set<string>();
  for (const overnight of jobs.filter(job => job.end >= 1440)) {
    const afterMidnightEnd = overnight.end - 1440;
    for (const other of jobs) {
      if (other.id !== overnight.id && other.start < afterMidnightEnd) {
        ambiguousOvernightIds.add(overnight.id);
        ambiguousOvernightIds.add(other.id);
      }
    }
  }
  if (ambiguousOvernightIds.size) {
    for (const id of ambiguousOvernightIds) invalid.push({
      jobId: id,
      reason: "A duty crosses midnight and another duty starts in the affected after-midnight window. The source has no service date to determine the correct order, so neither duty was auto-allocated."
    });
  }
  const safeJobs = jobs.filter(job => !ambiguousOvernightIds.has(job.id));
  safeJobs.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));

  const drivers = [...new Set(input.drivers.map(x => x.trim()).filter(Boolean))];
  const vehicles = input.vehicles.filter(v => v.id.trim());
  if (!drivers.length || !vehicles.length) {
    return {
      assignments: [], unallocated: [...invalid, ...safeJobs.map(j => ({ jobId: j.id, reason: "No usable driver or vehicle pool was supplied." }))],
      totalDeadheadMinutes: 0, changedDriverCount: 0, changedVehicleCount: 0, complete: false,
      notes: ["Automatic allocation needs a known driver pool, vehicle pool and route-time estimates."]
    };
  }

  let beam: State[] = [{
    assignments: [], driverLast: new Map(), vehicleLast: new Map(), driverFirstStart: new Map(),
    deadhead: 0, changes: 0, unallocated: [...invalid]
  }];
  const width = Math.max(1, input.beamWidth ?? 30);
  const changePenalty = input.changePenalty ?? 20;

  for (const job of safeJobs) {
    const expanded: State[] = [];
    const rejectionReasons: string[] = [];
    for (const state of beam) {
      for (const driver of drivers) {
        const driverCheck = checkResource(input, state.driverLast.get(normalise(driver)), job,
          state.driverFirstStart.get(normalise(driver)), `driver "${driver}"`, true);
        if (!driverCheck.ok) { rejectionReasons.push(driverCheck.reason); continue; }
        for (const vehicle of vehicles) {
          if (job.seats != null && vehicle.capacity != null && vehicle.capacity < job.seats) { rejectionReasons.push(`Vehicle "${vehicle.id}" has ${vehicle.capacity} seats but duty ${job.id} needs ${job.seats}.`); continue; }
          const vehicleCheck = checkResource(input, state.vehicleLast.get(normalise(vehicle.id)), job, undefined,
            `vehicle "${vehicle.id}"`, false);
          if (!vehicleCheck.ok) { rejectionReasons.push(vehicleCheck.reason); continue; }

          const next = cloneState(state);
          const driverKey = normalise(driver), vehicleKey = normalise(vehicle.id);
          const changes = Number(Boolean(job.currentDriver && normalise(job.currentDriver) !== driverKey)) +
            Number(Boolean(job.currentVehicle && normalise(job.currentVehicle) !== vehicleKey));
          next.assignments.push({
            jobId: job.id, driver, vehicle: vehicle.id,
            estimatedDeadheadMinutes: driverCheck.deadhead + vehicleCheck.deadhead,
            explanation: [
              `Driver reposition: ${driverCheck.deadhead} min from ${state.driverLast.get(driverKey)?.destination ?? input.depot} to ${job.origin}`,
              `Vehicle reposition: ${vehicleCheck.deadhead} min from ${state.vehicleLast.get(vehicleKey)?.destination ?? input.depot} to ${job.origin}`,
              job.seats != null && vehicle.capacity != null ? `Capacity: ${vehicle.capacity} seats for ${job.seats} passengers` : "Capacity not verified because passenger or vehicle capacity is missing"
            ]
          });
          next.driverLast.set(driverKey, job);
          next.vehicleLast.set(vehicleKey, job);
          if (!next.driverFirstStart.has(driverKey)) next.driverFirstStart.set(driverKey, job.shiftStart);
          next.deadhead += driverCheck.deadhead + vehicleCheck.deadhead;
          next.changes += changes;
          expanded.push(next);
        }
      }
      const skipped = cloneState(state);
      skipped.unallocated.push({ jobId: job.id, reason: rejectionReasons[0] ?? "No driver/vehicle combination passed the current capacity, route, turnaround and shift checks." });
      expanded.push(skipped);
    }
    expanded.sort((a, b) =>
      (a.unallocated.length * 100000 + a.deadhead + a.changes * changePenalty) -
      (b.unallocated.length * 100000 + b.deadhead + b.changes * changePenalty)
    );
    const unique = new Set<string>();
    beam = expanded.filter(s => {
      const signature = s.assignments.map(a => `${a.jobId}:${normalise(a.driver)}:${normalise(a.vehicle)}`).join(";");
      if (unique.has(signature)) return false;
      unique.add(signature);
      return true;
    }).slice(0, width);
  }

  const best = beam[0] ?? { assignments: [], driverLast: new Map(), vehicleLast: new Map(), driverFirstStart: new Map(), deadhead: 0, changes: 0, unallocated: invalid };
  const changedDriverCount = best.assignments.filter(a => {
    const job = input.jobs.find(j => j.id === a.jobId);
    return Boolean(job?.currentDriver && normalise(job.currentDriver) !== normalise(a.driver));
  }).length;
  const changedVehicleCount = best.assignments.filter(a => {
    const job = input.jobs.find(j => j.id === a.jobId);
    return Boolean(job?.currentVehicle && normalise(job.currentVehicle) !== normalise(a.vehicle));
  }).length;
  if (best.unallocated.length) notes.push("Some duties remain unallocated. Review each reason; do not treat a partial plan as ready for service.");
  if (jobs.some(j => j.seats == null) || vehicles.some(v => v.capacity == null)) notes.push("Passenger or vehicle capacity is missing for some records; those assignments are not fully capacity-certified.");
  notes.push(`Shift limit used: ${maxShift} minutes. This is a planning guardrail, not a substitute for the full statutory drivers' hours and WTD assessment.`);
  return {
    assignments: best.assignments,
    unallocated: best.unallocated,
    totalDeadheadMinutes: best.deadhead,
    changedDriverCount,
    changedVehicleCount,
    complete: best.unallocated.length === 0 && best.assignments.length === input.jobs.length,
    notes
  };
}
