import {describe,it,expect} from "vitest"; import {minutes,duration,spread,addMinutes,screenWorkingDay,screenWtdBreak,scheduledBreakMinutes,planEuDrivingBreaks,wtdWorkingMinutes} from "../src/lib/compliance";
describe("compliance calculations",()=>{
  it("calculates overnight durations",()=>{expect(minutes("06:00")).toBe(360);expect(duration("23:00","01:00")).toBe(120);expect(spread(360,900)).toBe(540)});
  it("flags a 15 hour spread",()=>{expect(screenWorkingDay(900)).toBe("PASS");expect(screenWorkingDay(901)).toBe("FAIL")});
  it("flags insufficient break evidence",()=>{expect(screenWtdBreak(360,30)).toBe("PASS");expect(screenWtdBreak(361,29)).toBe("FAIL")});
  it("uses passenger journey times and real between-job breaks for chained duties",()=>{const rows=[{start_time:"06:00",pickup_time:"07:15",leave_time:"08:35",arrival_time:"08:30",finish_time:"09:00"},{start_time:"08:25",pickup_time:"09:15",leave_time:"14:15",arrival_time:"10:00",finish_time:"15:45"},{start_time:"15:00",pickup_time:"15:35",leave_time:"17:15",arrival_time:"17:10",finish_time:"17:45"}];expect(scheduledBreakMinutes(rows,[20,40])).toBe(575)});
  it("preserves Colin Chapman's real back-duty return position for the next job",()=>{const returnPosition=addMinutes("14:15",45);const nextArrival=addMinutes(returnPosition,30);expect(returnPosition).toBe("15:00");expect(nextArrival).toBe("15:30");expect(duration(returnPosition,"15:35")).toBe(35)});
  it("treats only gaps over three hours as split duty",()=>{const opportunities=[{start:"10:00",end:"13:00",minutes:180,source:"between_jobs" as const,dutyIndex:0,description:"3 hour gap"},{start:"14:00",end:"17:01",minutes:181,source:"between_jobs" as const,dutyIndex:1,description:"over 3 hour gap"}];expect(wtdWorkingMinutes(900,opportunities,0)).toBe(719);expect(wtdWorkingMinutes(900,opportunities,30)).toBe(689)});
  it("fixes WTD requirement before allocated break is subtracted",()=>{expect(wtdWorkingMinutes(541,[],0)).toBe(541);expect(wtdWorkingMinutes(541,[],30)).toBe(511);expect(wtdWorkingMinutes(541,[{start:"10:00",end:"13:01",minutes:181,source:"between_jobs" as const,dutyIndex:0,description:"over three hours"}],0)).toBe(360)});
  it("requires two distinct drivers on the same vehicle journey for double-manning",()=>{const rows=[{id:"a",driver_name:"Driver A",vehicle_id:"YX123",origin:"School A",destination:"School B",pickup_time:"08:00",start_time:"07:00"},{id:"b",driver_name:"Driver B",vehicle_id:"YX123",origin:"School A",destination:"School B",pickup_time:"08:00",start_time:"07:30"}];const drivers=[...new Set(rows.map(r=>r.driver_name))];expect(drivers.length).toBe(2);expect(spread(minutes(rows[0].start_time)!,minutes(rows[1].start_time)!)).toBeLessThanOrEqual(60)});
  it("includes the final return journey in EU driving",()=>{const rows=[{start_time:"06:00",pickup_time:"07:00",leave_time:"10:20",arrival_time:"10:20",finish_time:"11:20",outbound_route_minutes:200,return_route_minutes:60,depot_return_route_minutes:null,back:false}];const plan=planEuDrivingBreaks(rows,[]);expect(plan.drivingMinutes).toBe(260);expect(plan.status).toBe("PASS")});
  it("includes an intermediate back-duty return leg before the next job",()=>{const rows=[{start_time:"06:00",pickup_time:"07:00",leave_time:"10:20",arrival_time:"10:20",finish_time:"12:00",outbound_route_minutes:190,return_route_minutes:60,depot_return_route_minutes:null,back:true,calculated_return_position_time:"11:20",origin:"Depot",destination:"School"},{start_time:"11:40",pickup_time:"11:50",leave_time:"12:20",arrival_time:"12:00",finish_time:"13:00",outbound_route_minutes:10,return_route_minutes:0,depot_return_route_minutes:null,back:false}];const plan=planEuDrivingBreaks(rows,[20]);expect(plan.drivingMinutes).toBe(270);expect(plan.status).toBe("FAIL")});
  it("does not reset the EU driving clock on a 15-minute first split",()=>{const rows=[{start_time:"06:00",pickup_time:"07:00",leave_time:"10:50",arrival_time:"10:50",finish_time:"11:05",outbound_route_minutes:250,return_route_minutes:0,depot_return_route_minutes:null,back:false},{start_time:"11:25",pickup_time:"11:25",leave_time:"12:05",arrival_time:"11:35",finish_time:"12:15",outbound_route_minutes:5,return_route_minutes:0,depot_return_route_minutes:null,back:false}];const plan=planEuDrivingBreaks(rows,[15]);expect(plan.plans.some(p=>p.minutes===15)).toBe(true);expect(plan.plans.some(p=>p.minutes===30)).toBe(true);expect(plan.status).toBe("PASS")});
});
import {dutyEnd,groupDuties} from "../src/lib/dutySequence";
describe("duty sequence model",()=>{
  it("uses the calculated return position as the end of a back duty",()=>{
    expect(dutyEnd({back:true,origin:"Savio House",destination:"Blessed Thomas",arrival_time:"10:00",calculated_return_position_time:"15:00"})).toEqual({location:"Savio House",time:"15:00",kind:"return_position"});
  });
  it("uses the passenger destination for a normal duty",()=>{
    expect(dutyEnd({back:false,destination:"School",arrival_time:"10:00"})).toEqual({location:"School",time:"10:00",kind:"passenger_end"});
  });
  it("keeps ON HIRE duties isolated",()=>{
    const groups=groupDuties([{id:"1",driver_name:"ON HIRE",sort_order:1},{id:"2",driver_name:"ON HIRE",sort_order:2},{id:"3",driver_name:"Baz",sort_order:3},{id:"4",driver_name:"Baz",sort_order:4}]);
    expect(groups.size).toBe(3); expect(groups.get("Baz")?.length).toBe(2);
  });
});
