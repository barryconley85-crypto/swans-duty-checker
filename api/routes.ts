import {createClient} from "@supabase/supabase-js";

const depot="Swans Travel, Broadgate, Chadderton, OL9 9XA";
const depotPostcode="OL9 9XA";
type Point=[number,number];
type Edge={key:string,from:Point,to:Point};

const mins=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
const span=(a:number,b:number)=>b>=a?b-a:b+1440-a;
const add=(v:string,n:number)=>{const base=mins(v);if(base===null)throw Error("Cannot calculate from missing time");const x=((base+n)%1440+1440)%1440;return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0")};

const pointKey=(p:Point)=>p.map(v=>v.toFixed(6)).join(",");
const edgeKey=(a:Point,b:Point)=>pointKey(a)+"|"+pointKey(b);
const postcodeOf=(q:string)=>q.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1]?.replace(/\s+/g," ").toUpperCase()??null;
const knownLocationPostcodes:Record<string,string>={
  "Manchester Grammar School":"M13 0XT",
  "Savio House, Ingersley Road, Bollington,":"SK10 5RW",
  "ST BEDES AM HALE":"M16 8HX",
  "ST BEDES AM 1":"M16 8HX",
  "ST BEDES AM 2":"M16 8HX",
  "ST BEDES AM 3":"M16 8HX",
  "ST BEDES AM 4":"M16 8HX",
  "ST BEDES AM 5":"M16 8HX",
  "ST BEDES AM 6":"M16 8HX",
  "ST BEDES AM 7":"M16 8HX",
  "ST BEDES PM 1":"M16 8HX",
  "ST BEDES PM 2":"M16 8HX",
  "ST BEDES PM 3":"M16 8HX",
  "ST BEDES PM 4":"M16 8HX",
  "ST BEDES PM 5":"M16 8HX",
  "ST BEDES PM 6":"M16 8HX",
  "ST BEDES PM 7":"M16 8HX",
  "ST BEDES AM":"M16 8HX",
  "ST BEDES PM":"M16 8HX",
  "Altrincham School Bus.":"WA14 1EN",
  "Altrincham PM":"WA14 1EN"
};

async function geocodePostcodes(postcodes:string[]){
  const out=new Map<string,Point>();
  for(let i=0;i<postcodes.length;i+=100){
    const batch=postcodes.slice(i,i+100);
    const r=await fetch("https://api.postcodes.io/postcodes",{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Swans-Duty-Checker/1.0"},body:JSON.stringify({postcodes:batch})});
    if(!r.ok)continue;
    const j:any=await r.json();
    for(const item of j.result??[]){
      const p=item.result;
      if(p?.longitude!=null&&p?.latitude!=null)out.set(item.query.replace(/\s+/g," ").toUpperCase(),[Number(p.longitude),Number(p.latitude)]);
    }
  }
  return out;
}

async function geocodeMany(locations:string[],key?:string){
  const result=new Map<string,Point>();
  const postcodeMap=await geocodePostcodes([...new Set([...locations.map(postcodeOf).filter(Boolean) as string[],...Object.values(knownLocationPostcodes)])]);
  for(const q of locations){
    const pc=knownLocationPostcodes[q]??postcodeOf(q);
    if(pc){const p=postcodeMap.get(pc);if(p)result.set(q,p);}
  }
  if(!result.has(depot)){
    const p=postcodeMap.get(depotPostcode);if(p)result.set(depot,p);
  }

  const remaining=locations.filter(q=>!result.has(q));
  const geoBatches:string[][]=[];for(let i=0;i<remaining.length;i+=5)geoBatches.push(remaining.slice(i,i+5));
  for(let i=0;i<geoBatches.length;i+=3){
    const chunk=geoBatches.slice(i,i+3);
    const all=await Promise.all(chunk.map(batch=>Promise.allSettled(batch.map(async q=>{
      if(key){
        const u=new URL("https://api.heigit.org/pelias/v1/search");
        u.searchParams.set("api_key",key);u.searchParams.set("text",q);u.searchParams.set("boundary.country","GBR");
        const r=await fetch(u,{headers:{Authorization:key}});
        if(r.ok){const j:any=await r.json();const c=j.features?.[0]?.geometry?.coordinates;if(c)return [q,[Number(c[0]),Number(c[1])] as Point] as const;}
      }
      const clean=q.replace(/\\b(AM|PM|RUN\\d+)\\b/gi,"").replace(/[*]/g,"").trim();
      const photon=new URL("https://photon.komoot.io/api/");
      photon.searchParams.set("q",clean);photon.searchParams.set("limit","1");photon.searchParams.set("countrycode","GB");
      const pr=await fetch(photon,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
      if(pr.ok){const pj:any=await pr.json();const pc=pj.features?.[0]?.geometry?.coordinates;if(pc)return [q,[Number(pc[0]),Number(pc[1])] as Point] as const;}
      const u=new URL("https://nominatim.openstreetmap.org/search");
      u.searchParams.set("q",clean+" UK");u.searchParams.set("format","json");u.searchParams.set("limit","1");
      const r=await fetch(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
      if(!r.ok)throw Error("Geocode failed "+r.status);
      const j:any=await r.json();if(!j[0])throw Error("Location could not be geocoded: "+q);
      return [q,[Number(j[0].lon),Number(j[0].lat)] as Point] as const;
    }))));
    for(const vals of all)for(const v of vals)if(v.status==="fulfilled")result.set(v.value[0],v.value[1]);
  }
  if(!result.has(depot))throw Error("Depot postcode could not be geocoded: "+depotPostcode);
  return result;
}

async function matrixBatch(edges:Edge[]){
  const points:Point[]=[];const index=new Map<string,number>();
  const idx=(p:Point)=>{const k=pointKey(p);const old=index.get(k);if(old!==undefined)return old;const i=points.length;points.push(p);index.set(k,i);return i};
  const pairs=edges.map(e=>({from:idx(e.from),to:idx(e.to),key:e.key}));
  const sources=[...new Set(pairs.map(p=>p.from))],destinations=[...new Set(pairs.map(p=>p.to))];
  const u=new URL("https://router.project-osrm.org/table/v1/driving/"+points.map(p=>p.join(",")).join(";"));
  u.searchParams.set("sources",sources.join(";"));u.searchParams.set("destinations",destinations.join(";"));u.searchParams.set("annotations","duration");
  const r=await fetch(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
  if(!r.ok)throw Error("OSRM matrix failed "+r.status);
  const j:any=await r.json();if(j.code!=="Ok")throw Error("OSRM matrix returned "+(j.code??"unknown error"));
  const destIndex=new Map(destinations.map((v,i)=>[v,i]));const out=new Map<string,number>();
  for(const p of pairs){const seconds=j.durations?.[sources.indexOf(p.from)]?.[destIndex.get(p.to)!];if(seconds!=null)out.set(p.key,Math.ceil(Number(seconds)/60));}
  return out;
}

async function routeEdges(edges:Edge[]){
  const out=new Map<string,number>(),batches:Edge[][]=[];
  for(let i=0;i<edges.length;i+=20)batches.push(edges.slice(i,i+20));
  for(let i=0;i<batches.length;i+=4){
    const results=await Promise.all(batches.slice(i,i+4).map(async batch=>{
      try{return await matrixBatch(batch)}catch{
        const vals=await Promise.all(batch.map(async e=>{
          const u="https://router.project-osrm.org/route/v1/driving/"+e.from.join(",")+";"+e.to.join(",")+"?overview=false";
          const r=await fetch(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
          if(!r.ok)throw Error("Routing failed "+r.status);
          const j:any=await r.json();const d=j.routes?.[0]?.duration;if(!d)throw Error("No route returned");
          return [e.key,Math.ceil(Number(d)/60)] as const;
        }));
        return new Map(vals);
      }
    }));
    for(const m of results)for(const [k,v] of m)out.set(k,v);
  }
  return out;
}

export default async function handler(req:any,res:any){
  try{
    if(req.method!=="POST")return res.status(405).json({error:"POST required"});
    const url=process.env.SUPABASE_URL,pub=process.env.SUPABASE_PUBLISHABLE_KEY,internal=process.env.DUTY_CHECKER_DB_KEY;
    if(!url||!pub||!internal)return res.status(503).json({error:"Supabase is not configured"});
    const {importId}=req.body??{};if(!importId)return res.status(400).json({error:"importId required"});
    const db=createClient(url,pub,{global:{headers:{"x-duty-checker-key":internal}}});
    const {data,error}=await db.from("duties").select("*").eq("import_id",importId).order("sort_order");if(error)throw error;
    const allRows=data??[],offset=Math.max(0,Number(req.body?.offset??0)),limit=Math.min(40,Math.max(1,Number(req.body?.limit??40)));
    const selectedRows=allRows.slice(offset,offset+limit);
    if(!selectedRows.length)return res.json({importId,processed:0,nextOffset:null,reconstructed:0,warnings:0,connectionsChecked:0,connectionFailures:0,routingProvider:"Postcodes.io + Photon/Nominatim + OSRM matrix"});
    const selectedIds=new Set(selectedRows.map(d=>d.id));
    const workRows=allRows.slice(Math.max(0,offset-1),Math.min(allRows.length,offset+limit+1));
    const locations=[...new Set(workRows.flatMap(d=>[d.origin,d.destination].filter(Boolean)).concat([depot]))] as string[];
    const points=await geocodeMany(locations,process.env.OPENROUTESERVICE_API_KEY);
    const groups=new Map<string,any[]>();
    for(const d of workRows)if(d.driver_name){const a=groups.get(d.driver_name)??[];a.push(d);groups.set(d.driver_name,a)}
    const edgeMap=new Map<string,Edge>(),dutyEdges=new Map<string,{outbound:string,ret:string,backReturn?:string,backFinish?:string}>();
    for(const d of selectedRows){
      const a=d.origin?points.get(d.origin):null,b=d.destination?points.get(d.destination):null;if(!a||!b)continue;
      const out=edgeKey(a,b),ret=edgeKey(b,points.get(depot)!);edgeMap.set(out,{key:out,from:a,to:b});edgeMap.set(ret,{key:ret,from:b,to:points.get(depot)!});let backReturn:string|undefined,backFinish:string|undefined;if(d.back){backReturn=edgeKey(b,a);backFinish=edgeKey(a,points.get(depot)!);edgeMap.set(backReturn,{key:backReturn,from:b,to:a});edgeMap.set(backFinish,{key:backFinish,from:a,to:points.get(depot)!});}dutyEdges.set(d.id,{outbound:out,ret,backReturn,backFinish});
    }
    let connectionEdges=new Map<string,string>();
    let routeTimes=await routeEdges([...edgeMap.values()]);
    let reconstructed=0,warnings=0,connectionsChecked=0,connectionFailures=0;
    const updates:any[]=[];
    for(const d of selectedRows){
      const e=dutyEdges.get(d.id);if(!e)continue;
      try{
        const outbound=routeTimes.get(e.outbound),ret=d.back?routeTimes.get(e.backReturn!):routeTimes.get(e.ret),backFinish=e.backFinish?routeTimes.get(e.backFinish):null;
        const arrivalWasMissing=!d.arrival_time,finishWasMissing=!d.finish_time;
        let arrival=d.arrival_time,returnArrival=d.return_arrival_time,calculatedReturnPosition=d.calculated_return_position_time,finish=d.finish_time;
        if(!arrival){if(outbound==null)throw Error("No outbound route could be calculated");if(!d.leave_time)throw Error("Missing Leave time");arrival=add(d.leave_time,outbound);reconstructed++}
        if(d.back){const returnLeave=d.return_leave_time??d.leave_time;if(!returnLeave)throw Error("Missing return departure time");if(ret==null)throw Error("No return passenger route could be calculated");calculatedReturnPosition=add(returnLeave,ret);reconstructed++}
        if(!finish){if(d.back){if(!calculatedReturnPosition)throw Error("Missing calculated return position time");if(backFinish==null)throw Error("No depot return route could be calculated after the return passenger journey");finish=add(calculatedReturnPosition,backFinish);reconstructed++}else{if(ret==null)throw Error("No return route could be calculated");if(!d.leave_time)throw Error("Missing Leave time for depot return");finish=add(d.leave_time,ret);reconstructed++}}
        d.arrival_time=arrival;d.return_arrival_time=returnArrival;d.finish_time=finish;
        updates.push({id:d.id,arrival_time:arrival,return_arrival_time:returnArrival,calculated_return_position_time:calculatedReturnPosition,finish_time:finish,arrival_estimated:arrivalWasMissing,finish_estimated:finishWasMissing,route_status:"CALCULATED",route_error:null,outbound_route_minutes:outbound??null,return_route_minutes:ret??null,depot_return_route_minutes:backFinish??null});
      }catch(err){warnings++;updates.push({id:d.id,route_status:"WARN",route_error:err instanceof Error?err.message:"Route failed"})}
    }
    for(let i=0;i<updates.length;i+=15)await Promise.all(updates.slice(i,i+15).map(u=>db.from("duties").update(u).eq("id",u.id)));

    connectionEdges=new Map<string,string>();
    const connectionEdgesToRoute:Edge[]=[];
    for(const group of groups.values()){
      group.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
      for(let i=0;i<group.length-1;i++){
        const prev=group[i],next=group[i+1];
        const previousEndLocation=prev.back&&prev.calculated_return_position_time?prev.origin:prev.destination;
        // Operational chaining ends when the passenger journey is complete.
        // Contractual Start/Finish times are duty-time markers, not school-to-school movement constraints.
        const previousEndTime=prev.back&&prev.calculated_return_position_time
          ? prev.calculated_return_position_time
          : prev.arrival_time;
        if(!selectedIds.has(next.id)||!previousEndLocation||!next.origin||!previousEndTime||!next.pickup_time)continue;
        const a=points.get(previousEndLocation),b=points.get(next.origin);if(!a||!b)continue;
        const k=edgeKey(a,b);connectionEdges.set(next.id,k);connectionEdgesToRoute.push({key:k,from:a,to:b});
      }
    }
    if(connectionEdgesToRoute.length){const connectionTimes=await routeEdges(connectionEdgesToRoute);for(const [k,v] of connectionTimes)routeTimes.set(k,v);}
    for(const group of groups.values()){
      group.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
      for(let i=0;i<group.length-1;i++){
        const prev=group[i],next=group[i+1],k=connectionEdges.get(next.id);
        const previousEndLocation=prev.back&&prev.calculated_return_position_time?prev.origin:prev.destination;
        // Use passenger journey completion/arrival, never the contractual depot Finish or departure time.
        const previousEndTime=prev.back&&prev.calculated_return_position_time
          ? prev.calculated_return_position_time
          : prev.arrival_time;
        if(!selectedIds.has(next.id)||!k||!previousEndTime||!next.pickup_time)continue;
        connectionsChecked++;const required=routeTimes.get(k);
        if(required==null){warnings++;await db.from("duties").update({connection_status:"WARN",connection_error:"Could not calculate school-to-school connection time"}).eq("id",next.id);continue}
        const available=span(mins(previousEndTime)!,mins(next.pickup_time)!);
        if(required>available){connectionFailures++;const msg=`Connection impossible: ${previousEndLocation} → ${next.origin} needs about ${required} min but only ${available} min is available between passenger journeys.`;await db.from("duties").update({connection_status:"FAIL",connection_error:msg,connection_minutes:required,connection_available_minutes:available,overall_status:"FAIL"}).eq("id",next.id)}
        else await db.from("duties").update({connection_status:"PASS",connection_error:null,connection_minutes:required,connection_available_minutes:available}).eq("id",next.id);
      }
    }
    return res.json({importId,processed:selectedRows.length,nextOffset:offset+selectedRows.length<allRows.length?offset+selectedRows.length:null,reconstructed,warnings,connectionsChecked,connectionFailures,routingProvider:"Postcodes.io + Photon/Nominatim + OSRM matrix"});
  }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"Route reconstruction failed"})}
}
