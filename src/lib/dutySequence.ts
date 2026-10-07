export type DutySequenceRow={id?:string;sort_order?:number|null;driver_name?:string|null;back?:boolean|null;origin?:string|null;destination?:string|null;arrival_time?:string|null;calculated_return_position_time?:string|null};
export type DutyEnd={location:string;time:string;kind:"passenger_end"|"return_position"};
export function dutyEnd(row:DutySequenceRow):DutyEnd|null{
  if(row.back&&row.calculated_return_position_time&&row.origin)return {location:String(row.origin),time:row.calculated_return_position_time,kind:"return_position"};
  if(row.destination&&row.arrival_time)return {location:String(row.destination),time:row.arrival_time,kind:"passenger_end"};
  return null;
}
export function driverGroupKey(row:DutySequenceRow):string|null{
  if(!row.driver_name)return null;
  const name=String(row.driver_name).trim();
  if(!name)return null;
  return name.toUpperCase()==="ON HIRE" ? "ON_HIRE:"+(row.id??"unknown") : name;
}
export function groupDuties<T extends DutySequenceRow>(rows:T[],includeUnassigned=false){
  const groups=new Map<string,T[]>();
  for(const row of rows){
    const key=driverGroupKey(row)??(includeUnassigned?"ON_HIRE:"+(row.id??"unknown"):null);
    if(!key)continue;
    const group=groups.get(key)??[];group.push(row);groups.set(key,group);
  }
  for(const group of groups.values())group.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
  return groups;
}
