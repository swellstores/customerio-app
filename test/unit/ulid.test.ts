import { describe, it, expect } from "vitest";
import { eventUlid, idTimestamp } from "../../functions/lib/ulid";

const EVENT_ID = "6ac93eb7ad5799fa4bd63e92";

describe("eventUlid", () => {
  it("builds a valid ULID", () => {
    expect(eventUlid(EVENT_ID, "Order Completed")).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it("is the same for a repeated delivery of the same event", () => {
    expect(eventUlid(EVENT_ID, "Order Completed")).toBe(eventUlid(EVENT_ID, "Order Completed"));
    expect(eventUlid(EVENT_ID.toUpperCase(), "Order Completed")).toBe(eventUlid(EVENT_ID, "Order Completed"));
  });

  it("differs between events and between event names", () => {
    const other = "6ac93eb7ad5799fa4bd63e93";
    expect(eventUlid(other, "Order Completed")).not.toBe(eventUlid(EVENT_ID, "Order Completed"));
    expect(eventUlid(EVENT_ID, "Order Paid")).not.toBe(eventUlid(EVENT_ID, "Order Completed"));
  });

  it("carries the time of the Swell event", () => {
    const ulid = eventUlid(EVENT_ID, "Order Completed")!;
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let milliseconds = 0;
    for (const char of ulid.slice(0, 10)) {
      milliseconds = milliseconds * 32 + alphabet.indexOf(char);
    }
    expect(milliseconds).toBe(idTimestamp(EVENT_ID)! * 1000);
  });

  it("returns nothing for a value that is not a Swell id", () => {
    expect(eventUlid(undefined, "Order Completed")).toBeUndefined();
    expect(eventUlid("evt_123", "Order Completed")).toBeUndefined();
  });
});

describe("idTimestamp", () => {
  it("reads Unix seconds from the id", () => {
    expect(idTimestamp(EVENT_ID)).toBe(0x6ac93eb7);
    expect(new Date(idTimestamp(EVENT_ID)! * 1000).toISOString()).toBe("2026-10-09T19:21:27.000Z");
  });
});
