/**
 * Maps a Swell account to a Customer.io person.
 * The person's id is the Swell account id, so an email changed in Swell reaches the same person.
 */

import type { Attributes, IdentifyOperation } from "./customerio";

export type SwellRecord = Record<string, any>;

/** Unix seconds: the format Customer.io needs for date conditions in segments */
export function unix(date: unknown): number | undefined {
  if (!date) {
    return undefined;
  }
  const time = new Date(date as string).getTime();
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000);
}

// Customer.io cuts off attribute values longer than this many bytes
const MAX_TEXT_LENGTH = 900;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT_LENGTH) : undefined;
}

/** Drops empty values, so a field missing in Swell never overwrites a value in Customer.io */
export function compact<T extends Attributes>(attributes: T): T {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Swell account field → Customer.io attribute, for the fields that map one to one.
 * Also the list of account fields whose change is worth a request to Customer.io.
 */
const ATTRIBUTE_BY_FIELD: Record<string, string> = {
  email: "email",
  first_name: "first_name",
  last_name: "last_name",
  name: "name",
  phone: "phone_number",
  type: "account_type",
  group: "customer_group",
  locale: "locale",
  currency: "currency",
  email_optin: "email_optin",
  sms_optin: "sms_optin",
  order_count: "order_count",
  order_value: "order_value",
  date_first_order: "first_order_at",
  date_last_order: "last_order_at",
  cart_abandoned_count: "cart_abandoned_count",
  date_last_cart_abandoned: "last_cart_abandoned_at",
  balance: "account_balance",
};

const ADDRESS_FIELDS = ["shipping", "billing"];

export function personAttributes(account: SwellRecord): Attributes {
  const address = account.shipping?.country ? account.shipping : account.billing || account.shipping || {};

  return compact({
    email: text(account.email),
    first_name: text(account.first_name),
    last_name: text(account.last_name),
    name: text(account.name),
    // Not `phone`: Customer.io workspaces use that as an identifier by default, and Swell does not
    // keep phone numbers unique, so two customers sharing a number would overwrite each other
    phone_number: text(account.phone),
    created_at: unix(account.date_created),
    account_type: text(account.type),
    customer_group: text(account.group),
    locale: text(account.locale),
    currency: text(account.currency),
    country: text(address.country),
    state: text(address.state),
    city: text(address.city),
    email_optin: account.email_optin === true,
    sms_optin: account.sms_optin === true,
    order_count: account.order_count ?? 0,
    order_value: account.order_value ?? 0,
    first_order_at: unix(account.date_first_order),
    last_order_at: unix(account.date_last_order),
    cart_abandoned_count: account.cart_abandoned_count ?? 0,
    last_cart_abandoned_at: unix(account.date_last_cart_abandoned),
    account_balance: account.balance ?? 0,
  });
}

export function identify(account: SwellRecord, extra: Attributes = {}): IdentifyOperation {
  return {
    type: "person",
    action: "identify",
    identifiers: { id: String(account.id) },
    attributes: { ...personAttributes(account), ...extra },
  };
}

/** True when an account update touched a field that Customer.io receives */
export function hasSyncedChange(changed: SwellRecord | undefined): boolean {
  if (!changed) {
    return false;
  }
  return Object.keys(changed).some((field) => field in ATTRIBUTE_BY_FIELD || ADDRESS_FIELDS.includes(field));
}

/**
 * Identify for an account update. On top of the account's current values:
 * - a field emptied in Swell is sent as an empty string, which removes the attribute in Customer.io;
 * - `unsubscribed` is written only when the email opt-in itself changed, so an unsubscribe made
 *   through a Customer.io message is never undone by an unrelated update.
 */
export function identifyChange(account: SwellRecord, changed: SwellRecord | undefined): IdentifyOperation {
  const operation = identify(account);
  if (!changed) {
    return operation;
  }

  const touched = Object.keys(changed)
    .map((field) => ATTRIBUTE_BY_FIELD[field])
    .filter(Boolean);
  if (ADDRESS_FIELDS.some((field) => field in changed)) {
    touched.push("country", "state", "city");
  }
  for (const attribute of touched) {
    if (!(attribute in operation.attributes)) {
      operation.attributes[attribute] = "";
    }
  }

  // The account's current value, not the changed one: a delivery that Swell repeats later
  // must not bring back a choice the customer has since reversed
  if ("email_optin" in changed) {
    operation.attributes.unsubscribed = account.email_optin !== true;
  }
  return operation;
}
