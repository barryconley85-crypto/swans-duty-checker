export type RouteStop={location:string;time:string|null;kind:"pickup"|"destination"|"intermediate"};
export type ParsedDuty={driver_name:string|null;vehicle_id:string|null;vehicle_type:string|null;seats:number;start_time:string|null;pickup_time:string|null;leave_time:string|null;arrival_time:string|null;finish_time:string|null;return_leave_time:string|null;return_arrival_time:string|null;origin:string|null;destination:string|null;stay:boolean;back:boolean;return_to_depot:boolean;route_stops:RouteStop[];raw_text:string;sort_order:number};
const clean=(v:unknown)=>{const x=String(v??"").replace(/\s+/g," ").trim();return x||null};
const time=(v:unknown)=>{if(v instanceof Date&&!isNaN(v.getTime()))return `${String(v.getHours()).padStart(2,"0")}:${String(v.getMinutes()).padStart(2,"0")}`;const x=clean(v);const m=x?.match(/(\d{2}:\d{2})/);return m?.[1]??null};
const addTime=(v:string|null,n:number)=>{if(!v)return null;const [h,m]=v.split(":").map(Number);const x=((h*60+m+n)%1440+1440)%1440;return `${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`};
const nonDrivers=new Set(["ON HIRE","Bus St","Bus School","Shuttle Bus School","Grammar School","Hotel MUFC","Station timetable","RUN RUN","RUN","School","Comment","Holiday","Sick","Unscheduled",".Rest Day"]);
const row=/^(?:(?<driver>[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+){1,4})\s+)?(?<start>(?:\d{2}:\d{2}|\?\?:\?\?))\s+(?<pickup>(?:\d{2}:\d{2}|\?\?:\?\?))\s+(?<origin>.*?)\s+(?<backFlag>Yes|No)\s+(?<stay>Yes|No)\s+(?<destination>.*?)\s+(?<times>(?:(?:\d{2}:\d{2}|\?\?:\?\?)\s*){3,4})(?<seats>\d{1,3})\s+(?<tail>.+)$/;
const driverLine=/^[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+){1,4}$/;
export function parseCoachManagerText(text:string):ParsedDuty[]{const lines=text.replace(/\r/g,"").split(/\n+/).map(clean).filter(Boolean) as string[];const out:ParsedDuty[]=[];let currentDriver:string|null=null;
for(const line of lines){if(/^(Coach Manager Printed:|Bookings - Driver Order|Driver Name Start|Record Count =|ORDER BY DriverID|Driver Name Driver Type)/.test(line))continue;const m=row.exec(line);
if(!m?.groups){if(driverLine.test(line)&&!nonDrivers.has(line)&&!line.includes("Printed")){const d=line.trim();if(out.length&&!out[out.length-1].driver_name)out[out.length-1].driver_name=d;currentDriver=d;}continue}
const g=m.groups;const ts=(clean(g.times)??"").split(/\s+/);const tail=clean(g.tail)??"";
const prefixes=["38EXEC VIP","CAR SDSC","VIPCoach","PSVAR+1","DDSC","DDSB","SDSB","SDSC","Executive","CAR","EXEC"];const prefix=prefixes.find(p=>tail.startsWith(p+" ")||tail===p);const remainder=(prefix?tail.slice(prefix.length):tail).trim();const vehicleId=remainder.split(/\s+/)[0]?.toUpperCase()??null;const vehicleType=prefix??null;
const candidate=clean(g.driver);if(candidate&&!nonDrivers.has(candidate))currentDriver=candidate;
out.push({driver_name:currentDriver,vehicle_id:vehicleId,vehicle_type:vehicleType||null,seats:Number(g.seats),start_time:time(g.start),pickup_time:time(g.pickup),leave_time:time(ts[1]),arrival_time:time(ts[0]),finish_time:time(ts.length===4?ts[3]:ts[2]),return_leave_time:g.backFlag==="Yes"?time(ts[1]):null,return_arrival_time:g.backFlag==="Yes"&&ts.length===4?time(ts[2]):null,origin:clean(g.origin),destination:clean(g.destination),stay:g.stay==="Yes",back:g.backFlag==="Yes",return_to_depot:true,route_stops:[],raw_text:line,sort_order:out.length+1});}
return out}
const csvValue=(row:Record<string,string>,names:string[])=>{const key=Object.keys(row).find(k=>names.includes(k.toLowerCase().replace(/[^a-z0-9]/g,"")));return key?clean(row[key]):null};
function parseCsvRows(text:string):Record<string,string>[]{
  const rows:string[][]=[]; let row:string[]=[], cell="", quote=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==="\\"){
      cell+=ch;
      continue;
    }
    if(ch==='"'){
      if(quote&&text[i+1]==='"'){cell+='"';i++;continue;}
      quote=!quote; continue;
    }
    if(ch===','&&!quote){row.push(cell);cell="";continue;}
    if((ch==='\\n'||ch==='\\r')&&!quote){
      if(ch==='\\r'&&text[i+1]==='\\n')i++;
      row.push(cell);cell="";
      if(row.some(v=>v.trim()!==""))rows.push(row);
      row=[];continue;
    }
    cell+=ch;
  }
  if(cell!==""||row.length){row.push(cell);if(row.some(v=>v.trim()!==""))rows.push(row);}
  if(rows.length<2)return [];
  const headers=rows[0].map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]/g,""));
  return rows.slice(1).map(vals=>{const r:Record<string,string>={};headers.forEach((h,i)=>r[h]=(vals[i]??"").trim());return r;});
}
const postcode=/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
function instructionStops(text:string|null):{location:string;time:string|null}[]{
  if(!text)return [];
  const lines=String(text).split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const out:{location:string;time:string|null}[]=[];
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(postcode); if(!m)continue;
    const pc=m[1].replace(/\s+/g," ").toUpperCase();
    let label=lines[i].replace(postcode,"").replace(/[, ]+$/,"").trim();
    let t=lines[i].match(/\b(\d{1,2}):?(\d{2})hrs?\b/i);
    const boundary=Math.max(0,i-5);
    for(let j=i-1;j>=boundary;j--){if(!t){const tm=lines[j].match(/\b(\d{1,2}):?(\d{2})hrs?\b/i);if(tm)t=tm;}}
    for(let j=i-1;j>=boundary;j--){
      const candidate=lines[j].replace(/\b\d{1,2}:?\d{2}hrs?\b/ig,"").trim();
      if(candidate&&!postcode.test(candidate)&&!/^\d/.test(candidate)&&!/^\+?\d[\d ()-]{7,}$/.test(candidate)&&!/(?:pick.?up|depart|arrival|transfer|contact|driver|client|recommendations?)/i.test(candidate)){label=candidate;break;}
    }
    const tm=t?String(Number(t[1])).padStart(2,"0")+":"+t[2]:null;
    out.push({location:(label?label+", ":"")+pc,time:tm});
  }
  const seen=new Set<string>(); return out.filter(x=>{const k=x.location.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}
function parsePrivateHireRow(r:Record<string,string>,i:number):ParsedDuty{
  const pickupText=csvValue(r,["pickupinstructions"])??"";
  const destinationText=csvValue(r,["destinationinstructions"])??"";
  const stops=instructionStops(pickupText);
  const destinations=instructionStops(destinationText);
  const origin=stops[0]?.location??null;
  const destination=destinations[destinations.length-1]??null;
  const pickup=time(csvValue(r,["pickupdatetime"]));
  const leave=time(csvValue(r,["leavetime","leavedatetime","departure"]));
  const stay=(csvValue(r,["vehicletostay","stay"])??"").toLowerCase()==="true";
  const returnToDepot=!stay;
  const intermediate=stops.slice(1).map(s=>({location:s.location,time:s.time,kind:"intermediate" as const}));
  const routeStops=[...(origin?[{location:origin,time:pickup,kind:"pickup" as const}]:[]),...intermediate,...(destination?[{location:destination,time:null,kind:"destination" as const}]:[])];
  const vehicleRaw=csvValue(r,["registrationmark","registration","reg"]);
  const vehicleId=vehicleRaw?.split(/\s+/)[0]?.toUpperCase()??null;
  const actualSeats=Number(csvValue(r,["actualseats"])||0);
  const seats=Number(csvValue(r,["seats","capacity","passengers","pax"])||0);
  return {driver_name:csvValue(r,["drivername"]),vehicle_id:vehicleId,vehicle_type:null,seats:actualSeats||seats,start_time:null,pickup_time:pickup,leave_time:leave,arrival_time:null,finish_time:null,return_leave_time:null,return_arrival_time:null,origin,destination,stay,back:false,return_to_depot:returnToDepot,route_stops:routeStops,raw_text:Object.values(r).join(" | "),sort_order:i+1};
}
export function parsePrivateHireCsv(text:string):ParsedDuty[]{return parseCsvRows(text).map(parsePrivateHireRow).filter(d=>Boolean(d.driver_name||d.vehicle_id||d.origin||d.destination||d.pickup_time||d.leave_time));}
export function isPrivateHireCsv(text:string){const rows=parseCsvRows(text);const h=rows[0]?Object.keys(rows[0]):[];return h.includes("pickupdatetime")&&h.includes("pickupinstructions")&&h.includes("destinationinstructions")&&h.includes("registrationmark");}
export function parseCoachManagerCsv(text:string):ParsedDuty[]{return parseCsvRows(text).map((r:Record<string,string>,i:number)=>{const seats=Number(csvValue(r,["seats","capacity","passengers","pax"])||0);return {driver_name:csvValue(r,["drivername"]),vehicle_id:(csvValue(r,["registrationmark","registration","reg"])||csvValue(r,["vehicleid","vehicle","fleetnumber"]))?.split(/\s+/)[0]??null,vehicle_type:csvValue(r,["vehicletype"]),seats,start_time:time(csvValue(r,["startdatetime","start","starttime"])),pickup_time:time(csvValue(r,["pickupdatetime","pickuptime","pickup"])),leave_time:time(csvValue(r,["leavedatetime","leave","leavetime","departure"])),arrival_time:time(csvValue(r,["arrivaldatetime","arrival","arrivaltime"])),finish_time:time(csvValue(r,["finishdatetime","finish","finishtime","end","endtime"])),return_leave_time:time(csvValue(r,["returnleavedatetime","returnleave","backleavetime"])),return_arrival_time:time(csvValue(r,["returnarrivaldatetime","returnarrival","backarrivaltime"])),origin:csvValue(r,["pickuppoint","origin","pickupaddress","from","startlocation"]),destination:csvValue(r,["destination","dropoff","dropoffaddress","to","endlocation"]),stay:(csvValue(r,["vehicletostay","stay"])||"").toLowerCase()==="true",back:Boolean(csvValue(r,["backdatetime","back"])),return_to_depot:true,route_stops:[],raw_text:Object.values(r).join(" | "),sort_order:i+1};}).filter((d:ParsedDuty)=>Boolean(d.driver_name||d.vehicle_id||d.origin||d.destination||d.leave_time));}
export function parseCoachManagerRows(rows:Record<string,unknown>[]):ParsedDuty[]{const norm=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,"");const value=(r:Record<string,unknown>,names:string[])=>{const k=Object.keys(r).find(x=>names.includes(norm(x)));return k?clean(r[k]):null};return rows.map((r,i)=>{const pickupPoint=value(r,["pickuppoint","origin","pickupaddress","from"]);const destination=value(r,["destination","dropoff","dropoffaddress","to"]);const registration=value(r,["registrationmark","registration","reg"]);const vehicleId=(registration||value(r,["vehicleid","vehicle"]))?.split(/\s+/)[0]??null;const startDateTime=value(r,["startdatetime","start","starttime"]);const pickupDateTime=value(r,["pickupdatetime","pickuptime","pickup"]);const leaveDateTime=value(r,["leavedatetime","leave","leavetime","departure"]);const arrivalDateTime=value(r,["arrivaldatetime","arrival","arrivaltime"]);const finishDateTime=value(r,["finishdatetime","finish","finishtime","end","endtime"]);return {driver_name:value(r,["driver","drivername"]),vehicle_id:vehicleId,vehicle_type:value(r,["vehicletype"]),seats:Number(value(r,["seats","capacity","passengers","pax"])||0),start_time:time(startDateTime),pickup_time:time(pickupDateTime),leave_time:time(leaveDateTime),arrival_time:time(arrivalDateTime),finish_time:time(finishDateTime),return_leave_time:time(value(r,["returnleavedatetime","returnleave","backleavetime"])),return_arrival_time:time(value(r,["returnarrivaldatetime","returnarrival","backarrivaltime"])),origin:pickupPoint,destination,stay:(value(r,["vehicletostay","stay"])||"").toLowerCase()==="true",back:Boolean(value(r,["backdatetime","back"])),return_to_depot:true,route_stops:[],raw_text:Object.values(r).map(x=>String(x??"")).join(" | "),sort_order:i+1};}).filter((d:ParsedDuty)=>Boolean(d.origin||d.destination||d.pickup_time));}
