import { describe, expect, it } from "vitest";
import { auditAllocations } from "./allocationAudit";

describe("auditAllocations", () => {
  it("flags a driver and vehicle assigned to overlapping duties", () => {
    const issues = auditAllocations([
      { id: "1", driverName: "Driver A", vehicleId: "Coach 1", pickupTime: "08:00", finishTime: "10:00" },
      { id: "2", driverName: "Driver A", vehicleId: "Coach 1", pickupTime: "09:30", finishTime: "11:00" }
    ]);
    expect(issues.filter(x => x.kind === "DRIVER_OVERLAP")).toHaveLength(1);
    expect(issues.filter(x => x.kind === "VEHICLE_OVERLAP")).toHaveLength(1);
  });

  it("does not flag consecutive duties that meet at the boundary", () => {
    const issues = auditAllocations([
      { id: "1", driverName: "Driver A", vehicleId: "Coach 1", pickupTime: "08:00", finishTime: "10:00" },
      { id: "2", driverName: "Driver A", vehicleId: "Coach 1", pickupTime: "10:00", finishTime: "11:00" }
    ]);
    expect(issues.some(x => x.kind.endsWith("_OVERLAP"))).toBe(false);
  });

  it("recognises an overnight finish", () => {
    const issues = auditAllocations([
      { id: "1", driverName: "Driver A", vehicleId: "Coach 1", pickupTime: "23:00", finishTime: "01:00" },
      { id: "2", driverName: "Driver A", vehicleId: "Coach 1", pickupTime: "00:30", finishTime: "02:00" }
    ]);
    expect(issues.some(x => x.kind === "DRIVER_OVERLAP")).toBe(true);
  });

  it("flags missing assignment and timing data", () => {
    const issues = auditAllocations([{ id: "1", pickupTime: null, finishTime: null }]);
    expect(issues.some(x => x.kind === "MISSING_DRIVER")).toBe(true);
    expect(issues.some(x => x.kind === "MISSING_VEHICLE")).toBe(true);
    expect(issues.some(x => x.kind === "MISSING_TIME")).toBe(true);
  });
});
