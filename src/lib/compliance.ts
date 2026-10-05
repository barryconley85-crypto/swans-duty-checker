export const minutes=(v:string|null)=>{const m=v?.match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
export const duration=(a:string|null,b:string|null)=>{const x=minutes(a),y=minutes(b);return x===null||y===null?null:y>=x?y-x:y+1440-x};
export const spread=(start:number,end:number)=>end>=start?end-start:end+1440-start;
export const screenWorkingDay=(minutesWorked:number)=>minutesWorked>900?"FAIL":"PASS";
export const screenWtdBreak=(spreadMinutes:number,breakMinutes:number)=>spreadMinutes>360&&breakMinutes<30?"FAIL":"PASS";