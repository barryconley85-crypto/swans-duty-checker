import {describe,expect,it} from "vitest";
import {safeLocation} from "../api/ai-review.js";

describe("AI review location sanitisation",()=>{
  it("keeps a useful school label and postcode while removing contacts and shuttle credentials",()=>{
    const value="The Manchester Grammar School if running late please call Nicole Reynolds - Transport Co-ordinator - 07738494610 Sam Crawshaw - Deputy Head - 07734467892 Shuttle ID : driver.shuttleid.uk username : MGS2 Password : Swans1234, M13 0XT";
    const safe=safeLocation(value)??"";
    expect(safe).toContain("The Manchester Grammar School");
    expect(safe).toContain("M13 0XT");
    expect(safe).not.toContain("Nicole");
    expect(safe).not.toContain("07738494610");
    expect(safe).not.toContain("MGS2");
    expect(safe).not.toContain("Swans1234");
    expect(safe).not.toContain("Password");
  });
  it("removes free-text driver instructions while preserving the physical location",()=>{
    const value="Blessed Thomas Holford Catholic College Urban Road, Altrincham, DRIVER: The school site is tight for parking. Wheelchair instructions. WA15 8HT";
    const safe=safeLocation(value)??"";
    expect(safe).toContain("Blessed Thomas Holford Catholic College");
    expect(safe).toContain("WA15 8HT");
    expect(safe).not.toContain("Wheelchair instructions");
  });
  it("removes a phone number from otherwise ordinary location text",()=>{
    const safe=safeLocation("Oldham bus station 0161 555 1234, OL1 1AL")??"";
    expect(safe).toContain("Oldham bus station");
    expect(safe).toContain("OL1 1AL");
    expect(safe).not.toContain("0161");
  });
});
