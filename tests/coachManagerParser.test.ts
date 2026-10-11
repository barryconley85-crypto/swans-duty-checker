import {describe,it,expect} from "vitest"; import {parseCoachManagerText} from "../src/lib/coachManagerParser";
describe("Coach Manager parser",()=>{it("parses representative duties and carries driver name backward from the first driver heading",()=>{const text=`06:15 08:15 Altrincham Interchange Bus Yes No Radbroke Hall WA16 9EU 09:05 09:15 10:00 70 DDSB YX74OHN TM
Jonathan Clinton
10:25 10:50 Audenshaw Primary School Yes No Tameside Wellness Centre 11:00 11:05 11:05 35 SDSC YX74OHN TM
11:25 12:15 St Marys CE Primary School Yes No Manchester Central Library, M2 12:25 12:25 ??:?? 65 SDSC YX74OHN TM`;const rows=parseCoachManagerText(text);expect(rows).toHaveLength(3);expect(rows.map(r=>r.driver_name)).toEqual(["Jonathan Clinton","Jonathan Clinton","Jonathan Clinton"]);expect(rows[0].vehicle_id).toBe("YX74OHN");expect(rows[0].vehicle_type).toBe("DDSB");expect(rows[2].finish_time).toBeNull()});it("handles CAR SDSC vehicle types without mistaking SDSC for the registration",()=>{const rows=parseCoachManagerText(`??:?? 12:50 RUN3 Newman Catholic College OL9 9QY Yes No Academy Stadium M11 4TQ ??:?? ??:?? ??:?? 1 CAR SDSC RJ19HVU AP`);expect(rows[0].vehicle_type).toBe("CAR SDSC");expect(rows[0].vehicle_id).toBe("RJ19HVU")})});
import {parseCoachManagerCsv} from "../src/lib/coachManagerParser";
it("parses the real Coach Manager CSV structure",()=>{const rows=parseCoachManagerCsv('STARTDATETIME,PICKUPDATETIME,PICKUPPOINT,SINGLEJOURNEY,VEHICLETOSTAY,DESTINATION,ARRIVALDATETIME,LEAVEDATETIME,BACKDATETIME,FINISHDATETIME,SEATS,VEHICLETYPE,VEHICLEID,REGISTRATIONMARK,DRIVERID,DRIVERNAME\n"06/10/2026 06:10:00","06/10/2026 07:40:00","ST BEDES AM HALE","True","False","St Bedes College 6","06/10/2026 08:40:00","06/10/2026 08:45:00","","06/10/2026","53","SDSC","YD19HGX TM","YD19HGX TM","041TM","Craig Hobin"');expect(rows).toHaveLength(1);expect(rows[0].driver_name).toBe("Craig Hobin");expect(rows[0].vehicle_id).toBe("YD19HGX");expect(rows[0].origin).toBe("ST BEDES AM HALE");expect(rows[0].leave_time).toBe("08:45");expect(rows[0].arrival_time).toBe("08:40");expect(rows[0].finish_time).toBeNull();});

import {parsePrivateHireCsv} from "../src/lib/coachManagerParser";
it("keeps separately labelled private-hire pickups even when an intermediate stop has no postcode",()=>{
  const csv='PickupDateTime,PickupInstructions,DestinationInstructions,LeaveTime,DriverName,RegistrationMark,Seats,ActualSeats,VehicleToStay,SingleJourney\n"10/10/2026 08:40:00","1st Pick Up 0840hrs Manchester Abode Hotel 107 Piccadilly Manchester M1 2DB 2nd Pick Up 0900hrs McDonalds Entrance to Stockport Rail Station 3rd pick-up 0930hrs TGI Fridays Prestwich J17 - M60 4TH","Sunderland AFC The Stadium of Light Sunderland SR5 1SU","17:15","Craig Hobin","YD19HGX TM","49","53","False","False"';
  const rows=parsePrivateHireCsv(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].route_stops.map(s=>s.location)).toHaveLength(4);
  expect(rows[0].route_stops[1].location).toContain("McDonalds Entrance to Stockport Rail Station");
  expect(rows[0].route_stops[2].location).toContain("TGI Fridays");
});
