export const minutes=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
export const duration=(a:string|null,b:string|null)=>{const x=minutes(a),y=minutes(b);return x===null||y===null?null:y>=x?y-x:y+1440-x};
export const spread=(start:number,end:number)=>end>=start?end-start:end+1440-start;
export const screenWorkingDay=(minutesWorked:number)=>minutesWorked>900?"FAIL":"PASS";
export const screenWtdBreak=(spreadMinutes:number,breakMinutes:number)=>spreadMinutes>360&&breakMinutes<30?"FAIL":"PASS";

export type DutyTimes={
  start_time:string|null;
  pickup_time:string|null;
  leave_time:string|null;
  arrival_time:string|null;
  finish_time:string|null;
};

export const passengerStart=(d:DutyTimes)=>d.pickup_time;
export const passengerEnd=(d:DutyTimes)=>d.arrival_time;

export const scheduledDutySegments=(rows:DutyTimes[])=>{
  const segments:{start:number;end:number}[]=[];
  rows.forEach((d,i)=>{
    const pickup=minutes(d.pickup_time),arrival=minutes(d.arrival_time),start=minutes(d.start_time),leave=minutes(d.leave_time),finish=minutes(d.finish_time);
    if(i===0&&start!==null&&arrival!==null)segments.push({start,end:arrival>=start?arrival:arrival+1440});
    if(pickup!==null&&arrival!==null)segments.push({start:pickup,end:arrival>=pickup?arrival:arrival+1440});
    if(i===rows.length-1&&leave!==null&&finish!==null)segments.push({start:leave,end:finish>=leave?finish:finish+1440});
  });
  return segments;
};

export const scheduledBreakMinutes=(rows:DutyTimes[],connectionMinutes:number[]=[]):number=>{
  let breaks=0;
  rows.forEach((d,i)=>{
    const arrival=minutes(d.arrival_time),leave=minutes(d.leave_time);
    if(arrival!==null&&leave!==null)breaks+=duration(d.arrival_time,d.leave_time)??0;
    if(i<rows.length-1){
      const a=minutes(d.arrival_time),b=minutes(rows[i+1].pickup_time);
      if(a!==null&&b!==null){
        const available=spread(a,b);
        const route=connectionMinutes[i];
        if(route!=null)breaks+=Math.max(0,available-route);
      }
    }
  });
  return breaks;
};
