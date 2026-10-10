import { describe, expect, it } from "vitest";
import { autoAllocate, parseClockMinutes } from "./autoAllocation";

const routeTimes = (locations: string[], minutes = 10) => {
  const out: Record<string, number> = {};
  for (const from of locations) for (const to of locations) {
    out[`${from.toLocaleLowerCase("en-GB")}|${to.toLocaleLowerCase("en-GB")}`] = from === to ? 0 : minutes;
  }
  return out;
};

describe("autoAllocate", () => {
  it("parses clock times and rejects invalid values", () => {
    expect(parseClockMinutes("07:30")).toBe(450);
    expect(parseClockMinutes("7:30")).toBe(450);
    expect(parseClockMinutes("24:00")).toBeNull();
    expect(parseClockMinutes("7:99")).toBeNull();
  });

  it("allocates feasible duties and returns an explanation for each assignment", () => {
    const result = autoAllocate({
      jobs: [
        { id: "A", startTime: "08:00", endTime: "09:00", origin: "Depot", destination: "School A", seats: 20 },
        { id: "B", startTime: "10:00", endTime: "11:00", origin: "School A", destination: "School B", seats: 20 }
      ],
      drivers: ["Driver 1"],
      vehicles: [{ id: "Coach 1", capacity: 49 }],
      depot: "Depot",
      travelMinutes: routeTimes(["Depot", "School A", "School B"], 10)
    });
    expect(result.complete).toBe(true);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[1].explanation.join(" ")).toContain("reposition");
  });

  it("does not assign a vehicle below passenger capacity", () => {
    const result = autoAllocate({
      jobs: [{ id: "A", startTime: "08:00", endTime: "09:00", origin: "Depot", destination: "School A", seats: 50 }],
      drivers: ["Driver 1"],
      vehicles: [{ id: "Midi", capacity: 33 }],
      depot: "Depot",
      travelMinutes: routeTimes(["Depot", "School A"])
    });
    expect(result.complete).toBe(false);
    expect(result.assignments).toHaveLength(0);
    expect(result.unallocated[0].jobId).toBe("A");
  });

  it("rejects an impossible reposition between consecutive jobs", () => {
    const result = autoAllocate({
      jobs: [
        { id: "A", startTime: "08:00", endTime: "09:00", origin: "Depot", destination: "School A" },
        { id: "B", startTime: "09:05", endTime: "10:00", origin: "School B", destination: "Depot" }
      ],
      drivers: ["Driver 1"],
      vehicles: [{ id: "Coach 1", capacity: 49 }],
      depot: "Depot",
      travelMinutes: {
        ...routeTimes(["Depot", "School A", "School B"], 10),
        "school a|school b": 25
      }
    });
    expect(result.complete).toBe(false);
    expect(result.unallocated.map(x => x.jobId)).toContain("B");
  });

  it("does not assume missing route times are zero", () => {
    const result = autoAllocate({
      jobs: [{ id: "A", startTime: "08:00", endTime: "09:00", origin: "Unknown", destination: "School A" }],
      drivers: ["Driver 1"],
      vehicles: [{ id: "Coach 1", capacity: 49 }],
      depot: "Depot",
      travelMinutes: {}
    });
    expect(result.complete).toBe(false);
    expect(result.unallocated[0].reason).toContain("route");
  });

  it("leaves invalid timing records unallocated instead of guessing", () => {
    const result = autoAllocate({
      jobs: [{ id: "A", startTime: null, endTime: "09:00", origin: "Depot", destination: "School A" }],
      drivers: ["Driver 1"],
      vehicles: [{ id: "Coach 1", capacity: 49 }],
      depot: "Depot",
      travelMinutes: routeTimes(["Depot", "School A"])
    });
    expect(result.complete).toBe(false);
    expect(result.unallocated[0].reason).toContain("Missing or invalid");
  });
});
