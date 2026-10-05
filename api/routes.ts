import {createClient} from "@supabase/supabase-js";
const depot="Swans Travel, Broadgate, Chadderton, OL9 9XA";
const depotPostcode="OL9 9XA";
const geocodeCache=new Map<string,[number,number]>();
const mins=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
const span=(a:number,b:number)=>b>=a?b-a:b+1440-a;
const add=(v:string,n:number)=>{const base=mins(v);if(base===null)throw Error("Cannot calculate from missing time");const x=((base+n)%1440+1440)%1440;return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0")};

async function geo(q:string,key?:string){
  const cached=geocodeCache.get(q);if(cached)return cached;
  if(q===depot){const p=await geocodePostcode(depotPostcode);geocodeCache.set(q,p);return p}
  if(key){
    const u=new URL("https://api.heigit.org/pelias/v1/search");
    u.searchParams.set("api_key",key);u.searchParams.set("text",q);u.searchParams.set("boundary.country","GBR");
    const r=await fetch(u,{headers:{Authorization:key}});
    if(r.ok){const j:any=await r.json();const c=j.features?.[0]?.geometry?.coordinates;if(c)return c}
  }
  const pc=q.match(/\\b([A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2})\\b/i)?.[1];
  if(pc){
    try{const p=await geocodePostcode(pc);geocodeCache.set(q,p);return p}catch{}
  }

  const u=new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q",q+", UK");u.searchParams.set("format","json");u.searchParams.set("limit","1");
  const r=await fetch(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
  if(!r.ok)throw Error("Geocode failed "+r.status);
  const j:any=await r.json();if(!j[0])throw Error("Location could not be geocoded: "+q);
  const p:[number,number]=[Number(j[0].lon),Number(j[0].lat)];geocodeCache.set(q,p);return p;
}

async function geocodePostcode(postcode:string):Promise<[number,number]>{
  const u="https://api.postcodes.io/postcodes/"+encodeURIComponent(postcode.replace(/\\s+/g,""));
  const r=await fetch(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
  if(!r.ok)throw Error("Postcode geocode failed "+r.status);
  const j:any=await r.json();
  if(!j.result?.longitude||!j.result?.latitude)throw Error("Postcode has no coordinates: "+postcode);
  return [Number(j.result.longitude),Number(j.result.latitude)];
}

async function route(a:number[],b:number[],key?:string){
  if(key){
    const u="https://api.heigit.org/openrouteservice/v2/directions/driving-hgv";
    const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","Authorization":key},body:JSON.stringify({coordinates:[a,b],units:"km"})});
    if(r.ok){const j:any=await r.json();const d=j.routes?.[0]?.summary?.duration;if(d)return Math.ceil(d/60)}
  }
  const u="https://router.project-osrm.org/route/v1/driving/"+a[0]+","+a[1]+";"+b[0]+","+b[1]+"?overview=false";
  const r=await fetch(u,{headers:{"User-Agent":"Swans-Duty-Checker/1.0"}});
  if(!r.ok)throw Error("Routing failed "+r.status);
  const j:any=await r.json();const d=j.routes?.[0]?.duration;if(!d)throw Error("No route returned");
  return Math.ceil(d/60);
}

export default async function handler(req:any,res:any){
  try{
    if(req.method!=="POST")return res.status(405).json({error:"POST required"});
    const url=process.env.SUPABASE_URL,pub=process.env.SUPABASE_PUBLISHABLE_KEY,internal=process.env.DUTY_CHECKER_DB_KEY;
    if(!url||!pub||!internal)return res.status(503).json({error:"Supabase is not configured"});
    const key=process.env.OPENROUTESERVICE_API_KEY;
    const db=createClient(url,pub,{global:{headers:{"x-duty-checker-key":internal}}});
    const {importId}=req.body??{};
    if(!importId)return res.status(400).json({error:"importId required"});
    const {data,error}=await db.from("duties").select("*").eq("import_id",importId).order("sort_order");
    if(error)throw error;

    const depotPoint=await geo(depot,key);
    let reconstructed=0,warnings=0,connectionsChecked=0,connectionFailures=0;
    const groups=new Map<string,any[]>();
    for(const d of data??[]){
      if(d.driver_name){
        const a=groups.get(d.driver_name)??[];
        a.push(d);
        groups.set(d.driver_name,a);
      }
    }

    for(const d of data??[]){
      if(!d.destination||!d.leave_time)continue;
      try{
        const origin=await geo(d.origin||depot,key),dest=await geo(d.destination,key);
        let arrival=d.arrival_time,finish=d.finish_time;
        if(!arrival){arrival=add(d.leave_time,await route(origin,dest,key));reconstructed++}
        if(!finish){finish=add(arrival,await route(dest,depotPoint,key));reconstructed++}
        await db.from("duties").update({
          arrival_time:arrival,
          finish_time:finish,
          arrival_estimated:!d.arrival_time,
          finish_estimated:!d.finish_time,
          route_status:"CALCULATED",
          route_error:null,
          outbound_route_minutes:await route(origin,dest,key),
          return_route_minutes:await route(dest,depotPoint,key)
        }).eq("id",d.id);
        d.arrival_time=arrival;d.finish_time=finish;
      }catch(e){
        warnings++;
        await db.from("duties").update({route_status:"WARN",route_error:e instanceof Error?e.message:"Route failed"}).eq("id",d.id);
      }
    }

    for(const rows of groups.values()){
      rows.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
      for(let i=0;i<rows.length-1;i++){
        const prev=rows[i],next=rows[i+1];
        if(!prev.destination||!next.origin||!prev.arrival_time||!next.pickup_time)continue;
        connectionsChecked++;
        try{
          const from=await geo(prev.destination,key),to=await geo(next.origin,key);
          const required=await route(from,to,key);
          const available=span(mins(prev.arrival_time)!,mins(next.pickup_time)!);
          if(required>available){
            connectionFailures++;
            const errorText=`Connection impossible: ${prev.destination} → ${next.origin} needs about ${required} min but only ${available} min is available between passenger journeys.`;
            await db.from("duties").update({connection_status:"FAIL",connection_error:errorText,connection_minutes:required,connection_available_minutes:available,overall_status:"FAIL"}).eq("id",next.id);
          }else{
            await db.from("duties").update({connection_status:"PASS",connection_error:null,connection_minutes:required,connection_available_minutes:available}).eq("id",next.id);
          }
        }catch(e){
          warnings++;
          await db.from("duties").update({connection_status:"WARN",connection_error:e instanceof Error?e.message:"Connection route failed"}).eq("id",next.id);
        }
      }
    }

    return res.json({importId,reconstructed,warnings,connectionsChecked,connectionFailures,routingProvider:key?"OpenRouteService with OSRM fallback":"OSRM fallback"});
  }catch(e){
    return res.status(400).json({error:e instanceof Error?e.message:"Route reconstruction failed"});
  }
}
