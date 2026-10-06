import {createClient} from "@supabase/supabase-js";
import {minutes,spread,duration,addMinutes,screenWorkingDay,screenWtdBreak,scheduledBreakOpportunities,allocateWtdBreaks,allocateEuBreaks,planEuDrivingBreaks} from "../src/lib/compliance.js";

export default async function handler(req:any,res:any){
  try{
    if(req.method!=="POST")return res.status(405).json({error:"POST required"});
    const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{"x-duty-checker-key":process.env.DUTY_CHECKER_DB_KEY!}}});
    const {importId}=req.body??{};
    if(!importId)return res.status(400).json({error:"importId required"});
    const {data:duties,error}=await db.from("duties").select("*").eq("import_id",importId).order("sort_order");
    if(error)throw error;

    const groups=new Map<string,any[]>();
    for(const d of duties??[]){
      if(d.driver_name){
        const a=groups.get(d.driver_name)??[];
        a.push(d);
        groups.set(d.driver_name,a);
      }
    }

    let failures=0;
    for(const rows of groups.values()){
      const starts=rows.map(r=>minutes(r.start_time)).filter((x:any)=>x!==null) as number[];
      const finishes=rows.map(r=>minutes(r.finish_time)).filter((x:any)=>x!==null) as number[];
      if(!starts.length||!finishes.length)continue;

      const daySpread=spread(Math.min(...starts),Math.max(...finishes));
      const hours=screenWorkingDay(daySpread);
      const connectionMinutes=rows.slice(0,-1).map(r=>r.connection_minutes??null) as (number|null)[];
      const dutyTimes=rows.map(r=>({
        start_time:r.start_time,pickup_time:r.pickup_time,leave_time:r.leave_time,arrival_time:r.arrival_time,finish_time:r.finish_time,
        back:Boolean(r.back),calculated_return_position_time:r.calculated_return_position_time,origin:r.origin,destination:r.destination
      }));
      const opportunities=scheduledBreakOpportunities(dutyTimes,connectionMinutes);
      const wtdTarget=daySpread>540?45:daySpread>360?30:0;
      const wtdAllocated=allocateWtdBreaks(opportunities,wtdTarget);
      const wtdTotal=wtdAllocated.reduce((s,o)=>s+(o.wtdAllocated??0),0);
      const wtd=screenWtdBreak(daySpread,wtdTotal);

      const operationalDriving=rows.reduce((total,d,i)=>{
        let n=total+(d.outbound_route_minutes??0);
        if(i<rows.length-1){
          n+=d.back?(d.return_route_minutes??0):(d.connection_minutes??0);
        }else{
          n+=d.back?(d.return_route_minutes??0)+(d.depot_return_route_minutes??0):(d.return_route_minutes??0);
        }
        return n;
      },0);
      const euPlan=planEuDrivingBreaks(dutyTimes,connectionMinutes);
      const euTarget=operationalDriving>270?45:0;
      const euAllocated=allocateEuBreaks(opportunities,euTarget);
      const euTotal=euAllocated.reduce((s,o)=>s+(o.euAllocated??0),0);
      const euStatus=euPlan.status==="FAIL"?"FAIL":euTarget===0?"NOT_REQUIRED":euTotal>=euTarget?"PASS":"FAIL";

      if(hours==="FAIL"||wtd==="FAIL"||euStatus==="FAIL")failures++;

      for(let i=0;i<rows.length;i++){
        const d=rows[i];
        const dutyBreaks=opportunities.map((o,idx)=>({...o,wtdAllocated:wtdAllocated[idx]?.wtdAllocated??0,euAllocated:euAllocated[idx]?.euAllocated??0})).filter(o=>o.dutyIndex===i&&(o.wtdAllocated>0||o.euAllocated>0||o.source==="between_jobs"&&o.minutes>=15));
        const next=rows[i+1];
        const previousEndTime=d.back&&d.calculated_return_position_time?d.calculated_return_position_time:d.arrival_time;
        const nextTravel=next?.connection_minutes??null;
        const calculatedNextArrivalTime=next&&previousEndTime&&nextTravel!=null?addMinutes(previousEndTime,nextTravel):null;
        const calculatedPositionAvailableMinutes=next&&previousEndTime&&next.pickup_time?duration(previousEndTime,next.pickup_time):null;
        const issues:string[]=[];
        if(d.capacity_status==="FAIL"||d.capacity_status==="WARN")issues.push("Vehicle is not present in capacity master");
        if(hours==="FAIL")issues.push("Working day exceeds the configured 15-hour screening threshold");
        if(d.connection_status==="FAIL"&&d.connection_error)issues.push(d.connection_error);
        if(euStatus==="FAIL")issues.push("Insufficient scheduled EU/assimilated driving-break opportunity");
        const overall=d.capacity_status==="FAIL"||hours==="FAIL"||wtd==="FAIL"||euStatus==="FAIL"||d.connection_status==="FAIL"?"FAIL":d.capacity_status==="WARN"?"WARN":"PASS";
        const hoursIssues=hours==="FAIL"?["Working day exceeds the configured 15-hour screening threshold"]:[];
        const wtdIssues=wtd==="FAIL"?[`Need ${wtdTarget} min WTD break; only ${wtdTotal} min has been allocated from scheduled opportunities`]:[`WTD break allocated: ${wtdTotal}/${wtdTarget} min`];
        const plannedEu=euPlan.plans.map(p=>`${p.minutes} min ${p.start}–${p.end}`).join(", ");
        const euIssues=euStatus==="FAIL"?[(euPlan.issue??`Need 45 min EU/assimilated break; only ${euTotal} min can be allocated from qualifying scheduled opportunities`)]:[plannedEu?`Planned driving breaks: ${plannedEu}`:`EU/assimilated break allocated: ${euTotal}/${euTarget} min`];
        await db.from("duties").update({
          overall_status:overall,
          hours_status:hours,
          duty_minutes:daySpread,
          break_minutes:wtdTotal,
          hours_issues:hoursIssues,
          wtd_status:wtd,
          wtd_minutes:daySpread,
          wtd_issues:wtdIssues,
          issues,
          break_allocations:dutyBreaks,
          wtd_break_allocated_minutes:wtdTotal,
          eu_break_allocated_minutes:euTotal,
          eu_break_status:euStatus,
          eu_break_issues:euIssues,
          calculated_next_arrival_time:calculatedNextArrivalTime,
          calculated_position_travel_minutes:nextTravel,
          calculated_position_available_minutes:calculatedPositionAvailableMinutes
        }).eq("id",d.id);
      }
    }
    return res.json({importId,drivers:groups.size,duties:duties?.length??0,failures});
  }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"Compliance calculation failed"});}
}
