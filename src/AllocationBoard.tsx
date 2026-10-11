import { useEffect, useMemo, useState } from "react";
import { Download, Save, Search, Users, BusFront, AlertTriangle, RefreshCw } from "lucide-react";

type BoardDuty = {
  id: string; driverName: string | null; vehicleId: string | null; origin: string | null; destination: string | null;
  pickupTime: string | null; leaveTime: string | null; arrivalTime: string | null; finishTime: string | null;
  seats: number | null; vehicleCapacity: number | null; capacityStatus: string; overallStatus: string;
  connectionStatus: string; issues: string[];
};
type Props = { duties: BoardDuty[]; importId: string | null; busy: boolean; onRefresh: () => Promise<void> | void };

export default function AllocationBoard({ duties, importId, busy, onRefresh }: Props) {
  const [drafts, setDrafts] = useState<Record<string, { driver: string; vehicle: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "UNASSIGNED" | "CONFLICTS">("ALL");
  const [showEditor, setShowEditor] = useState<string | null>(null);
  useEffect(() => setDrafts({}), [importId, duties.length]);
  const drivers = useMemo(() => [...new Set(duties.map(d => d.driverName?.trim()).filter((x): x is string => Boolean(x)))].sort(), [duties]);
  const vehicles = useMemo(() => [...new Set(duties.map(d => d.vehicleId?.trim()).filter((x): x is string => Boolean(x)))].sort(), [duties]);
  const value = (d: BoardDuty) => drafts[d.id] ?? { driver: d.driverName ?? "", vehicle: d.vehicleId ?? "" };
  const unassigned = duties.filter(d => !value(d).driver || !value(d).vehicle).length;
  const conflicts = duties.filter(d => d.overallStatus === "FAIL" || d.capacityStatus === "FAIL" || d.connectionStatus === "FAIL").length;
  const changed = duties.filter(d => { const v = value(d); return v.driver !== (d.driverName ?? "") || v.vehicle !== (d.vehicleId ?? ""); }).length;
  const visible = duties.filter(d => {
    const v = value(d);
    const text = [d.id, v.driver, v.vehicle, d.origin, d.destination].join(" ").toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filter === "UNASSIGNED" && v.driver && v.vehicle) return false;
    if (filter === "CONFLICTS" && d.overallStatus !== "FAIL" && d.capacityStatus !== "FAIL" && d.connectionStatus !== "FAIL") return false;
    return true;
  });
  const setValue = (id: string, key: "driver" | "vehicle", next: string) => setDrafts(old => ({ ...old, [id]: { ...value(duties.find(d => d.id === id)!), [key]: next } }));
  const refreshCompliance = async () => {
    if (!importId) throw new Error("No import is selected.");
    let offset = 0;
    const total = duties.length;
    while (offset < total) {
      const response = await fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ importId, offset, limit: 40 }) });
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!response.ok) throw new Error(body?.error || "Route refresh failed (HTTP " + response.status + ")");
      if (!body || !Number.isFinite(Number(body.processed)) || Number(body.processed) <= 0) throw new Error("Route refresh made no progress at duty " + (offset + 1) + ".");
      offset = body.nextOffset === null ? total : Number(body.nextOffset);
    }
    for (const path of ["/api/connections", "/api/recalculate"]) {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ importId }) });
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!response.ok) throw new Error(body?.error || path + " failed (HTTP " + response.status + ")");
    }
  };
  const save = async (d: BoardDuty) => {
    if (!importId) return;
    const v = value(d); setSaving(d.id); setNotice("");
    let assignmentSaved = false;
    try {
      const response = await fetch("/api/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId, dutyId: d.id, driverName: v.driver, vehicleId: v.vehicle }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save assignment");
      assignmentSaved = true;
      setDrafts(old => { const next = { ...old }; delete next[d.id]; return next; });
      setShowEditor(null);
      setNotice("Assignment saved. Refreshing route and compliance checks…");
      await refreshCompliance();
      await onRefresh();
      setNotice("Assignment saved; route feasibility, connections, capacity, drivers’ hours and WTD have been refreshed." + (body.capacityStatus === "FAIL" ? " Warning: selected vehicle is too small for this duty." : body.capacityStatus === "WARN" ? " Vehicle capacity is not confirmed." : ""));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save assignment";
      setNotice(assignmentSaved ? "Assignment was saved, but the compliance refresh did not complete: " + message : message);
    } finally { setSaving(null); }
  };
  const exportCsv = () => {
    const cell = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows: unknown[][] = [["Duty ID","Driver","Vehicle","Origin","Destination","Position time","Passengers","Vehicle capacity","Capacity result","Compliance result"]];
    for (const d of visible) { const v = value(d); rows.push([d.id,v.driver,v.vehicle,d.origin,d.destination,d.pickupTime,d.seats,d.vehicleCapacity,d.capacityStatus,d.overallStatus]); }
    const blob = new Blob(["\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "swans-allocation-board.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="workspace">
    <div className="workspace-title"><div><label>OPERATIONS PLANNING</label><h1>Allocation board</h1><p>Review each duty, change the driver or vehicle, and save assignments to the imported plan.</p></div><div className="workspace-actions"><button onClick={onRefresh} disabled={busy}><RefreshCw size={15}/> Refresh data</button><button onClick={exportCsv}><Download size={15}/> Export board</button></div></div>
    {notice && <div className="notice">{notice}</div>}
    <div className="workspace-metrics">
      <div><span>Total duties</span><strong>{duties.length}</strong><small>in the current import</small></div>
      <div><span>Drivers identified</span><strong>{drivers.length}</strong><small>from imported duties</small></div>
      <div><span>Vehicles identified</span><strong>{vehicles.length}</strong><small>from imported duties</small></div>
      <div className={unassigned ? "metric-warning" : ""}><span>Incomplete assignments</span><strong>{unassigned}</strong><small>missing driver or vehicle</small></div>
      <div className={conflicts ? "metric-danger" : ""}><span>Flagged duties</span><strong>{conflicts}</strong><small>existing failure statuses</small></div>
    </div>
    <div className="board-toolbar"><div className="board-tabs">
      <button className={filter === "ALL" ? "selected" : ""} onClick={() => setFilter("ALL")}>All duties <b>{duties.length}</b></button>
      <button className={filter === "UNASSIGNED" ? "selected" : ""} onClick={() => setFilter("UNASSIGNED")}>Unassigned <b>{unassigned}</b></button>
      <button className={filter === "CONFLICTS" ? "selected" : ""} onClick={() => setFilter("CONFLICTS")}>Conflicts <b>{conflicts}</b></button>
    </div><label className="board-search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search driver, vehicle, route or duty"/></label></div>
    <div className="board-table-wrap"><table className="board-table"><thead><tr><th>Duty / route</th><th>Time</th><th>Passengers</th><th>Driver assignment</th><th>Vehicle assignment</th><th>Checks</th><th></th></tr></thead><tbody>
      {visible.map(d => { const v = value(d); const dirty = v.driver !== (d.driverName ?? "") || v.vehicle !== (d.vehicleId ?? ""); const open = showEditor === d.id; return <tr key={d.id} className={dirty ? "draft-row" : ""}>
        <td><strong>Duty {d.id.slice(0, 8)}</strong><span>{d.origin ?? "Origin unresolved"} → {d.destination ?? "Destination unresolved"}</span></td>
        <td><strong>{d.pickupTime ?? "—"}</strong><span>{d.leaveTime && d.arrivalTime ? d.leaveTime + "–" + d.arrivalTime : "Return / finish " + (d.finishTime ?? "not set")}</span></td>
        <td><strong>{d.seats ?? "—"}</strong><span>seats required</span></td>
        <td>{open ? <select value={v.driver} onChange={e => setValue(d.id,"driver",e.target.value)}><option value="">Unassigned</option>{drivers.map(x => <option key={x} value={x}>{x}</option>)}</select> : <strong>{v.driver || "Unassigned"}</strong>}</td>
        <td>{open ? <select value={v.vehicle} onChange={e => setValue(d.id,"vehicle",e.target.value)}><option value="">Unassigned</option>{vehicles.map(x => <option key={x} value={x}>{x}</option>)}</select> : <strong>{v.vehicle || "Unassigned"}</strong>}</td>
        <td><span className={"board-status " + d.overallStatus.toLowerCase()}>{d.overallStatus}</span><span className={"board-status " + d.capacityStatus.toLowerCase()}>{d.capacityStatus === "PASS" ? "Capacity OK" : d.capacityStatus === "FAIL" ? "Capacity fail" : "Capacity check"}</span>{d.connectionStatus === "FAIL" && <span className="board-status fail">Connection fail</span>}</td>
        <td className="board-row-actions">{open ? <><button onClick={() => save(d)} disabled={saving === d.id || !dirty}><Save size={14}/>{saving === d.id ? "Saving…" : "Save"}</button><button onClick={() => { setDrafts(old => { const n={...old}; delete n[d.id]; return n; }); setShowEditor(null); }}>Cancel</button></> : <button onClick={() => setShowEditor(d.id)}>Edit</button>}</td>
      </tr>; })}
      {!visible.length && <tr><td colSpan={7} className="board-empty">No duties match this filter.</td></tr>}
    </tbody></table></div>
    <div className="board-footnote"><AlertTriangle size={16}/><span>Saving an assignment now reruns route reconstruction, school-to-school feasibility, capacity, drivers’ hours and WTD for the current import. Driver and vehicle choices are drawn from the current import; a managed driver master and full booking editor remain separate enhancements.</span></div>
    <div className="workspace-subheads"><div><Users size={18}/><div><strong>Driver pool</strong><span>{drivers.length} names found in the current report</span></div></div><div><BusFront size={18}/><div><strong>Fleet pool</strong><span>{vehicles.length} vehicles found in the current report</span></div></div></div>
    <div className="workspace-pools"><div>{drivers.map(name => <span key={name}>{name}</span>)}</div><div>{vehicles.map(reg => <span key={reg}>{reg}</span>)}</div></div>
  </div>;
}
