export const minutes=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
export const duration=(a:string|null,b:string|null,allowOvernight=true)=>{const x=minutes(a),y=minutes(b);if(x===null||y===null)return null;if(y>=x)return y-x;return allowOvernight?y+1440-x:null};
export const sameDayDuration=(a:string|null,b:string|null)=>duration(a,b,false);
export const spread=(start:number,end:number)=>end>=start?end-start:end+1440-start;
export const addMinutes=(v:string,n:number)=>{const base=minutes(v);if(base===null)throw Error("Cannot calculate from missing time");const x=((base+n)%1440+1440)%1440;return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0")};
export const screenWorkingDay=(minutesWorked:number)=>minutesWorked>900?"FAIL":"PASS";
export const screenWtdBreak=(spreadMinutes:number,breakMinutes:number)=>spreadMinutes>540?breakMinutes<45?"FAIL":"PASS":spreadMinutes>360?breakMinutes<30?"FAIL":"PASS":"PASS";

export type DutyTimes={start_time:string|null;pickup_time:string|null;leave_time:string|null;arrival_time:string|null;finish_time:string|null;back?:boolean;calculated_return_position_time?:string|null;origin?:string|null;destination?:string|null;first_position_route_minutes?:number|null;outbound_route_minutes?:number|null;return_route_minutes?:number|null;depot_return_route_minutes?:number|null};
export type BreakOpportunity={start:string;end:string;minutes:number;source:"passenger_layover"|"between_jobs";description:string;dutyIndex:number};

export const passengerStart=(d:DutyTimes)=>d.pickup_time;
export const passengerEnd=(d:DutyTimes)=>d.arrival_time;

export const scheduledDutySegments=(rows:DutyTimes[])=>{
  const segments:{start:number;end:number}[]=[];
  rows.forEach((d,i)=>{
    const pickup=minutes(d.pickup_time),arrival=minutes(d.arrival_time),start=minutes(d.start_time),leave=minutes(d.leave_time),finish=minutes(d.finish_time);
    if(i===0&&start!==null&&arrival!==null)segments.push({start,end:start+spread(start,arrival)});
    if(pickup!==null&&arrival!==null)segments.push({start:pickup,end:pickup+spread(pickup,arrival)});
    if(i===rows.length-1&&leave!==null&&finish!==null)segments.push({start:leave,end:leave+spread(leave,finish)});
  }); return segments;
};

export const scheduledBreakOpportunities=(rows:DutyTimes[],connectionMinutes:(number|null)[]=[]):BreakOpportunity[]=>{
  const opportunities:BreakOpportunity[]=[];
  rows.forEach((d,i)=>{
    const layover=sameDayDuration(d.arrival_time,d.leave_time);
    if(layover!==null&&layover>15)opportunities.push({start:d.arrival_time!,end:d.leave_time!,minutes:layover,source:"passenger_layover",dutyIndex:i,description:`Passenger journey complete at ${d.destination??"destination"} · scheduled layover before Leave`});
    if(i<rows.length-1){
      const endTime=d.back&&d.calculated_return_position_time?d.calculated_return_position_time:d.arrival_time;
      const next=rows[i+1];
      const available=duration(endTime,next.pickup_time,true);
      const route=connectionMinutes[i];
      if(endTime&&next.pickup_time&&available!==null&&route!==null){
        const breakMinutes=Math.max(0,available-route);
        if(breakMinutes>15)opportunities.push({start:addMinutes(endTime,route),end:next.pickup_time!,minutes:breakMinutes,source:"between_jobs",dutyIndex:i,description:`Between jobs: arrive at ${next.origin??"next position"} after estimated ${route} min reposition`});
      }
    }
  });
  return opportunities.sort((a,b)=>(minutes(a.start)??0)-(minutes(b.start)??0));
};

export const splitDutyMinutes=(opportunities:BreakOpportunity[],threshold=180)=>opportunities.filter(o=>o.minutes>threshold).reduce((sum,o)=>sum+o.minutes,0);
export const wtdWorkingMinutes=(spreadMinutes:number,opportunities:BreakOpportunity[],allocatedBreakMinutes:number)=>Math.max(0,spreadMinutes-splitDutyMinutes(opportunities)-allocatedBreakMinutes);
export const allocateWtdBreaks=(opportunities:BreakOpportunity[],target:number)=>{
  let remaining=target; return opportunities.map(o=>{if(remaining<=0||o.minutes<15)return {...o,wtdAllocated:0};const allocated=Math.min(remaining,o.minutes);remaining-=allocated;return {...o,wtdAllocated:allocated};});
};

export type EuDrivingPlan={start:string;end:string;minutes:15|30|45;description:string};
export const planEuDrivingBreaks=(rows:DutyTimes[],connectionMinutes:(number|null)[]=[]):{plans:EuDrivingPlan[];drivingMinutes:number;status:"PASS"|"FAIL";issue:string|null}=>{const opportunities=scheduledBreakOpportunities(rows,connectionMinutes).filter(o=>o.minutes>=15);const plans:EuDrivingPlan[]=[];let continuousDriving=0,totalDriving=0,firstSplitUsed=false;const drive=(n:number)=>{let remaining=n;while(remaining>0){const room=270-continuousDriving;const take=Math.min(remaining,room);continuousDriving+=take;totalDriving+=take;remaining-=take;if(continuousDriving>=270&&remaining>0)return false;}return true};const useOpportunity=(o:BreakOpportunity)=>{if(o.minutes>=45&&continuousDriving>0){plans.push({start:o.start,end:o.end,minutes:45,description:"Planned full 45-minute EU driving break"});continuousDriving=0;firstSplitUsed=false;return}if(o.minutes>=30&&firstSplitUsed){plans.push({start:o.start,end:o.end,minutes:30,description:"Planned second 30 minutes of split EU driving break"});continuousDriving=0;firstSplitUsed=false;return}if(o.minutes>=15&&!firstSplitUsed&&continuousDriving>0){plans.push({start:o.start,end:o.end,minutes:15,description:"Planned first 15 minutes of split EU driving break"});firstSplitUsed=true}};for(let i=0;i<rows.length;i++){const d=rows[i];const first=i===0?d.first_position_route_minutes??null:null;if(first!=null&&!drive(first))return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver reaches 4.5 hours driving before a qualifying break can be completed."};const passenger=d.outbound_route_minutes??null;if(passenger!=null&&!drive(passenger))return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver reaches 4.5 hours driving before a qualifying break can be completed."};const passengerBreak=opportunities.find(o=>o.dutyIndex===i&&o.source==="passenger_layover");if(passengerBreak)useOpportunity(passengerBreak);if(d.back&&d.return_route_minutes!=null&&!drive(d.return_route_minutes))return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver reaches 4.5 hours driving before a qualifying break can be completed."};if(i<rows.length-1&&connectionMinutes[i]!=null){if(!drive(connectionMinutes[i]!))return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver reaches 4.5 hours driving before a qualifying break can be completed."};const between=opportunities.find(o=>o.dutyIndex===i&&o.source==="between_jobs");if(between)useOpportunity(between)}else if(i===rows.length-1){const finalDrive=d.back?(d.depot_return_route_minutes??null):(d.return_route_minutes??null);if(finalDrive!=null&&!drive(finalDrive))return {plans,drivingMinutes:totalDriving,status:"FAIL",issue:"Driver reaches 4.5 hours driving before a qualifying break can be completed."}}}return {plans,drivingMinutes:totalDriving,status:"PASS",issue:null};};
export const scheduledBreakMinutes=(rows:DutyTimes[],connectionMinutes:(number|null)[]=[]):number=>scheduledBreakOpportunities(rows,connectionMinutes).reduce((sum,o)=>sum+o.minutes,0);
