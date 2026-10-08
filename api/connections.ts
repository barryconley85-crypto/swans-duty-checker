import {createClient} from "@supabase/supabase-js";
import {geocodeMany,routeEdges} from "./routes.js";
import {dutyEnd,groupDuties} from "../src/lib/dutySequence.js";

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
    const groups=groupDuties(all);
    const jobs:{prev:any,next:any;from:string;to:string;previousEnd:ReturnType<typeof dutyEnd>}[]=[];
    const precheckUpdates:any[]=[];
    for(const group of groups.values()){
      for(let i=0;i<group.length-1;i++){
        const prev=group[i],next=group[i+1],previousEnd=dutyEnd(prev);
        if(prev.route_status!=="CALCULATED"){
          precheckUpdates.push({id:next.id,connection_status:"WARN",connection_error:"Connection not checked because the previous duty route is not certified ("+(prev.route_status??"NOT_CHECKED")+").",connection_minutes:null,connection_available_minutes:null});
          continue;
        }
        if(!previousEnd||!next.origin||!next.pickup_time){
          precheckUpdates.push({id:next.id,connection_status:"WARN",connection_error:"Connection not checked because a physical end point or timetable time is missing.",connection_minutes:null,connection_available_minutes:null});
          continue;
        }
        jobs.push({prev,next,from:previousEnd.location,to:String(next.origin),previousEnd});
      }
    }
    for(let i=0;i<precheckUpdates.length;i+=10)await Promise.all(precheckUpdates.slice(i,i+10).map(u=>db.from("duties").update(u).eq("id",u.id)));
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
      const previousEndLocation=j.previousEnd?.location;
      const previousEndTime=j.previousEnd?.time;
      const a=points.get(j.from),b=points.get(j.to);
      if(!a||!b){
        warnings++;
        updates.push({id:j.next.id,connection_status:"WARN",connection_error:`Could not resolve physical connection point: ${j.from} → ${j.to}`,connection_minutes:null,connection_available_minutes:null});
        continue;
      }
      const key=a.map((v:number)=>v.toFixed(6)).join(",")+"|"+b.map((v:number)=>v.toFixed(6)).join(",");
      const required=routes.get(key);
      const previousEndMinutes=mins(previousEndTime??null),nextPickupMinutes=mins(j.next.pickup_time); if(previousEndMinutes===null||nextPickupMinutes===null){warnings++;updates.push({id:j.next.id,connection_status:"WARN",connection_error:"Connection not checked because a valid end or pickup time is missing.",connection_minutes:null,connection_available_minutes:null});continue;} const available=span(previousEndMinutes,nextPickupMinutes);
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
