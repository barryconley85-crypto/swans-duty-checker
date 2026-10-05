export type ParsedDuty={driver_name:string|null;vehicle_id:string|null;vehicle_type:string|null;seats:number;start_time:string|null;pickup_time:string|null;leave_time:string|null;arrival_time:string|null;finish_time:string|null;origin:string|null;destination:string|null;stay:boolean;back:boolean;raw_text:string;sort_order:number};
const clean=(v:unknown)=>{const x=String(v??"").replace(/\s+/g," ").trim();return x||null};
const time=(v:unknown)=>{const x=clean(v);const m=x?.match(/(\d{2}:\d{2})/);return m?.[1]??null};
const nonDrivers=new Set(["ON HIRE","Bus St","Bus School","Shuttle Bus School","Grammar School","Hotel MUFC","Station timetable","RUN RUN","RUN","School","Comment","Holiday","Sick","Unscheduled",".Rest Day"]);
const row=/^(?:(?<driver>[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+){1,4})\s+)?(?<start>(?:\d{2}:\d{2}|\?\?:\?\?))\s+(?<pickup>(?:\d{2}:\d{2}|\?\?:\?\?))\s+(?<origin>.*?)\s+(?<backFlag>Yes|No)\s+(?<stay>Yes|No)\s+(?<destination>.*?)\s+(?<times>(?:(?:\d{2}:\d{2}|\?\?:\?\?)\s*){3,4})(?<seats>\d{1,3})\s+(?<tail>.+)$/;
const driverLine=/^[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+){1,4}$/;
export function parseCoachManagerText(text:string):ParsedDuty[]{const lines=text.replace(/\r/g,"").split(/\n+/).map(clean).filter(Boolean) as string[];const out:ParsedDuty[]=[];let currentDriver:string|null=null;
for(const line of lines){if(/^(Coach Manager Printed:|Bookings - Driver Order|Driver Name Start|Record Count =|ORDER BY DriverID|Driver Name Driver Type)/.test(line))continue;const m=row.exec(line);
if(!m?.groups){if(driverLine.test(line)&&!nonDrivers.has(line)&&!line.includes("Printed")){const d=line.trim();if(out.length&&!out[out.length-1].driver_name)out[out.length-1].driver_name=d;currentDriver=d;}continue}
const g=m.groups;const ts=(clean(g.times)??"").split(/\s+/);const tail=clean(g.tail)??"";
const idMatch=tail.match(/^([^\s]+)(?:\s+(TM|AP|CH))?(?:\s*)$/);const vehicleId=idMatch?.[1]?.toUpperCase()??tail.split(/\s+/)[0]?.toUpperCase()??null;
let vehicleType=tail;if(idMatch)vehicleType=tail.slice(0,tail.length-(idMatch[0].length-idMatch[1].length)).trim();
const candidate=clean(g.driver);if(candidate&&!nonDrivers.has(candidate))currentDriver=candidate;
out.push({driver_name:currentDriver,vehicle_id:vehicleId,vehicle_type:vehicleType||null,seats:Number(g.seats),start_time:time(g.start),pickup_time:time(g.pickup),leave_time:time(ts[1]),arrival_time:time(ts[0]),finish_time:time(ts.length===4?ts[3]:ts[2]),origin:clean(g.origin),destination:clean(g.destination),stay:g.stay==="Yes",back:g.backFlag==="Yes",raw_text:line,sort_order:out.length+1});}
return out}