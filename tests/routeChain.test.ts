import {describe,it,expect} from "vitest";
import {sumCompleteRouteChain,calculateTimedStopArrival} from "../src/lib/routeChain";

describe("complete route chain validation",()=>{
  it("sums all legs only when every leg has a calculated duration",()=>{
    expect(sumCompleteRouteChain(["a","b","c"],new Map([["a",10],["b",12],["c",8]]))).toBe(30);
  });
  it("refuses to silently treat a missing route leg as zero minutes",()=>{
    expect(()=>sumCompleteRouteChain(["a","b","c"],new Map([["a",10],["c",8]]))).toThrow(/partial route time has not been accepted/i);
  });
  it("calculates arrival through timed intermediate pickups",()=>{
    const legs=new Map([["DepotStop|PickupTwo",12],["PickupTwo|School",18]]);
    expect(calculateTimedStopArrival([{location:"DepotStop",time:"07:00"},{location:"PickupTwo",time:"07:20"},{location:"School",time:null}],"School",(a,b)=>legs.get(a+"|"+b)??null)).toBe("07:38");
  });
  it("rejects a pickup that cannot be reached by its scheduled time",()=>{
    const legs=new Map([["First|Second",25],["Second|School",10]]);
    expect(()=>calculateTimedStopArrival([{location:"First",time:"07:00"},{location:"Second",time:"07:20"},{location:"School",time:null}],"School",(a,b)=>legs.get(a+"|"+b)??null)).toThrow(/pickup timing impossible/i);
  });
  it("does not invent arrival when an intermediate pickup has no time",()=>{
    expect(()=>calculateTimedStopArrival([{location:"First",time:"07:00"},{location:"Second",time:null},{location:"School",time:null}],"School",()=>10)).toThrow(/intermediate pickup times are missing/i);
  });
});
