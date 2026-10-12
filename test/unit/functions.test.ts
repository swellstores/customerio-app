import { afterEach, describe, it, expect, vi } from "vitest";
import sendCustomer from "../../functions/send-customer";
import syncCustomer from "../../functions/sync-customer";
import SyncCustomers from "../../functions/sync-customers";
import testConnection from "../../functions/test-connection";
import trackCart from "../../functions/track-cart";
import trackOrder from "../../functions/track-order";
import trackShipment from "../../functions/track-shipment";
import trackSubscription from "../../functions/track-subscription";
import { account, cart, connection, order, shipment, subscription, swellEvent } from "../fixtures/records";
import { json, mockTrack } from "../helpers/fetch";
import { createMockRequest } from "../helpers/mock-request";
import { mockStore } from "../helpers/store";

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(data: Record<string, any>, records: Record<string, any> = {}, settings: Record<string, any> = { connection }) {
  const store = mockStore(settings, records);
  const req = createMockRequest({ data, swell: store.swell as unknown as Partial<SwellAPI>, appId: "customerio" });
  return { req, ...store };
}

describe("sync-customer", () => {
  it("sends a new customer", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup({ ...account, $event: swellEvent("account.created", account) });

    expect(await syncCustomer(req)).toEqual({ sent: 1 });
    expect(requests[0].body.batch).toHaveLength(1);
    expect(requests[0].body.batch[0]).toMatchObject({
      action: "identify",
      identifiers: { id: account.id },
      attributes: { email: "ada@example.com" },
    });
    expect(requests[0].body.batch[0].attributes).not.toHaveProperty("unsubscribed");
  });

  it("skips an update that only records a login", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup({ ...account, $event: swellEvent("account.updated", { date_last_login: "2026-10-09" }) });

    expect(await syncCustomer(req)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
  });

  it("skips a login without reading the store, so it cannot fail while the keys are refused", async () => {
    mockTrack(() => json(401));
    const { req, swell, issues } = setup({
      ...account,
      $event: swellEvent("account.updated", { date_last_login: "2026-10-09" }),
    });

    expect(await syncCustomer(req)).toHaveProperty("skipped");
    expect(swell.settings).not.toHaveBeenCalled();
    expect(issues).toHaveLength(0);
  });

  it("passes an opt-out on to Customer.io", async () => {
    const requests = mockTrack(() => json(200));
    const changed = { ...account, email_optin: false };
    const { req } = setup({ ...changed, $event: swellEvent("account.updated", { email_optin: false }) });

    await syncCustomer(req);
    expect(requests[0].body.batch[0].attributes).toMatchObject({ email_optin: false, unsubscribed: true });
  });
});

describe("track-order", () => {
  it("sends the person, then the event", async () => {
    const requests = mockTrack(() => json(200));
    const { req, swell } = setup(
      { id: order.id, $event: swellEvent("order.submitted") },
      { [`/orders/${order.id}`]: order },
    );

    expect(await trackOrder(req)).toEqual({ sent: 2 });
    expect(swell.get).toHaveBeenCalledWith(`/orders/${order.id}`, {
      expand: ["account", "items.product", "items.variant"],
    });

    const [person, event] = requests[0].body.batch;
    expect(person).toMatchObject({ action: "identify", identifiers: { id: account.id } });
    expect(event).toMatchObject({
      action: "event",
      name: "Order Completed",
      identifiers: { id: account.id },
      attributes: { order_id: order.id, total: 56 },
    });
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  it.each([
    ["order.paid", "Order Paid"],
    ["order.payment_failed", "Order Payment Failed"],
    ["order.delivered", "Order Fulfilled"],
    ["order.refunded", "Order Refunded"],
    ["order.canceled", "Order Cancelled"],
  ])("names %s as %s", async (type, name) => {
    const requests = mockTrack(() => json(200));
    const { req } = setup({ id: order.id, $event: swellEvent(type) }, { [`/orders/${order.id}`]: order });

    await trackOrder(req);
    expect(requests[0].body.batch[1].name).toBe(name);
  });

  it("skips draft orders and orders that no longer exist", async () => {
    const requests = mockTrack(() => json(200));
    const draft = setup(
      { id: order.id, $event: swellEvent("order.submitted") },
      { [`/orders/${order.id}`]: { ...order, draft: true } },
    );
    const missing = setup({ id: order.id, $event: swellEvent("order.submitted") });

    expect(await trackOrder(draft.req)).toHaveProperty("skipped");
    expect(await trackOrder(missing.req)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
  });
});

describe("track-shipment", () => {
  it("sends Order Shipped to the order's customer", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup(
      { ...shipment, $event: swellEvent("shipment.created") },
      { [`/orders/${order.id}`]: order },
    );

    expect(await trackShipment(req)).toEqual({ sent: 2 });
    expect(requests[0].body.batch[1]).toMatchObject({
      name: "Order Shipped",
      identifiers: { id: account.id },
      attributes: { tracking_code: "1Z999AA10123456784", order_number: "100036" },
    });
  });

  it("skips a canceled shipment", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup({ ...shipment, canceled: true, $event: swellEvent("shipment.created") });

    expect(await trackShipment(req)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
  });
});

describe("track-cart", () => {
  it("sends Cart Abandoned with the recovery link", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup(
      { id: cart.id, account_id: account.id, $event: swellEvent("cart.abandoned") },
      { [`/carts/${cart.id}`]: cart },
    );

    expect(await trackCart(req)).toEqual({ sent: 2 });
    expect(requests[0].body.batch[1]).toMatchObject({
      name: "Cart Abandoned",
      attributes: { checkout_url: cart.checkout_url },
    });
  });

  it("skips a cart that has no customer", async () => {
    const requests = mockTrack(() => json(200));
    const { req, swell } = setup({ id: cart.id, account_id: null, $event: swellEvent("cart.abandoned") });

    expect(await trackCart(req)).toHaveProperty("skipped");
    expect(swell.get).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("skips a cart the shopper came back to before a late delivery", async () => {
    const requests = mockTrack(() => json(200));
    const recovered = setup(
      { id: cart.id, account_id: account.id, $event: swellEvent("cart.abandoned") },
      { [`/carts/${cart.id}`]: { ...cart, status: "active" } },
    );
    const ordered = setup(
      { id: cart.id, account_id: account.id, $event: swellEvent("cart.abandoned") },
      { [`/carts/${cart.id}`]: { ...cart, order_id: order.id } },
    );

    expect(await trackCart(recovered.req)).toHaveProperty("skipped");
    expect(await trackCart(ordered.req)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
  });
});

describe("track-subscription", () => {
  it.each([
    ["subscription.activated", "Subscription Started"],
    ["subscription.paid", "Subscription Paid"],
    ["subscription.payment_failed", "Subscription Payment Failed"],
    ["subscription.payment_expiring", "Subscription Payment Expiring"],
    ["subscription.trial_will_end", "Subscription Trial Ending"],
    ["subscription.paused", "Subscription Paused"],
    ["subscription.resumed", "Subscription Resumed"],
    ["subscription.canceled", "Subscription Cancelled"],
    ["subscription.completed", "Subscription Completed"],
  ])("names %s as %s", async (type, name) => {
    const requests = mockTrack(() => json(200));
    const { req } = setup(
      { id: subscription.id, $event: swellEvent(type) },
      { [`/subscriptions/${subscription.id}`]: subscription },
    );

    expect(await trackSubscription(req)).toEqual({ sent: 2 });
    expect(requests[0].body.batch[1]).toMatchObject({ name, attributes: { subscription_id: subscription.id } });
  });
});

describe("test-connection", () => {
  const action = { $action: { id: "test-connection", source: "field", settings: "connection", user_id: "u1" } };

  it("confirms working keys", async () => {
    mockTrack(() => json(200), { region: "us", environment_id: 235787 });
    const { req, swell } = setup(action);

    const result = await testConnection(req);
    expect(result.message).toContain("workspace 235787");
    expect(result.message).toContain("United States");
    expect(swell.put).not.toHaveBeenCalled();
  });

  it("saves the data center it found", async () => {
    mockTrack(() => json(200), { region: "eu", environment_id: 7 });
    const { req, swell } = setup(action, {}, { connection: { ...connection, region: undefined } });

    const result = await testConnection(req);
    expect(swell.put).toHaveBeenCalledWith("/settings/customerio", {
      connection: { region: "eu", region_site_id: "site" },
    });
    expect(result.message).toContain("European Union");
  });

  it("reminds the merchant to switch the app on", async () => {
    mockTrack(() => json(200));
    const { req } = setup(action, {}, { connection: { ...connection, enabled: false } });

    expect((await testConnection(req)).message).toContain("Turn on");
  });

  it("resolves an open credentials issue", async () => {
    mockTrack(() => json(200));
    const { req, issues } = setup(action);
    issues.push({ id: "issue-0", key: "credentials" });

    await testConnection(req);
    expect(issues).toHaveLength(0);
  });

  it("explains refused keys", async () => {
    mockTrack(() => json(401), 401);
    const { req } = setup(action);

    await expect(testConnection(req)).rejects.toMatchObject({ status: 400 });
    await expect(testConnection(req)).rejects.toThrow("did not accept");
  });

  it("asks for the keys when they are missing", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup(action, {}, { connection: { enabled: false, region: "us" } });

    await expect(testConnection(req)).rejects.toThrow("Enter the Site ID and API key");
    expect(requests).toHaveLength(0);
  });
});

describe("send-customer", () => {
  const action = (recordId: string) => ({
    $action: { id: "send-customer", source: "record", collection: "accounts", record_id: recordId, user_id: "u1" },
  });

  it("sends the customer and names them in the message", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = setup(action(account.id), { [`/accounts/${account.id}`]: account });

    expect(await sendCustomer(req)).toEqual({ message: "Ada Lovelace was sent to Customer.io." });
    expect(requests[0].body.batch[0]).toMatchObject({ action: "identify", identifiers: { id: account.id } });
  });

  it("works while the app is not enabled", async () => {
    mockTrack(() => json(200));
    const { req } = setup(
      action(account.id),
      { [`/accounts/${account.id}`]: account },
      { connection: { ...connection, enabled: false } },
    );

    expect(await sendCustomer(req)).toHaveProperty("message");
  });

  it("refuses an id that is not a record id", async () => {
    const { req, swell } = setup(action("../settings"));

    await expect(sendCustomer(req)).rejects.toMatchObject({ status: 400 });
    expect(swell.get).not.toHaveBeenCalled();
  });

  it("reports a customer that does not exist", async () => {
    mockTrack(() => json(200));
    const { req } = setup(action(account.id));

    await expect(sendCustomer(req)).rejects.toMatchObject({ status: 404 });
  });

  it("shows Customer.io's reason when it refuses the customer", async () => {
    mockTrack(() => json(207, { errors: [{ batch_index: 0, field: "email", reason: "invalid" }] }));
    const { req } = setup(action(account.id), { [`/accounts/${account.id}`]: account });

    await expect(sendCustomer(req)).rejects.toThrow("email: invalid");
  });
});

describe("sync-customers", () => {
  // Runs each step once, the way the workflow engine does on a first attempt
  const step = { do: (_name: string, _options: unknown, callback: () => Promise<any>) => callback() };

  function accounts(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      ...account,
      id: (0x6a8c6473173c911aeddeb000n + BigInt(index)).toString(16),
      email: `customer-${index}@example.com`,
    }));
  }

  function workflow(all: Record<string, any>[], data: Record<string, any> = {}, trigger = "action") {
    const queries: Record<string, any>[] = [];
    const store = mockStore(
      { connection },
      {
        "/accounts": (query: Record<string, any>) => {
          queries.push(query);
          const after = query.$and?.find((condition: any) => condition.id?.$gt)?.id.$gt;
          const rest = after ? all.filter((item) => item.id > after) : all;
          return { results: rest.slice(0, query.limit) };
        },
      },
    );
    const req = { data, swell: store.swell, appId: "customerio", workflow: { trigger } } as unknown as SwellWorkflowRequest;
    return { req, queries, ...store };
  }

  it("sends every customer once, in pages", async () => {
    const requests = mockTrack(() => json(200));
    const all = accounts(450);
    const { req, queries } = workflow(all);

    const result = await new SyncCustomers().run(req, step as unknown as SwellWorkflowStep);

    expect(result).toEqual({ sent: 450, rejected: 0 });
    const sent = requests.flatMap((request) => request.body.batch.map((item: any) => item.identifiers.id));
    expect(sent).toEqual(all.map((item) => item.id));
    expect(queries).toHaveLength(3);
    expect(queries[0]).toEqual({ sort: "id asc", limit: 200 });
    expect(queries[1].$and).toEqual([{ id: { $gt: all[199].id } }]);
  });

  it("never changes anyone's subscription status", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = workflow([{ ...account, email_optin: false }]);

    await new SyncCustomers().run(req, step as unknown as SwellWorkflowStep);
    expect(requests[0].body.batch[0].attributes).not.toHaveProperty("unsubscribed");
  });

  it("continues over several steps on a large store", async () => {
    mockTrack(() => json(200));
    const { req } = workflow(accounts(1200));
    const steps: string[] = [];
    const counting = {
      do: (name: string, _options: unknown, callback: () => Promise<any>) => {
        steps.push(name);
        return callback();
      },
    };

    const result = await new SyncCustomers().run(req, counting as unknown as SwellWorkflowStep);
    expect(result.sent).toBe(1200);
    expect(steps).toEqual(["check the connection", "send customers, part 1", "send customers, part 2"]);
  });

  it("keeps to the customers selected in the list", async () => {
    mockTrack(() => json(200));
    const selection = { all: false, count: 1, query: { $and: [{ id: { $in: [account.id] } }] } };
    const { req, queries } = workflow([account], {
      $action: { id: "sync-selected", source: "bulk", selection },
    });

    await new SyncCustomers().run(req, step as unknown as SwellWorkflowStep);
    expect(queries[0].$and).toEqual([{ id: { $in: [account.id] } }]);
  });

  it("ignores a selection that did not come from a dashboard action", async () => {
    mockTrack(() => json(200));
    const selection = { all: false, count: 1, query: { $and: [{ id: { $in: ["x"] } }] } };
    const { req, queries } = workflow([account], { $action: { source: "bulk", selection } }, "function");

    await new SyncCustomers().run(req, step as unknown as SwellWorkflowStep);
    expect(queries[0]).not.toHaveProperty("$and");
  });

  it("counts refused customers and logs why", async () => {
    mockTrack(() => json(207, { errors: [{ batch_index: 1, field: "email", reason: "invalid" }] }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { req } = workflow(accounts(3));

    const result = await new SyncCustomers().run(req, step as unknown as SwellWorkflowStep);
    expect(result).toEqual({ sent: 2, rejected: 1 });
    expect(warn).toHaveBeenCalledWith("Customer.io refused the customer profile (email: invalid).");
  });

  it("fails before reading any customer when the keys are refused", async () => {
    const requests = mockTrack(() => json(401), 401);
    const { req, issues, queries } = workflow(accounts(3));

    await expect(new SyncCustomers().run(req, step as unknown as SwellWorkflowStep)).rejects.toThrow();
    expect(issues[0]).toMatchObject({ key: "credentials", source: "sync-customers" });
    expect(queries).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});
