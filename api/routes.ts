import {createClient} from "@supabase/supabase-js";
import {groupDuties} from "../src/lib/dutySequence.js";

const depot="Swans Travel, Broadgate, Chadderton, OL9 9XA";
const depotPostcode="OL9 9XA";
type Point=[number,number];

async function fetchTimeout(input:RequestInfo|URL,init:RequestInit={},timeoutMs=12000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(input,{...init,signal:controller.signal});}
  finally{clearTimeout(timer);}
}
type Edge={key:string,from:Point,to:Point};

const mins=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
const span=(a:number,b:number)=>b>=a?b-a:b+1440-a;
const add=(v:string,n:number)=>{const base=mins(v);if(base===null)throw Error("Cannot calculate from missing time");const x=((base+n)%1440+1440)%1440;return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0")};

const pointKey=(p:Point)=>p.map(v=>v.toFixed(6)).join(",");
const edgeKey=(a:Point,b:Point)=>pointKey(a)+"|"+pointKey(b);
const postcodeOf=(q:string)=>q.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1]?.replace(/\s+/g," ").toUpperCase()??null;
const isOperationalLabel=(q:string)=>/^(WORSLEY ROUTE(?: - MGS)?|ALTRINCHAM SHUTTLE BUS|ROUTE [12] - |ST BEDES (?:AM|PM)|OHGS - |COACH \d|4 X PICK UPS|CLEANING(?: AT SWANS)?|STANDBY\b|WORK DAY|HOLIDAY|SICK|REST DAY)/i.test(String(q).trim());
const knownLocationPostcodes:Record<string,string>={
  "Manchester Grammar School":"M13 0XT",
  "The Manchester Grammar School":"M13 0XT",
  "Route 2 - The Manchester Grammar School":"M13 0XT",
  "Hulme Grammar School":"OL8 4BX",
  "Oldham Hulme Grammar School":"OL8 4BX",
  "OHLDAM / HULME GRAMMAR":"OL8 4BX",
  "Radbroke Hall WA16 9EU":"WA16 9EU",
  "Radbroke Hall":"WA16 9EU",
  "Barclays Radbroke":"WA16 9EU",
  "Barclays Technology Centre Radbroke":"WA16 9EU",
  "Macclesfield College":"SK11 8LF",
  "Rochdale AFC":"OL11 5DR",
  "Huddersfield Town AFC":"HD1 6PX",
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

function inferServiceKey(d:any,masterServices:Record<string,string>){const u=(String(d.origin??"")+" | "+String(d.destination??"")).toUpperCase();if(u.includes("ROUTE 2 - CHEADLE/BRAMHALL")||u.includes("ROUTE 2 - THE MANCHESTER GRAMMAR"))return "MGS_CHEADLE_BRAMHALL";if(u.includes("CITY CENTRE SHUTTLE"))return "MGS_CITY_CENTRE";if(u.includes("WORSLEY ROUTE"))return "MGS_WORSLEY";if(u.includes("ALTRINCHAM SCHOOL BUS"))return "MGS_ALTRINCHAM_JUNIORS";if(u.includes("ALTRINCHAM DOUBLE PM"))return "MGS_ALTRINCHAM_SENIORS";if(u.includes("OHGS - R1&2 ROCHDALE"))return "OHGS_R1_R2_ROCHDALE";if(u.includes("OHGS - R3 - DUKINFIELD"))return "OHGS_R3_DUKINFIELD";if(u.includes("OHGS - R4 - SADDLEWORTH"))return "OHGS_R4_SADDLEWORTH";if(u.includes("ST BEDES")){if(u.includes("WORSLEY")||/ST BEDES (?:AM|PM) 1\b/.test(u))return "ST_BEDES_SB1_WORSLEY";if(u.includes("MIDDLETON")||/ST BEDES (?:AM|PM) 2\b/.test(u))return "ST_BEDES_SB2_MIDDLETON";if(u.includes("MOTTRAM/HYDE")||/ST BEDES (?:AM|PM) 3\b/.test(u))return "ST_BEDES_SB3_MOTTRAM_HYDE";if(u.includes("STOCKPORT")||/ST BEDES (?:AM|PM) 4\b/.test(u))return "ST_BEDES_SB4_STOCKPORT";if(u.includes("ALDERLEY EDGE")||/ST BEDES (?:AM|PM) 5\b/.test(u))return "ST_BEDES_SB5_ALDERLEY_EDGE";if(u.includes("HALE")||/ST BEDES (?:AM|PM) 6\b/.test(u))return "ST_BEDES_SB6_HALE";if(u.includes("TIMPERLEY")||/ST BEDES (?:AM|PM) 7\b/.test(u))return "ST_BEDES_SB7_TIMPERLEY";}return masterServices[d.origin]??masterServices[d.destination]??null;}

async function geocodePostcodes(postcodes:string[]){
  const out=new Map<string,Point>();
  for(let i=0;i<postcodes.length;i+=100){
    const batch=postcodes.slice(i,i+100);
    const r=await fetchTimeout("https://api.postcodes.io/postcodes",{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Swans-Duty-Checker/1.0"},body:JSON.stringify({postcodes:batch})});
    if(!r.ok)continue;
    const j:any=await r.json();
    for(const item of j.result??[]){
      const p=item.result;
      if(p?.longitude!=null&&p?.latitude!=null)out.set(item.query.replace(/\s+/g," ").toUpperCase(),[Number(p.longitude),Number(p.latitude)]);
    }
  }
  return out;
}

export async function geocodeMany(locations:string[],key?:string,master:Record<string,string>={}){
  const result=new Map<string,Point>();
  const locationMaster={...knownLocationPostcodes,...master};
  const postcodeMap=await geocodePostcodes([...new Set([...locations.map(postcodeOf).filter(Boolean) as string[],...Object.values(locationMaster)])]);
  for(const q of locations){
    const pc=isOperationalLabel(q)?null:(locationMaster[q]??postcodeOf(q));
    if(pc){const p=postcodeMap.get(pc);if(p)result.set(q,p);}
  }
  if(!result.has(depot)){
    const p=postcodeMap.get(depotPostcode);if(p)result.set(depot,p);
  }

  // For genuine physical locations without a postcode, use one bounded Photon lookup.
  // Do not fall through to multiple external geocoders: an unresolved point must be
  // surfaced as a route warning rather than holding the entire duty batch open.
  const remaining=locations.filter(q=>!result.has(q)&&!isOperationalLabel(q));
  for(let i=0;i<remaining.length;i+=6){
    const batch=remaining.slice(i,i+6);
    const vals=await Promise.all(batch.map(async q=>{
      try{
        const clean=q.replace(/\b(AM|PM|RUN\d+)\b/gi,"").replace(/[*]/g,"").trim();
        const photon=new URL("https://photon.komoot.io/api/");
        photon.searchParams.set("q",clean);photon.searchParams.set("limit","1");photon.searchParams.set("countrycode","GB");
        const pr=await fetchTimeout(photon,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}},4000);
        if(pr.ok){const pj:any=await pr.json();const pc=pj.features?.[0]?.geometry?.coordinates;if(pc)return [q,[Number(pc[0]),Number(pc[1])] as Point] as const;}
      }catch{}
      return null;
    }));
    for(const v of vals)if(v)result.set(v[0],v[1]);
  }
  return result;
}
async function matrixBatch(edges:Edge[]){
  const points:Point[]=[];const index=new Map<string,number>();
  const idx=(p:Point)=>{const k=pointKey(p);const old=index.get(k);if(old!==undefined)return old;const i=points.length;points.push(p);index.set(k,i);return i};
  const pairs=edges.map(e=>({from:idx(e.from),to:idx(e.to),key:e.key}));
  const sources=[...new Set(pairs.map(p=>p.from))],destinations=[...new Set(pairs.map(p=>p.to))];
  const u=new URL("https://router.project-osrm.org/table/v1/driving/"+points.map(p=>p.join(",")).join(";"));
  u.searchParams.set("sources",sources.join(";"));u.searchParams.set("destinations",destinations.join(";"));u.searchParams.set("annotations","duration");
  const r=await fetchTimeout(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
  if(!r.ok)throw Error("OSRM matrix failed "+r.status);
  const j:any=await r.json();if(j.code!=="Ok")throw Error("OSRM matrix returned "+(j.code??"unknown error"));
  const destIndex=new Map(destinations.map((v,i)=>[v,i]));const out=new Map<string,number>();
  for(const p of pairs){const seconds=j.durations?.[sources.indexOf(p.from)]?.[destIndex.get(p.to)!];if(seconds!=null)out.set(p.key,Math.ceil(Number(seconds)/60));}
  return out;
}

export async function routeEdges(edges:Edge[]){
  const out=new Map<string,number>(),batches:Edge[][]=[];
  for(let i=0;i<edges.length;i+=20)batches.push(edges.slice(i,i+20));
  for(let i=0;i<batches.length;i+=2){
    const results=await Promise.all(batches.slice(i,i+2).map(async batch=>{
      try{return await matrixBatch(batch)}catch{
        const vals=await Promise.all(batch.map(async e=>{
          try{
            const u="https://router.project-osrm.org/route/v1/driving/"+e.from.join(",")+";"+e.to.join(",")+"?overview=false";
            const r=await fetchTimeout(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
            if(!r.ok)return null;
            const j:any=await r.json();const d=j.routes?.[0]?.duration;if(!d)return null;
            return [e.key,Math.ceil(Number(d)/60)] as const;
          }catch{return null;}
        }));
        return new Map(vals.filter((v):v is [string,number]=>v!==null));
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
    const {data:routeMaster,error:routeMasterError}=await db.from("contract_route_master").select("alias,postcode,service_key").eq("active",true);
    if(routeMasterError)throw routeMasterError;
    const masterPostcodes:Record<string,string>={};
    const masterServices:Record<string,string>={};
    for(const row of routeMaster??[]){
      if(row.alias&&row.postcode)masterPostcodes[row.alias]=row.postcode;
      if(row.alias&&row.service_key)masterServices[row.alias]=row.service_key;
    }

    const {data,error}=await db.from("duties").select("*").eq("import_id",importId).order("sort_order");if(error)throw error;
    const allRows=data??[],offset=Math.max(0,Number(req.body?.offset??0)),limit=Math.min(40,Math.max(1,Number(req.body?.limit??40)));
    const selectedRows=allRows.slice(offset,offset+limit);
    if(!selectedRows.length)return res.json({importId,processed:0,nextOffset:null,reconstructed:0,warnings:0,connectionsChecked:0,connectionFailures:0,routingProvider:"Postcodes.io + Photon/Nominatim + OSRM matrix"});
    const workRows=allRows.slice(Math.max(0,offset-1),Math.min(allRows.length,offset+limit+1));
    const locations=[...new Set(workRows.flatMap(d=>[d.origin,d.destination].filter(Boolean)).concat([depot]))] as string[];
    const points=await geocodeMany(locations,process.env.OPENROUTESERVICE_API_KEY,masterPostcodes);
    const groups=groupDuties(allRows);
    const firstDutyIds=new Set<string>();
    for(const rows of groups.values())if(rows[0]?.id)firstDutyIds.add(rows[0].id);
    const edgeMap=new Map<string,Edge>(),dutyEdges=new Map<string,{first?:string,outbound:string,ret:string,backReturn?:string,backFinish?:string}>();
    for(const d of selectedRows){
      // Clear derived connection results before every route run so changed contract mappings cannot leave stale PASS/FAIL data behind.
      await db.from("duties").update({
        route_status:"NOT_CHECKED",route_error:null,
        outbound_route_minutes:null,return_route_minutes:null,depot_return_route_minutes:null,
        first_position_route_minutes:null,first_position_available_minutes:null,first_position_status:null,first_position_error:null,
        calculated_return_position_time:null,calculated_next_arrival_time:null,calculated_position_travel_minutes:null,calculated_position_available_minutes:null,
        connection_status:"NOT_CHECKED",connection_error:null,connection_minutes:null,connection_available_minutes:null
      }).eq("id",d.id);
      const pickupM=mins(d.pickup_time),leaveM=mins(d.leave_time),arrivalM=mins(d.arrival_time);
      if(arrivalM!==null&&leaveM!==null&&leaveM<arrivalM){
        await db.from("duties").update({
          route_status:"WARN",route_error:`Invalid source timing: Leave ${d.leave_time} is before Arrival ${d.arrival_time}; waiting/rest cannot be calculated.`
        }).eq("id",d.id);
        continue;
      }
      if(pickupM!==null&&arrivalM!==null&&arrivalM<pickupM){
        await db.from("duties").update({
          route_status:"WARN",route_error:`Invalid source timing: Arrival ${d.arrival_time} is before Pickup ${d.pickup_time}.`
        }).eq("id",d.id);
        continue;
      }
      const a=d.origin?points.get(d.origin):null,b=d.destination?points.get(d.destination):null;if(!a||!b){const missing=[!a?d.origin:null,!b?d.destination:null].filter(Boolean).join(" / ");await db.from("duties").update({route_status:"WARN",route_error:`Physical route point unresolved: ${missing}. A service label cannot be used as a physical address.`}).eq("id",d.id);continue;}
      const out=edgeKey(a,b),first=edgeKey(points.get(depot)!,a),ret=edgeKey(b,points.get(depot)!);edgeMap.set(first,{key:first,from:points.get(depot)!,to:a});edgeMap.set(out,{key:out,from:a,to:b});edgeMap.set(ret,{key:ret,from:b,to:points.get(depot)!});let backReturn:string|undefined,backFinish:string|undefined;if(d.back){backReturn=edgeKey(b,a);backFinish=edgeKey(a,points.get(depot)!);edgeMap.set(backReturn,{key:backReturn,from:b,to:a});edgeMap.set(backFinish,{key:backFinish,from:a,to:points.get(depot)!});}dutyEdges.set(d.id,{first,outbound:out,ret,backReturn,backFinish});
    }
    let routeTimes=await routeEdges([...edgeMap.values()]);
    let reconstructed=0,warnings=0,connectionsChecked=0,connectionFailures=0;
    const updates:any[]=[];
    for(const d of selectedRows){
      const e=dutyEdges.get(d.id);if(!e)continue;
      try{
        const first=routeTimes.get(e.first!),outbound=routeTimes.get(e.outbound),ret=d.back?routeTimes.get(e.backReturn!):routeTimes.get(e.ret),backFinish=e.backFinish?routeTimes.get(e.backFinish):null;
        const arrivalWasMissing=!d.arrival_time,finishWasMissing=!d.finish_time;
        let arrival=d.arrival_time,returnArrival=d.return_arrival_time,calculatedReturnPosition=d.calculated_return_position_time,finish=d.finish_time;
        if(!arrival){if(outbound==null)throw Error("No outbound route could be calculated");if(!d.leave_time)throw Error("Missing Leave time");arrival=add(d.leave_time,outbound);reconstructed++}
        if(d.back){const returnLeave=d.return_leave_time??d.leave_time;if(!returnLeave)throw Error("Missing return departure time");if(ret==null)throw Error("No return passenger route could be calculated");calculatedReturnPosition=add(returnLeave,ret);reconstructed++}
        if(!finish){if(d.back){if(!calculatedReturnPosition)throw Error("Missing calculated return position time");if(backFinish==null)throw Error("No depot return route could be calculated after the return passenger journey");finish=add(calculatedReturnPosition,backFinish);reconstructed++}else{if(ret==null)throw Error("No return route could be calculated");if(!d.leave_time)throw Error("Missing Leave time for depot return");finish=add(d.leave_time,ret);reconstructed++}}
        d.arrival_time=arrival;d.return_arrival_time=returnArrival;d.finish_time=finish;
        const isFirstDuty=firstDutyIds.has(d.id); const pickupForFirst=mins(d.pickup_time); const firstStart=mins(d.start_time); const firstAvailable=isFirstDuty&&firstStart!==null&&pickupForFirst!==null&&first!=null&&pickupForFirst>=firstStart+30?pickupForFirst-(firstStart+30):null; const firstFeasible=!isFirstDuty||(first!=null&&firstAvailable!=null&&first<=firstAvailable); updates.push({id:d.id,arrival_time:arrival,return_arrival_time:returnArrival,calculated_return_position_time:calculatedReturnPosition,finish_time:finish,arrival_estimated:arrivalWasMissing,finish_estimated:finishWasMissing,route_status:firstFeasible?"CALCULATED":"WARN",route_error:firstFeasible?null:`First position impossible: depot → ${d.origin} needs about ${first??0} min but only ${firstAvailable??0} min is available after the 30-minute vehicle check period.`,first_position_route_minutes:isFirstDuty?(first??null):null,first_position_available_minutes:isFirstDuty?firstAvailable:null,first_position_status:isFirstDuty?(firstFeasible?"PASS":"FAIL"):null,first_position_error:isFirstDuty?(firstFeasible?null:`Depot → ${d.origin} requires about ${first??0} min; available from ${add(d.start_time!,30)} to ${d.pickup_time} is ${firstAvailable??0} min.`):null,outbound_route_minutes:outbound??null,return_route_minutes:ret??null,depot_return_route_minutes:backFinish??null,contract_service_key:inferServiceKey(d,masterServices)});
      }catch(err){warnings++;updates.push({id:d.id,route_status:"WARN",route_error:err instanceof Error?err.message:"Route failed"})}
    }
    for(let i=0;i<updates.length;i+=15)await Promise.all(updates.slice(i,i+15).map(u=>db.from("duties").update(u).eq("id",u.id)));

    // Connection feasibility is deliberately handled separately from the core
    // duty routing pass. This keeps one slow school-to-school movement from
    // blocking the physical route calculations for the whole batch.
    return res.json({importId,processed:selectedRows.length,nextOffset:offset+selectedRows.length<allRows.length?offset+selectedRows.length:null,reconstructed,warnings,connectionsChecked:0,connectionFailures:0,routingProvider:"Postcodes.io + Photon + OSRM"});
  }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"Route reconstruction failed"})}
}
