import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const url = process.env.SUPABASE_URL, pub = process.env.SUPABASE_PUBLISHABLE_KEY, internal = process.env.DUTY_CHECKER_DB_KEY;
    if (!url || !pub || !internal) return res.status(503).json({ error: "Supabase is not configured" });
    const { importId, dutyId, driverName, vehicleId } = req.body ?? {};
    if (!importId || !dutyId || typeof driverName !== "string" || typeof vehicleId !== "string") {
      return res.status(400).json({ error: "Import, duty, driver and vehicle are required." });
    }
    const db = createClient(url, pub, { global: { headers: { "x-duty-checker-key": internal } } });
    const { data: duty, error: dutyError } = await db.from("duties")
      .select("id,import_id,seats,vehicle_capacity,capacity_status,issues,hours_status,wtd_status,connection_status,data_quality_status")
      .eq("id", dutyId).eq("import_id", importId).maybeSingle();
    if (dutyError) throw dutyError;
    if (!duty) return res.status(404).json({ error: "Duty was not found in the selected import." });

    let capacity: number | null = null;
    if (vehicleId.trim()) {
      const { data: vehicle, error: vehicleError } = await db.from("vehicles")
        .select("registration,capacity,active").eq("registration", vehicleId).maybeSingle();
      if (vehicleError) throw vehicleError;
      if (vehicle && vehicle.active) capacity = vehicle.capacity == null ? null : Number(vehicle.capacity);
    }
    const seats = duty.seats == null ? null : Number(duty.seats);
    const capacityStatus = !vehicleId.trim() || capacity == null ? "WARN" : seats != null && seats > capacity ? "FAIL" : "PASS";
    const existingIssues = Array.isArray(duty.issues) ? duty.issues.filter((x: unknown) => typeof x === "string" && !/capacity|vehicle/i.test(x)) : [];
    const issues = [...existingIssues];
    if (capacityStatus === "WARN") issues.push("Vehicle capacity could not be confirmed from the active fleet master");
    if (capacityStatus === "FAIL") issues.push(`Passenger requirement (${seats}) exceeds selected vehicle capacity (${capacity})`);
    const statuses = [capacityStatus, String(duty.hours_status ?? "WARN"), String(duty.wtd_status ?? "WARN"), String(duty.connection_status ?? "WARN"), String(duty.data_quality_status ?? "WARN")];
    const overallStatus = statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") || statuses.includes("NOT_CHECKED") ? "WARN" : "PASS";
    const { error: updateError } = await db.from("duties").update({
      driver_name: driverName.trim() || null,
      vehicle_id: vehicleId.trim() || null,
      vehicle_capacity: capacity,
      capacity_status: capacityStatus,
      issues,
      overall_status: overallStatus
    }).eq("id", dutyId).eq("import_id", importId);
    if (updateError) throw updateError;
    return res.json({ success: true, dutyId, driverName: driverName.trim() || null, vehicleId: vehicleId.trim() || null, capacity, capacityStatus, message: "Assignment saved. Run the route and compliance checks to refresh connection, hours and WTD results." });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save assignment" });
  }
}