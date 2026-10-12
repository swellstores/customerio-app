import { describe, it, expect } from "vitest";
import { hasSyncedChange, identify, identifyChange, personAttributes, unix } from "../../functions/lib/people";
import { account } from "../fixtures/records";

describe("personAttributes", () => {
  it("maps a Swell account to Customer.io attributes", () => {
    expect(personAttributes(account)).toEqual({
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      name: "Ada Lovelace",
      phone_number: "+14155550101",
      created_at: 1787585651,
      account_type: "individual",
      customer_group: "vip",
      locale: "en-US",
      currency: "USD",
      country: "US",
      state: "CA",
      city: "San Francisco",
      email_optin: true,
      sms_optin: false,
      order_count: 2,
      order_value: 38,
      first_order_at: 1787585674,
      last_order_at: 1787746453,
      cart_abandoned_count: 0,
      account_balance: 0,
    });
  });

  it("leaves out what the account does not have", () => {
    const attributes = personAttributes({ id: "1", email: "a@b.c", first_name: "", phone: null });
    expect(attributes).not.toHaveProperty("first_name");
    expect(attributes).not.toHaveProperty("phone_number");
    expect(attributes).not.toHaveProperty("country");
    expect(attributes).not.toHaveProperty("first_order_at");
  });

  it("falls back to the billing address", () => {
    const attributes = personAttributes({ id: "1", shipping: {}, billing: { country: "DE", city: "Berlin" } });
    expect(attributes).toMatchObject({ country: "DE", city: "Berlin" });
  });

  it("never sends the phone as Customer.io's `phone` identifier", () => {
    expect(personAttributes(account)).not.toHaveProperty("phone");
  });

  it("never sends the unsubscribed flag", () => {
    expect(personAttributes({ ...account, email_optin: false })).not.toHaveProperty("unsubscribed");
  });
});

describe("identify", () => {
  it("uses the Swell account id as the person id", () => {
    const operation = identify(account);
    expect(operation).toMatchObject({ type: "person", action: "identify", identifiers: { id: account.id } });
  });
});

describe("identifyChange", () => {
  it("unsubscribes when the customer opted out in Swell", () => {
    const operation = identifyChange({ ...account, email_optin: false }, { email_optin: false });
    expect(operation.attributes).toMatchObject({ email_optin: false, unsubscribed: true });
  });

  it("subscribes again when the customer opted in in Swell", () => {
    const operation = identifyChange(account, { email_optin: true });
    expect(operation.attributes.unsubscribed).toBe(false);
  });

  it("follows the account's current consent when an old change is delivered late", () => {
    // The customer opted out, then in again; Swell repeats the delivery of the first change
    const operation = identifyChange({ ...account, email_optin: true }, { email_optin: false });
    expect(operation.attributes).toMatchObject({ email_optin: true, unsubscribed: false });
  });

  it("unsubscribes when the consent was removed, not only when it was set to false", () => {
    const operation = identifyChange({ ...account, email_optin: null }, { email_optin: null });
    expect(operation.attributes).toMatchObject({ email_optin: false, unsubscribed: true });
  });

  it("does not touch the unsubscribed flag on any other change", () => {
    const operation = identifyChange({ ...account, email_optin: false }, { first_name: "Ada" });
    expect(operation.attributes).not.toHaveProperty("unsubscribed");
  });

  it("removes an attribute whose field was emptied in Swell", () => {
    const operation = identifyChange({ ...account, phone: null, group: "" }, { phone: null, group: "" });
    expect(operation.attributes.phone_number).toBe("");
    expect(operation.attributes.customer_group).toBe("");
    expect(operation.attributes.email).toBe("ada@example.com");
  });

  it("removes the address when it was emptied in Swell", () => {
    const operation = identifyChange({ ...account, shipping: {} }, { shipping: {} });
    expect(operation.attributes).toMatchObject({ country: "", state: "", city: "" });
  });
});

describe("hasSyncedChange", () => {
  it("ignores updates that only record a login", () => {
    expect(hasSyncedChange({ date_last_login: "2026-10-09T12:00:00.000Z" })).toBe(false);
    expect(hasSyncedChange(undefined)).toBe(false);
  });

  it("sees a change to a field that Customer.io receives", () => {
    expect(hasSyncedChange({ email: "new@example.com" })).toBe(true);
    expect(hasSyncedChange({ shipping: { city: "Oakland" } })).toBe(true);
    expect(hasSyncedChange({ order_count: 3 })).toBe(true);
  });
});

describe("unix", () => {
  it("converts dates to Unix seconds", () => {
    expect(unix("2026-08-24T15:34:11.738Z")).toBe(1787585651);
    expect(unix(undefined)).toBeUndefined();
    expect(unix("not a date")).toBeUndefined();
  });
});
