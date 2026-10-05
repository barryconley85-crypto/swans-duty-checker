import {createClient} from "@supabase/supabase-js";
import {minutes,duration,spread,screenWorkingDay,screenWtdBreak,scheduledBreakMinutes} from "../src/lib/compliance.js";

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
      const breaks=scheduledBreakMinutes(rows,connectionMinutes);
      const wtd=screenWtdBreak(daySpread,breaks);

      if(hours==="FAIL")failures++;

      const overlapIssues:string[]=[];
      for(let i=0;i<rows.length-1;i++){
        const a=minutes(rows[i].arrival_time),b=minutes(rows[i+1].pickup_time);
        if(a!==null&&b!==null&&spread(a,b)<0)overlapIssues.push("Operational timing overlap detected");
      }

      for(const d of rows){
        const issues:string[]=[];
        if(d.capacity_status==="FAIL"||d.capacity_status==="WARN")issues.push("Vehicle is not present in capacity master");
        if(hours==="FAIL")issues.push("Working day exceeds the configured 15-hour screening threshold");
        if(d.connection_status==="FAIL"&&d.connection_error)issues.push(d.connection_error);
        const overall=d.capacity_status==="FAIL"||hours==="FAIL"||wtd==="FAIL"||d.connection_status==="FAIL"?"FAIL":d.capacity_status==="WARN"?"WARN":"PASS";
        const hoursIssues=hours==="FAIL"?["Working day exceeds the configured 15-hour screening threshold"]:["15-hour spread screening passed"];
        const wtdIssues=wtd==="FAIL"?["Insufficient scheduled WTD break opportunity"]:["Scheduled WTD break opportunity passed"];
        await db.from("duties").update({
          overall_status:overall,
          hours_status:hours,
          duty_minutes:daySpread,
          break_minutes:breaks,
          hours_issues:hoursIssues,
          wtd_status:wtd,
          wtd_minutes:daySpread,
          wtd_issues:wtdIssues,
          issues
        }).eq("id",d.id);
      }
    }
    return res.json({importId,drivers:groups.size,duties:duties?.length??0,failures});
  }catch(e){
    return res.status(400).json({error:e instanceof Error?e.message:"Compliance calculation failed"});
  }
}
