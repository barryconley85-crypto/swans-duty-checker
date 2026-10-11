import {describe,it,expect} from "vitest"; import {parseCoachManagerText} from "../src/lib/coachManagerParser";
describe("Coach Manager parser",()=>{it("parses representative duties and carries driver name backward from the first driver heading",()=>{const text=`06:15 08:15 Altrincham Interchange Bus Yes No Radbroke Hall WA16 9EU 09:05 09:15 10:00 70 DDSB YX74OHN TM
Jonathan Clinton
10:25 10:50 Audenshaw Primary School Yes No Tameside Wellness Centre 11:00 11:05 11:05 35 SDSC YX74OHN TM
11:25 12:15 St Marys CE Primary School Yes No Manchester Central Library, M2 12:25 12:25 ??:?? 65 SDSC YX74OHN TM`;const rows=parseCoachManagerText(text);expect(rows).toHaveLength(3);expect(rows.map(r=>r.driver_name)).toEqual(["Jonathan Clinton","Jonathan Clinton","Jonathan Clinton"]);expect(rows[0].vehicle_id).toBe("YX74OHN");expect(rows[0].vehicle_type).toBe("DDSB");expect(rows[2].finish_time).toBeNull()});it("handles CAR SDSC vehicle types without mistaking SDSC for the registration",()=>{const rows=parseCoachManagerText(`??:?? 12:50 RUN3 Newman Catholic College OL9 9QY Yes No Academy Stadium M11 4TQ ??:?? ??:?? ??:?? 1 CAR SDSC RJ19HVU AP`);expect(rows[0].vehicle_type).toBe("CAR SDSC");expect(rows[0].vehicle_id).toBe("RJ19HVU")})});
import {parseCoachManagerCsv} from "../src/lib/coachManagerParser";
it("parses the real Coach Manager CSV structure",()=>{const rows=parseCoachManagerCsv('STARTDATETIME,PICKUPDATETIME,PICKUPPOINT,SINGLEJOURNEY,VEHICLETOSTAY,DESTINATION,ARRIVALDATETIME,LEAVEDATETIME,BACKDATETIME,FINISHDATETIME,SEATS,VEHICLETYPE,VEHICLEID,REGISTRATIONMARK,DRIVERID,DRIVERNAME\n"06/10/2026 06:10:00","06/10/2026 07:40:00","ST BEDES AM HALE","True","False","St Bedes College 6","06/10/2026 08:40:00","06/10/2026 08:45:00","","06/10/2026","53","SDSC","YD19HGX TM","YD19HGX TM","041TM","Craig Hobin"');expect(rows).toHaveLength(1);expect(rows[0].driver_name).toBe("Craig Hobin");expect(rows[0].vehicle_id).toBe("YD19HGX");expect(rows[0].origin).toBe("ST BEDES AM HALE");expect(rows[0].leave_time).toBe("08:45");expect(rows[0].arrival_time).toBe("08:40");expect(rows[0].finish_time).toBeNull();});

import {parsePrivateHireCsv} from "../src/lib/coachManagerParser";
it("keeps separately labelled private-hire pickups even when an intermediate stop has no postcode",()=>{
  const csv='PickupDateTime,PickupInstructions,DestinationInstructions,LeaveTime,DriverName,RegistrationMark,Seats,ActualSeats,VehicleToStay,SingleJourney\n"10/10/2026 08:40:00","1st Pick Up 0840hrs Manchester Abode Hotel 107 Piccadilly Manchester M1 2DB 2nd Pick Up 0900hrs McDonalds Entrance to Stockport Rail Station 3rd pick-up 0930hrs TGI Fridays Prestwich J17 - M60 4TH 4th Pick Up 0955hrs M62 - Junction 24 Ainley Top 5th Pick Up 11:10hrs Thirsk Coach Park (departing from there at 12:00hrs)","Sunderland AFC The Stadium of Light Sunderland SR5 1SU","17:15","Craig Hobin","YD19HGX TM","49","53","False","False"';
  const rows=parsePrivateHireCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].seats).toBe(49);
  expect(rows[0].vehicle_capacity).toBe(53);
  expect(rows[0].route_stops.map(s=>s.location)).toHaveLength(6);
  expect(rows[0].route_stops[1].location).toContain("McDonalds Entrance to Stockport Rail Station");
  expect(rows[0].route_stops[2].location).toContain("TGI Fridays");expect(rows[0].route_stops[3].location).toContain("M62 - Junction 24 Ainley Top");expect(rows[0].route_stops[4].location).toBe("Thirsk Coach Park");expect(rows[0].single_journey).toBe(false);expect(rows[0].back).toBe(true);expect(rows[0].return_leave_time).toBe("17:15");
});


it("distinguishes a one-way passenger job from a passenger return journey",()=>{
  const csv='PickupDateTime,PickupInstructions,DestinationInstructions,LeaveTime,DriverName,RegistrationMark,Seats,ActualSeats,VehicleToStay,SingleJourney\n"10/10/2026 08:40:00","Manchester M1 2DB","Sunderland SR5 1SU","17:15","Driver One","YD19HGX","49","53","False","True"';
  const rows=parsePrivateHireCsv(csv);
  expect(rows[0].single_journey).toBe(true);
  expect(rows[0].back).toBe(false);
  expect(rows[0].return_to_depot).toBe(true);
});


it("retains a physical destination when the supplied postcode is incomplete",()=>{
  const csv='PickupDateTime,PickupInstructions,DestinationInstructions,LeaveTime,DriverName,RegistrationMark,Seats,ActualSeats,VehicleToStay,SingleJourney\n"10/10/2026 14:45:00","243 Princess Road Manchester M14 7LT","Canon Medical Arena\nWorksop Rd,\nAttercliffe, Sheffield S9 3T","21:30","Jamie Brown","V18SWA","34","42","False","False"';
  const rows=parsePrivateHireCsv(csv);
  expect(rows[0].destination).toContain("Canon Medical Arena");
  expect(rows[0].destination).toContain("Sheffield S9 3T");
});


import {isPrivateHireCsv} from "../src/lib/coachManagerParser";
it("classifies the full daily Coach Manager allocation export as Coach Manager, not private hire",()=>{
  const csv='STARTDATETIME,PICKUPDATETIME,PICKUPPOINT,PICKUPINSTRUCTIONS,SINGLEJOURNEY,VEHICLETOSTAY,DESTINATION,DESTINATIONINSTRUCTIONS,ARRIVALDATETIME,LEAVEDATETIME,BACKDATETIME,FINISHDATETIME,SEATS,VEHICLETYPEDESCRIPTION,VEHICLEID,REGISTRATIONMARK,DRIVERID,DRIVERNAME\n"12/10/2026 06:00:00","12/10/2026 06:55:00","Macclesfield Train Station","Sheltered bus stop","False","True","Alderley Park","See timetable","12/10/2026 10:42:00","12/10/2026 10:42:00","12/10/2026 11:30:00","12/10/2026 11:30:00","50","SDSC","YD24EVB AP","YD24EVB AP","027","Jonathan Clinton"';
  expect(isPrivateHireCsv(csv)).toBe(false);
  const rows=parseCoachManagerCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].start_time).toBe("06:00");
  expect(rows[0].pickup_time).toBe("06:55");
  expect(rows[0].arrival_time).toBe("10:42");
  expect(rows[0].finish_time).toBe("11:30");
  expect(rows[0].vehicle_type).toBe("SDSC");
  expect(rows[0].return_leave_time).toBe("11:30");expect(rows[0].return_arrival_time).toBeNull();expect(rows[0].single_journey).toBe(false);expect(rows[0].back).toBe(true);
});


it("uses explicit numbered Coach Manager running-board pickups as route stops",()=>{
  const csv='STARTDATETIME,PICKUPDATETIME,PICKUPPOINT,PICKUPINSTRUCTIONS,SINGLEJOURNEY,VEHICLETOSTAY,DESTINATION,DESTINATIONINSTRUCTIONS,ARRIVALDATETIME,LEAVEDATETIME,BACKDATETIME,FINISHDATETIME,SEATS,VEHICLETYPEDESCRIPTION,VEHICLEID,REGISTRATIONMARK,DRIVERID,DRIVERNAME\n"12/10/2026 06:00:00","12/10/2026 07:00:00","2 x Pick Ups Failsworth & Oldham","1st Pick Up 0700hrs Failsworth M35 9WQ 2nd Pick Up 0720hrs Oldham OL1 1AL","True","False","Gallery Oldham, OL1 1AL","","12/10/2026 08:00:00","12/10/2026 08:00:00","","12/10/2026 08:30:00","49","SDSC","YD24EVB AP","YD24EVB AP","027","Jonathan Clinton"';
  const rows=parseCoachManagerCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].origin).toContain("Failsworth");
  expect(rows[0].route_stops.length).toBeGreaterThanOrEqual(3);
  expect(rows[0].route_stops[0].time).toBe("07:00");
  expect(rows[0].route_stops[1].time).toBe("07:20");
  expect(rows[0].route_stops[rows[0].route_stops.length-1].kind).toBe("destination");
});


it("flags a return booking whose BACKDATETIME contains a date but no usable time",()=>{
  const csv='STARTDATETIME,PICKUPDATETIME,PICKUPPOINT,SINGLEJOURNEY,VEHICLETOSTAY,DESTINATION,ARRIVALDATETIME,LEAVEDATETIME,BACKDATETIME,FINISHDATETIME,SEATS,VEHICLETYPEDESCRIPTION,VEHICLEID,REGISTRATIONMARK,DRIVERID,DRIVERNAME\\n"12/10/2026","12/10/2026 09:15:00","Failsworth","False","False","Gallery Oldham","12/10/2026","12/10/2026 12:00:00","12/10/2026","12/10/2026","49","SDSC","LF71DKY TM","LF71DKY TM","027","Martin Williamson"';
  const rows=parseCoachManagerCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].single_journey).toBe(false);
  expect(rows[0].back).toBe(true);
  expect(rows[0].return_leave_time).toBeNull();
  expect(rows[0].arrival_time).toBeNull();
  expect(rows[0].finish_time).toBeNull();
});
