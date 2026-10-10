import { createClient } from "@supabase/supabase-js";
import { autoAllocate } from "../src/lib/autoAllocation.js";
import { routeMatrix } from "./routes.js";

const depot = "Swans Travel, Broadgate, Chadderton, OL9 9XA";

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const url = process.env.SUPABASE_URL, pub = process.env.SUPABASE_PUBLISHABLE_KEY, internal = process.env.DUTY_CHECKER_DB_KEY;
    if (!url || !pub || !internal) return res.status(503).json({ error: "Supabase is not configured" });
    const { importId } = req.body ?? {};
    if (!importId) return res.status(400).json({ error: "importId required" });

    const db = createClient(url, pub, { global: { headers: { "x-duty-checker-key": internal } } });
    const { data: rows, error } = await db.from("duties").select("*").eq("import_id", importId).order("sort_order");
    if (error) throw error;
    const duties = rows ?? [];
    if (!duties.length) return res.status(400).json({ error: "No imported duties were found for this report." });

    const { data: master, error: masterError } = await db.from("contract_route_master").select("alias,postcode").eq("active", true);
    if (masterError) throw masterError;
    const masterPostcodes: Record<string, string> = {};
    for (const row of master ?? []) if (row.alias && row.postcode) masterPostcodes[row.alias] = row.postcode;

    const drivers = [...new Set(duties.map((d: any) => String(d.driver_name ?? "").trim()).filter((v: string) => v && v.toUpperCase() !== "ON HIRE"))];
    const vehicleMap = new Map<string, number | null>();
    for (const d of duties) {
      const id = String(d.vehicle_id ?? "").trim();
      if (!id || id.toUpperCase() === "ON HIRE") continue;
      const capacity = Number.isFinite(Number(d.vehicle_capacity)) && d.vehicle_capacity != null ? Number(d.vehicle_capacity) : null;
      if (!vehicleMap.has(id) || (vehicleMap.get(id) == null && capacity != null)) vehicleMap.set(id, capacity);
    }
    const vehicles = [...vehicleMap.entries()].map(([id, capacity]) => ({ id, capacity }));
    const locations = [depot, ...duties.flatMap((d: any) => [d.origin, d.destination]).filter((v: any) => typeof v === "string" && v.trim())];
    const matrix = await routeMatrix(locations, masterPostcodes);
    const result = autoAllocate({
      depot,
      drivers,
      vehicles,
      travelMinutes: matrix.travelMinutes,
      maxDriverShiftMinutes: 900,
      beamWidth: 40,
      jobs: duties.map((d: any) => ({
        id: String(d.id),
        startTime: d.start_time ?? d.pickup_time,
        endTime: d.finish_time ?? d.calculated_return_position_time ?? d.return_arrival_time ?? d.leave_time,
        origin: d.origin,
        destination: d.destination,
        seats: d.seats == null ? null : Number(d.seats),
        currentDriver: d.driver_name,
        currentVehicle: d.vehicle_id
      }))
    });
    return res.json({
      importId,
      mode: "PREVIEW_ONLY",
      note: "This is a proposed allocation only. No driver or vehicle assignments have been changed in the database.",
      routeMatrix: { locationCount: matrix.locationCount, edgeCount: matrix.edgeCount, calculatedEdges: matrix.calculatedEdges, unresolved: matrix.unresolved },
      ...result
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Automatic allocation failed" });
  }
}
