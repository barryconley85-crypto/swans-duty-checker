import {createClient} from "@supabase/supabase-js";
import {minutes,spread,duration,addMinutes,scheduledBreakOpportunities,allocateWtdBreaks,planEuDrivingBreaks,wtdWorkingMinutes} from "../src/lib/compliance.js";

const DOUBLE_MANNED_MAX=1260;
const SINGLE_MANNED_MAX=900;

function timingErrors(d:any){
  const out:string[]=[];
  const pickup=minutes(d.pickup_time),leave=minutes(d.leave_time),arrival=minutes(d.arrival_time),finish=minutes(d.finish_time),start=minutes(d.start_time);
  if(pickup!==null&&arrival!==null&&arrival<pickup)out.push(`Passenger Arrival ${d.arrival_time} is before Pickup ${d.pickup_time}.`);
  if(arrival!==null&&leave!==null&&leave<arrival)out.push(`Leave ${d.leave_time} is before Arrival ${d.arrival_time}; this is not a valid same-day waiting/rest period.`);
  if(start!==null&&pickup!==null&&pickup<start&&start-pickup<720)out.push(`Pickup ${d.pickup_time} is before Start ${d.start_time}.`);
  if(leave!==null&&finish!==null&&finish<leave&&leave-finish<120)out.push(`Finish ${d.finish_time} is before Leave ${d.leave_time} without enough indication of an overnight duty.`);
  return out;
}

export default async function handler(req:any,res:any){
  try{
    if(req.method!=="POST")return res.status(405).json({error:"POST required"});
    const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{"x-duty-checker-key":process.env.DUTY_CHECKER_DB_KEY!}}});
    const {importId}=req.body??{};if(!importId)return res.status(400).json({error:"importId required"});
    const {data:duties,error}=await db.from("duties").select("*").eq("import_id",importId).order("sort_order");if(error)throw error;
    const allDuties=duties??[];
    const groups=new Map<string,any[]>();
    for(const d of allDuties)if(d.driver_name){const key=String(d.driver_name).trim().toUpperCase()==="ON HIRE"?`ON_HIRE:${d.id}`:d.driver_name;const a=groups.get(key)??[];a.push(d);groups.set(key,a)}

    const doubleMannedIds=new Set<string>(),doubleGroups=new Map<string,any[]>();
    for(const d of allDuties){
      if(!d.driver_name||!d.vehicle_id||!d.origin||!d.destination||!d.pickup_time)continue;
      const key=[d.vehicle_id,d.origin,d.destination,d.pickup_time].join("|").toLowerCase();
      const a=doubleGroups.get(key)??[];a.push(d);doubleGroups.set(key,a);
    }
    for(const rows of doubleGroups.values()){
      const drivers=[...new Set(rows.map(r=>r.driver_name).filter(Boolean))];
      if(drivers.length<2)continue;
      const starts=rows.map(r=>minutes(r.start_time)).filter((x:any)=>x!==null) as number[];if(!starts.length)continue;
      const earliest=Math.min(...starts);
      if(rows.every(r=>{const s=minutes(r.start_time);return s!==null&&spread(earliest,s)<=60}))rows.forEach(r=>doubleMannedIds.add(r.id));
    }

    let failures=0,invalidTimings=0;
    for(const rows of groups.values()){
      rows.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
      const starts=rows.map(r=>minutes(r.start_time)).filter((x:any)=>x!==null) as number[];
      const finishes=rows.map(r=>minutes(r.finish_time)).filter((x:any)=>x!==null) as number[];
      const isDoubleManned=rows.some(r=>doubleMannedIds.has(r.id));
      const maxWorkingDay=isDoubleManned?DOUBLE_MANNED_MAX:SINGLE_MANNED_MAX;
      const groupTimingErrors=rows.flatMap(r=>timingErrors(r).map(x=>({id:r.id,msg:x})));
      const connectionMinutes=rows.slice(0,-1).map(r=>r.connection_minutes??null) as (number|null)[];
      const dutyTimes=rows.map(r=>({start_time:r.start_time,pickup_time:r.pickup_time,leave_time:r.leave_time,arrival_time:r.arrival_time,finish_time:r.finish_time,back:Boolean(r.back),calculated_return_position_time:r.calculated_return_position_time,origin:r.origin,destination:r.destination,return_route_minutes:r.return_route_minutes??null,depot_return_route_minutes:r.depot_return_route_minutes??null,first_position_route_minutes:r.first_position_route_minutes??null,outbound_route_minutes:r.outbound_route_minutes??null}));

      const isOnHire=String(rows[0]?.driver_name??"").trim().toUpperCase()==="ON HIRE";
      if(isOnHire){for(const d of rows){const issues:string[]=[];if(d.capacity_status==="FAIL")issues.push("Vehicle "+(d.vehicle_id??"unknown")+" is over capacity: "+(d.seats??0)+" passengers against "+(d.vehicle_capacity??0)+" seats.");else if(d.capacity_status==="WARN")issues.push("Vehicle is not present in capacity master");if(d.route_status==="WARN"&&d.route_error)issues.push(d.route_error);if(d.connection_status==="FAIL"&&d.connection_error)issues.push(d.connection_error);issues.push("Driver is listed as ON HIRE; driver-hours/WTD compliance cannot be attributed to a named driver.");const overall=d.capacity_status==="FAIL"||d.connection_status==="FAIL"?"FAIL":"WARN";await db.from("duties").update({overall_status:overall,data_quality_status:"WARN",hours_status:"NOT_CHECKED",duty_minutes:null,driving_minutes:null,hours_issues:["Driver assignment required before driver-hours compliance can be assessed"],wtd_status:"NOT_CHECKED",wtd_minutes:null,wtd_issues:["Driver assignment required before WTD can be assessed"],break_minutes:0,break_allocations:[],wtd_break_allocated_minutes:0,eu_break_allocated_minutes:0,eu_break_status:"NOT_CHECKED",eu_break_issues:["Driver assignment required before driving-break compliance can be assessed"],issues,calculated_next_arrival_time:null,calculated_position_travel_minutes:null,calculated_position_available_minutes:null}).eq("id",d.id);}continue;}
      if(groupTimingErrors.length){
        invalidTimings+=groupTimingErrors.length;
        for(const d of rows){
          const own=groupTimingErrors.filter(x=>x.id===d.id).map(x=>x.msg);
          const issues=[...new Set([...own,...(d.connection_status==="FAIL"&&d.connection_error?[d.connection_error]:[])])];
          await db.from("duties").update({
            overall_status:(d.capacity_status==="FAIL"||d.connection_status==="FAIL")?"FAIL":"WARN",data_quality_status:own.length?"FAIL":"WARN",hours_status:"WARN",hours_issues:["Compliance blocked by invalid source timing"],
            wtd_status:"WARN",wtd_minutes:null,wtd_issues:["Compliance blocked by invalid source timing"],break_minutes:0,break_allocations:[],
            wtd_break_allocated_minutes:0,eu_break_allocated_minutes:0,eu_break_status:"NOT_CHECKED",eu_break_issues:["Compliance blocked by invalid source timing"],
            calculated_next_arrival_time:null,calculated_position_travel_minutes:null,calculated_position_available_minutes:null,
            issues:issues.length?issues:["Invalid source timing detected"],
            connection_status:d.connection_status==="FAIL"?"FAIL":"NOT_CHECKED"
          }).eq("id",d.id);
        }
        continue;
      }

      if(!starts.length||!finishes.length)continue;
      const daySpread=spread(Math.min(...starts),Math.max(...finishes));
      const hours=daySpread>maxWorkingDay?"FAIL":"PASS";
      const opportunities=scheduledBreakOpportunities(dutyTimes,connectionMinutes);
      const preliminaryWtdMinutes=wtdWorkingMinutes(daySpread,opportunities,0);
      const wtdTarget=preliminaryWtdMinutes>540?45:preliminaryWtdMinutes>360?30:0;
      const wtdAllocated=allocateWtdBreaks(opportunities,wtdTarget);
      const wtdTotal=wtdAllocated.reduce((s,o)=>s+(o.wtdAllocated??0),0);
      const actualWtdMinutes=wtdWorkingMinutes(daySpread,opportunities,wtdTotal);
      const wtd=wtdTotal>=wtdTarget?"PASS":"FAIL";
      const operationalDriving=rows.reduce((total,d,i)=>{let n=total+(i===0?(d.first_position_route_minutes??0):0)+(d.outbound_route_minutes??0);if(i<rows.length-1)n+=d.back?(d.return_route_minutes??0):(d.connection_minutes??0);else n+=d.back?(d.return_route_minutes??0)+(d.depot_return_route_minutes??0):(d.return_route_minutes??0);return n},0);
      const euPlan=planEuDrivingBreaks(dutyTimes,connectionMinutes);
      const euTotal=euPlan.plans.reduce((s,p)=>s+p.minutes,0);
      const euTarget=operationalDriving>270?45:0;
      const euStatus=euPlan.status==="FAIL"?"FAIL":euTarget===0?"NOT_REQUIRED":euTotal>=euTarget?"PASS":"FAIL";
      if(hours==="FAIL"||wtd==="FAIL"||euStatus==="FAIL")failures++;

      for(let i=0;i<rows.length;i++){
        const d=rows[i],next=rows[i+1];
        const dutyBreaks=opportunities.map((o,idx)=>({...o,wtdAllocated:wtdAllocated[idx]?.wtdAllocated??0,euAllocated:euPlan.plans.filter(p=>p.start===o.start&&p.end===o.end).reduce((s,p)=>s+p.minutes,0)})).filter(o=>o.dutyIndex===i&&(o.wtdAllocated>0||o.euAllocated>0||(o.source==="between_jobs"&&o.minutes>=15)));
        const previousEndTime=d.back&&d.calculated_return_position_time?d.calculated_return_position_time:d.arrival_time;
        const nextTravel=next?.connection_minutes??null;
        const calculatedNextArrivalTime=next&&previousEndTime&&nextTravel!=null?addMinutes(previousEndTime,nextTravel):null;
        const calculatedPositionAvailableMinutes=next&&previousEndTime&&next.pickup_time?duration(previousEndTime,next.pickup_time,true):null;
        const issues:string[]=[];
        if(d.capacity_status==="FAIL")issues.push("Vehicle "+(d.vehicle_id??"unknown")+" is over capacity: "+(d.seats??0)+" passengers against "+(d.vehicle_capacity??0)+" seats.");
        else if(d.capacity_status==="WARN")issues.push("Vehicle is not present in capacity master");
        if(hours==="FAIL")issues.push(isDoubleManned?"Double-manned working day exceeds the configured 21-hour threshold":"Working day exceeds the configured 15-hour screening threshold");
        if(d.connection_status==="FAIL"&&d.connection_error)issues.push(d.connection_error);
        if(euStatus==="FAIL")issues.push(euPlan.issue??"Insufficient scheduled EU/assimilated driving-break opportunity");
        const firstPositionIssue=d.first_position_status==="FAIL"?d.first_position_error:null;if(firstPositionIssue)issues.push(firstPositionIssue);
        const routeWarn=d.route_status==="WARN"||d.route_error;
        const connectionWarn=d.connection_status==="WARN";
        const dataQuality=d.capacity_status==="WARN"||routeWarn||connectionWarn?"WARN":"PASS";
        const overall=d.capacity_status==="FAIL"||hours==="FAIL"||wtd==="FAIL"||euStatus==="FAIL"||d.connection_status==="FAIL"||Boolean(firstPositionIssue)?"FAIL":dataQuality==="WARN"?"WARN":"PASS";
        const hoursIssues=hours==="FAIL"?[isDoubleManned?"Double-manned working day exceeds the configured 21-hour screening threshold":"Working day exceeds the configured 15-hour screening threshold"]:[isDoubleManned?"Double-manned duty identified, 21-hour working-day threshold applied":"15-hour single-manned working-day threshold applied"];
        const wtdIssues=wtd==="FAIL"?[`Need ${wtdTarget} min WTD break; only ${wtdTotal} min has been allocated from scheduled opportunities (WTD working time ${actualWtdMinutes} min)`]:[`WTD break allocated: ${wtdTotal}/${wtdTarget} min`];
        const plannedEu=euPlan.plans.map(p=>`${p.minutes} min ${p.start}–${p.end}`).join(", ");
        const dutyWtdAllocated=dutyBreaks.reduce((s,o)=>s+(o.wtdAllocated??0),0);
        const dutyEuAllocated=dutyBreaks.reduce((s,o)=>s+(o.euAllocated??0),0);
        const dutyDriving=(i===0?(d.first_position_route_minutes??0):0)+(d.outbound_route_minutes??0)+(d.back?(d.return_route_minutes??0):0)+(i<rows.length-1?(d.connection_minutes??0):(d.back?(d.depot_return_route_minutes??0):(d.return_route_minutes??0)));
        const dutyEuIssues=euStatus==="FAIL"
          ? [`Driver-day EU/assimilated break requirement: ${euTarget} min; daily plan allocated ${euTotal} min`,euPlan.issue??"Driver reaches 4.5 hours driving before a qualifying break can be completed."]
          : [dutyEuAllocated>0?`This duty carries ${dutyEuAllocated} min of the driver's planned EU/assimilated break allocation`:"No EU/assimilated break allocated on this duty"];
        await db.from("duties").update({
          overall_status:overall,data_quality_status:dataQuality,hours_status:hours,duty_minutes:daySpread,driving_minutes:dutyDriving,break_minutes:dutyWtdAllocated,hours_issues:hoursIssues,
          wtd_status:wtd,wtd_minutes:actualWtdMinutes,wtd_issues:[`Driver-day WTD allocation: ${wtdTotal}/${wtdTarget} min`,...wtdIssues],
          issues,break_allocations:dutyBreaks,
          wtd_break_allocated_minutes:dutyWtdAllocated,eu_break_allocated_minutes:dutyEuAllocated,eu_break_status:euStatus,eu_break_issues:dutyEuIssues,
          calculated_next_arrival_time:calculatedNextArrivalTime,calculated_position_travel_minutes:nextTravel,calculated_position_available_minutes:calculatedPositionAvailableMinutes,
          connection_status:next?d.connection_status??"NOT_CHECKED":"NOT_CHECKED"
        }).eq("id",d.id);
      }
    }
    return res.json({importId,drivers:groups.size,duties:allDuties.length,failures,invalidTimings});
  }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"Compliance calculation failed"})}
}