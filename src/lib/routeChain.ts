export type RouteStopTime = { location: string; time: string | null };

const clockMinutes = (value: string | null | undefined): number | null => {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};

const clockText = (value: number): string => {
  const wrapped = ((value % 1440) + 1440) % 1440;
  return String(Math.floor(wrapped / 60)).padStart(2, "0") + ":" + String(wrapped % 60).padStart(2, "0");
};

/** Identifies rows whose labels are operational placeholders rather than physical journey endpoints. */
export function isNonJourneyPlaceholderRow(origin: string | null | undefined, destination: string | null | undefined): boolean {
  const a = String(origin ?? "").trim().toUpperCase();
  const b = String(destination ?? "").trim().toUpperCase();
  return a !== "" && a === b && /^(DEPOT COVER|UNASSIGNED|STANDBY|HOLIDAY|SICK|REST DAY|WORK DAY)$/.test(a);
}

/** Sum a route only when every leg has a real calculated duration. */
export function sumCompleteRouteChain(keys: string[], durations: ReadonlyMap<string, number>): number {
  if (!keys.length) throw new Error("No physical route legs were available.");
  let total = 0;
  for (const key of keys) {
    const value = durations.get(key);
    if (value == null || !Number.isFinite(value) || value < 0) {
      throw new Error("Route chain incomplete: one or more legs could not be calculated. A partial route time has not been accepted.");
    }
    total += value;
  }
  return total;
}

/** Reconstruct arrival from a complete, explicitly timed multi-stop itinerary. */
export function calculateTimedStopArrival(
  stops: RouteStopTime[],
  destination: string,
  getTravelMinutes: (from: string, to: string) => number | null,
): string {
  if (stops.length < 2 || !destination) throw new Error("A complete multi-stop route is required.");
  const timedStops = stops.slice(0, -1);
  if (timedStops.some((stop) => !stop.location || clockMinutes(stop.time) == null)) {
    throw new Error("Cannot reconstruct arrival safely: one or more intermediate pickup times are missing.");
  }
  let cursor = clockMinutes(stops[0].time)!;
  let location = stops[0].location;
  for (let index = 1; index < stops.length - 1; index++) {
    const next = stops[index];
    const travel = getTravelMinutes(location, next.location);
    if (travel == null || !Number.isFinite(travel) || travel < 0) {
      throw new Error("Route chain incomplete: no calculated road time between " + location + " and " + next.location + ".");
    }
    const estimatedArrival = cursor + travel;
    const scheduled = clockMinutes(next.time);
    if (scheduled == null) throw new Error("Missing timetable time at intermediate pickup " + next.location + ".");
    if (estimatedArrival > scheduled) {
      throw new Error("Pickup timing impossible at " + next.location + ": estimated arrival " + clockText(estimatedArrival) + " is after scheduled pickup " + next.time + ".");
    }
    cursor = scheduled;
    location = next.location;
  }
  const finalTravel = getTravelMinutes(location, destination);
  if (finalTravel == null || !Number.isFinite(finalTravel) || finalTravel < 0) {
    throw new Error("No final passenger route could be calculated from " + location + " to " + destination + ".");
  }
  return clockText(cursor + finalTravel);
}
