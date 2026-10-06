export const minutes=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
export const duration=(a:string|null,b:string|null)=>{const x=minutes(a),y=minutes(b);return x===null||y===null?null:y>=x?y-x:y+1440-x};
export const spread=(start:number,end:number)=>end>=start?end-start:end+1440-start;
export const addMinutes=(v:string,n:number)=>{const base=minutes(v);if(base===null)throw Error("Cannot calculate from missing time");const x=((base+n)%1440+1440)%1440;return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0")};
export const screenWorkingDay=(minutesWorked:number)=>minutesWorked>900?"FAIL":"PASS";
export const screenWtdBreak=(spreadMinutes:number,breakMinutes:number)=>spreadMinutes>540?breakMinutes<45?"FAIL":"PASS":spreadMinutes>360?breakMinutes<30?"FAIL":"PASS":"PASS";

export type DutyTimes={
  start_time:string|null;
  pickup_time:string|null;
  leave_time:string|null;
  arrival_time:string|null;
  finish_time:string|null;
  back?:boolean;
  calculated_return_position_time?:string|null;
  origin?:string|null;
  destination?:string|null;
};

export type BreakOpportunity={
  start:string;
  end:string;
  minutes:number;
  source:"passenger_layover"|"between_jobs";
  description:string;
  dutyIndex:number;
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

export const scheduledBreakOpportunities=(rows:DutyTimes[],connectionMinutes:(number|null)[]=[]):BreakOpportunity[]=>{
  const opportunities:BreakOpportunity[]=[];
  rows.forEach((d,i)=>{
    const layover=duration(d.arrival_time,d.leave_time);
    if(layover!==null&&layover>=15)opportunities.push({
      start:d.arrival_time!,
      end:d.leave_time!,
      minutes:layover,
      source:"passenger_layover",
      dutyIndex:i,
      description:`Passenger journey complete at ${d.destination??"destination"} — scheduled layover before Leave`
    });
    if(i<rows.length-1){
      const endTime=d.back&&d.calculated_return_position_time?d.calculated_return_position_time:d.leave_time;
      const next=rows[i+1];
      const available=duration(endTime,next.pickup_time);
      const route=connectionMinutes[i];
      if(endTime&&next.pickup_time&&available!==null&&route!==null){
        const breakMinutes=Math.max(0,available-route);
        if(breakMinutes>=15)opportunities.push({
          start:addMinutes(endTime,route),
          end:next.pickup_time!,
          minutes:breakMinutes,
          source:"between_jobs",
          dutyIndex:i,
          description:`Between jobs: arrive at ${next.origin??"next position"} after estimated ${route} min reposition`
        });
      }
    }
  });
  return opportunities.sort((a,b)=>(minutes(a.start)??0)-(minutes(b.start)??0));
};

export const allocateWtdBreaks=(opportunities:BreakOpportunity[],target:number)=>{
  let remaining=target;
  return opportunities.map(o=>{
    if(remaining<=0||o.minutes<15)return {...o,wtdAllocated:0};
    const allocated=Math.min(remaining,o.minutes);
    remaining-=allocated;
    return {...o,wtdAllocated:allocated};
  });
};

export const allocateEuBreaks=(opportunities:BreakOpportunity[],target:number)=>{
  let remaining=target;
  const out=opportunities.map(o=>({...o,euAllocated:0}));
  if(target<=0)return out;
  const full=out.findIndex(o=>o.minutes>=45);
  if(full>=0){
    out[full].euAllocated=45;
    return out;
  }
  const first=out.findIndex(o=>o.minutes>=15);
  if(first<0)return out;
  out[first].euAllocated=15;
  remaining-=15;
  const second=out.findIndex((o,i)=>i>first&&o.minutes>=30);
  if(second>=0)out[second].euAllocated=Math.min(30,remaining);
  return out;
};

export type EuDrivingPlan={start:string;end:string;minutes:15|30|45;description:string};

export const planEuDrivingBreaks=(rows:DutyTimes[],connectionMinutes:(number|null)[]=[]):{plans:EuDrivingPlan[];drivingMinutes:number;status:"PASS"|"FAIL";issue:string|null}=>{
  const opportunities=scheduledBreakOpportunities(rows,connectionMinutes).filter(o=>o.minutes>=15);
  const segments:{minutes:number}[]=[];
  rows.forEach((d,i)=>{
    const passenger=duration(d.pickup_time,d.arrival_time);if(passenger!=null)segments.push({minutes:passenger});
    if(i<rows.length-1&&connectionMinutes[i]!=null)segments.push({minutes:connectionMinutes[i]!});
    if(i===rows.length-1){const ret=(d as any).return_route_minutes as number|null|undefined;if(ret!=null)segments.push({minutes:ret});}
  });
  const plans:EuDrivingPlan[]=[];let driving=0,totalDriving=0,splitStarted=false,oppIndex=0;
  for(const seg of segments){
    let remaining=seg.minutes;
    while(remaining>0){
      const next=opportunities[oppIndex];
      if(next&&next.minutes>=15&&driving>=255){
        if(next.minutes>=45){plans.push({start:next.start,end:next.end,minutes:45,description:"Planned full 45-minute EU driving break"});driving=0;splitStarted=false;oppIndex++;continue;}
        if(!splitStarted){plans.push({start:next.start,end:next.end,minutes:15,description:"Planned first 15 minutes of split EU driving break"});driving=0;splitStarted=true;oppIndex++;continue;}
        if(next.minutes>=30){plans.push({start:next.start,end:next.end,minutes:30,description:"Planned second 30 minutes of split EU driving break"});driving=0;splitStarted=false;oppIndex++;continue;}
      }
      const room=270-driving;const take=Math.min(remaining,room);driving+=take;totalDriving+=take;remaining-=take;
      if(remaining>0&&driving>=270){return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver reaches 4.5 hours driving before a qualifying break opportunity."};}
    }
  }
  if(driving>270)return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver exceeds 4.5 hours driving without the required EU driving break."};
  if(splitStarted)return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"A 15-minute split break is planned, but a later 30-minute second part is not available."};
  return {plans,drivingMinutes:totalDriving,status:"PASS",issue:null};
};

export const scheduledBreakMinutes=(rows:DutyTimes[],connectionMinutes:(number|null)[]=[]):number=>{
  return scheduledBreakOpportunities(rows,connectionMinutes).reduce((sum,o)=>sum+o.minutes,0);
};
