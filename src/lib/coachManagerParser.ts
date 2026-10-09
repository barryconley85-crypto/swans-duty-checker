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
    if(ch==='"'){
      if(quote&&text[i+1]==='"'){cell+='"';i++;continue;}
      quote=!quote; continue;
    }
    if(ch===','&&!quote){row.push(cell);cell="";continue;}
    if((ch==='\n'||ch==='\r')&&!quote){
      if(ch==='\r'&&text[i+1]==='\n')i++;
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
  const lines=String(text).split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim());
  const out:{location:string;time:string|null}[]=[];
  let lastBoundary=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i]; if(!line) { lastBoundary=i+1; continue; }
    const m=line.match(postcode); if(!m)continue;
    const pc=m[1].replace(/\s+/g," ").toUpperCase();
    let marker=-1;
    for(let j=i;j>=Math.max(lastBoundary,i-6);j--){
      if(/\b(?:\d{1,2}:?\d{2})hrs?\b/i.test(lines[j])||/\b\d{1,2}:\d{2}\b/.test(lines[j])){marker=j;break;}
    }
    let t:RegExpMatchArray|null=marker>=0?lines[marker].match(/\b(\d{1,2}):?(\d{2})hrs?\b/i):null;
    if(!t&&marker>=0)t=lines[marker].match(/\b(\d{1,2}):(\d{2})\b/);
    const labelParts:string[]=[];
    const from=marker>=0?marker+1:Math.max(lastBoundary,i-3);
    for(let j=from;j<=i;j++){
      let s=lines[j];
      s=s.replace(/\b\d{1,2}:?\d{2}hrs?\b/ig,"").replace(postcode,"").trim();
      if(!s||/^(?:1st|2nd|3rd|4th|5th|pick.?up|arrival|departing from there)/i.test(s))continue;
      if(/^(?:driver|contact names?|glen|jason|rachel|michelle)\b/i.test(s))continue;
      if(/\b\d{5,}\b/.test(s)&&!/[A-Za-z]{2}\d/.test(s))continue;
      labelParts.push(s);
    }
    const label=labelParts.join(", ").replace(/\s*,\s*,+/g,", ").replace(/\s+/g," ").trim();
    out.push({location:(label?label+", ":"")+pc,time:t?String(Number(t[1])).padStart(2,"0")+":"+t[2]:null});
    lastBoundary=i+1;
  }
  const seen=new Set<string>(); return out.filter(x=>{const k=x.location.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}
