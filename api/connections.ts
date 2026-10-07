import {createClient} from "@supabase/supabase-js";
import {geocodeMany,routeEdges} from "./routes";

const depot="Swans Travel, Broadgate, Chadderton, OL9 9XA";
const mins=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
const span=(a:number,b:number)=>b>=a?b-a:b+1440-a;

export default async function handler(req:any,res:any){
  try{
    if(req.method!=="POST")return res.status(405).json({error:"POST required"});
    const url=process.env.SUPABASE_URL,pub=process.env.SUPABASE_PUBLISHABLE_KEY,internal=process.env.DUTY_CHECKER_DB_KEY;
    if(!url||!pub||!internal)return res.status(503).json({error:"Supabase is not configured"});
    const {importId}=req.body??{}; if(!importId)return res.status(400).json({error:"importId required"});
    const db=createClient(url,pub,{global:{headers:{"x-duty-checker-key":internal}}});
    const {data:rows,error}=await db.from("duties").select("*").eq("import_id",importId).order("sort_order");
    if(error)throw error;
    const all=rows??[];
    if(!all.length)return res.json({importId,connectionsChecked:0,connectionFailures:0,warnings:0});
    const {data:master,error:masterError}=await db.from("contract_route_master").select("alias,postcode,service_key").eq("active",true);
    if(masterError)throw masterError;
    const masterPostcodes:Record<string,string>={};
    for(const x of master??[])if(x.alias&&x.postcode)masterPostcodes[x.alias]=x.postcode;
    const groups=new Map<string,any[]>();
    for(const d of all){
      const key=d.driver_name?String(d.driver_name):`ON_HIRE:${d.id}`;
      const a=groups.get(key)??[]; a.push(d); groups.set(key,a);
    }
    const jobs:{prev:any,next:any;from:string;to:string}[]=[];
    for(const group of groups.values()){
      group.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
      for(let i=0;i<group.length-1;i++){
        const prev=group[i],next=group[i+1];
        const previousEndLocation=prev.back&&prev.calculated_return_position_time?prev.origin:prev.destination;
        const previousEndTime=prev.back&&prev.calculated_return_position_time?prev.calculated_return_position_time:prev.arrival_time;
        if(!previousEndLocation||!next.origin||!previousEndTime||!next.pickup_time)continue;
        jobs.push({prev,next,from:String(previousEndLocation),to:String(next.origin)});
      }
    }
    const locations=[depot,...jobs.flatMap(j=>[j.from,j.to])];
    const points=await geocodeMany(locations,process.env.OPENROUTESERVICE_API_KEY,masterPostcodes);
    const edges=[] as any[];
    const edgeJobs=new Map<string,typeof jobs>();
    for(const j of jobs){
      const a=points.get(j.from),b=points.get(j.to);
      if(!a||!b)continue;
      const key=a.map((v:number)=>v.toFixed(6)).join(",")+"|"+b.map((v:number)=>v.toFixed(6)).join(",");
      edges.push({key,from:a,to:b});
      const list=edgeJobs.get(key)??[];list.push(j);edgeJobs.set(key,list);
    }
    const routes=await routeEdges(edges);
    const updates:any[]=[];
    let checked=0,failures=0,warnings=0;
    for(const j of jobs){
      const previousEndLocation=j.prev.back&&j.prev.calculated_return_position_time?j.prev.origin:j.prev.destination;
      const previousEndTime=j.prev.back&&j.prev.calculated_return_position_time?j.prev.calculated_return_position_time:j.prev.arrival_time;
      const a=points.get(j.from),b=points.get(j.to);
      if(!a||!b){
        warnings++;
        updates.push({id:j.next.id,connection_status:"WARN",connection_error:`Could not resolve physical connection point: ${j.from} → ${j.to}`,connection_minutes:null,connection_available_minutes:null});
        continue;
      }
      const key=a.map((v:number)=>v.toFixed(6)).join(",")+"|"+b.map((v:number)=>v.toFixed(6)).join(",");
      const required=routes.get(key);
      const available=span(mins(previousEndTime)!,mins(j.next.pickup_time)!);
      if(required==null){
        warnings++;
        updates.push({id:j.next.id,connection_status:"WARN",connection_error:`Could not calculate school-to-school connection: ${j.from} → ${j.to}`,connection_minutes:null,connection_available_minutes:available});
        continue;
      }
      checked++;
      if(required>available){
        failures++;
        updates.push({id:j.next.id,connection_status:"FAIL",connection_error:`Connection impossible: ${previousEndLocation} → ${j.next.origin} needs about ${required} min but only ${available} min is available between passenger journeys.`,connection_minutes:required,connection_available_minutes:available,overall_status:"FAIL"});
      }else updates.push({id:j.next.id,connection_status:"PASS",connection_error:null,connection_minutes:required,connection_available_minutes:available});
    }
    for(let i=0;i<updates.length;i+=10)await Promise.all(updates.slice(i,i+10).map(u=>db.from("duties").update(u).eq("id",u.id)));
    return res.json({importId,connectionsChecked:checked,connectionFailures:failures,warnings,processed:updates.length});
  }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"Connection check failed"})}
}
