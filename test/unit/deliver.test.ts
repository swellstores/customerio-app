import { afterEach, describe, it, expect, vi } from "vitest";
import { deliver, RETRY_WINDOW_MS } from "../../functions/lib/deliver";
import { identify } from "../../functions/lib/people";
import { account, connection, swellEvent } from "../fixtures/records";
import { json, mockTrack } from "../helpers/fetch";
import { createMockRequest } from "../helpers/mock-request";
import { mockStore } from "../helpers/store";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(settings: Record<string, any>, delivery: Record<string, unknown> = {}) {
  const store = mockStore(settings);
  const req = createMockRequest({
    data: { ...account, $event: swellEvent("order.submitted", {}, delivery) },
    swell: store.swell as unknown as Partial<SwellAPI>,
    appId: "customerio",
  });
  return { req, ...store };
}

async function thrown(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error("Expected the delivery to fail");
    },
    (err) => err,
  );
}

const build = () => [identify(account)];

describe("deliver", () => {
  it("sends the batch and reports how many operations went out", async () => {
    const requests = mockTrack(() => json(200));
    const { req, issues } = request({ connection });

    expect(await deliver(req, build)).toEqual({ sent: 1 });
    expect(requests).toHaveLength(1);
    expect(issues).toHaveLength(0);
  });

  it("does nothing while the app is not enabled", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = request({ connection: { ...connection, enabled: false } });

    expect(await deliver(req, build)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
  });

  it("skips a record that has nothing to send", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = request({ connection });

    expect(await deliver(req, () => undefined)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
  });

  it("skips a record that has nothing to send even while the keys are refused", async () => {
    const requests = mockTrack(() => json(401), 401);
    const { req, issues } = request({ connection });

    expect(await deliver(req, () => undefined)).toHaveProperty("skipped");
    expect(requests).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it("asks Swell to retry when Customer.io is unavailable", async () => {
    mockTrack(() => json(503));
    const { req, issues } = request({ connection });

    const error = await thrown(deliver(req, build));
    expect(error.status).toBe(503);
    expect(error.retry).not.toBe(false);
    expect(issues).toHaveLength(0);
  });

  it("records refused credentials and keeps the event for a retry", async () => {
    mockTrack(() => json(401), 401);
    const { req, issues } = request({ connection });

    const error = await thrown(deliver(req, build));
    expect(error.status).toBe(401);
    expect(error.retry).not.toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: "credentials", source: "order.submitted", count: 1 });
  });

  it("keeps the app's record id on the issue, for the link in the email", async () => {
    mockTrack(() => json(401), 401);
    const { req, issues } = request({ id: "6ac9cc7b4c89d10012fc6a37", connection });

    await thrown(deliver(req, build));
    expect(issues[0].app_id).toBe("6ac9cc7b4c89d10012fc6a37");
  });

  it("counts a repeated credentials failure on the same issue", async () => {
    mockTrack(() => json(401), 401);
    const { req, issues } = request({ connection });

    await thrown(deliver(req, build));
    await thrown(deliver(req, build));
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(2);
  });

  it("opens a new issue when the same problem returns after a quiet day", async () => {
    mockTrack(() => json(401), 401);
    const { req, issues } = request({ connection });

    await thrown(deliver(req, build));
    const firstId = issues[0].id;
    issues[0].date_last_seen = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await thrown(deliver(req, build));

    expect(issues).toHaveLength(1);
    expect(issues[0].id).not.toBe(firstId);
    expect(issues[0].count).toBe(1);
  });

  it("treats missing keys as refused credentials without calling Customer.io", async () => {
    const requests = mockTrack(() => json(200));
    const { req, issues } = request({ connection: { enabled: true, region: "us" } });

    const error = await thrown(deliver(req, build));
    expect(error.status).toBe(401);
    expect(requests).toHaveLength(0);
    expect(issues[0].key).toBe("credentials");
  });

  it("finds the data center on first use and remembers it", async () => {
    const requests = mockTrack(() => json(200), { region: "eu", environment_id: 7 });
    const { req, swell } = request({ connection: { ...connection, region: undefined } });

    expect(await deliver(req, build)).toEqual({ sent: 1 });
    expect(requests.lookups).toHaveLength(1);
    expect(requests[0].url).toBe("https://track-eu.customer.io/api/v2/batch");
    expect(swell.put).toHaveBeenCalledWith("/settings/customerio", {
      connection: { region: "eu", region_site_id: "site" },
    });
  });

  it("does not look the data center up again once it is known", async () => {
    const requests = mockTrack(() => json(200));
    const { req } = request({ connection });

    await deliver(req, build);
    expect(requests.lookups).toHaveLength(0);
  });

  it("looks the data center up again when the Site ID was replaced", async () => {
    const requests = mockTrack(() => json(200), { region: "eu", environment_id: 7 });
    const { req, swell } = request({ connection: { ...connection, site_id: "new-site" } });

    expect(await deliver(req, build)).toEqual({ sent: 1 });
    expect(requests.lookups).toHaveLength(1);
    expect(requests[0].url).toBe("https://track-eu.customer.io/api/v2/batch");
    expect(swell.put).toHaveBeenCalledWith("/settings/customerio", {
      connection: { region: "eu", region_site_id: "new-site" },
    });
  });

  it("does not retry what Customer.io refused, and keeps the reason for the delivery log", async () => {
    mockTrack(() =>
      json(207, { errors: [{ batch_index: 0, field: "attributes", reason: "invalid", message: "too large" }] }),
    );
    const { req, issues } = request({ connection });

    const error = await thrown(deliver(req, build));
    expect(error.retry).toBe(false);
    expect(error.message).toBe("Customer.io refused the customer profile (attributes: invalid: too large).");
    expect(issues).toHaveLength(0);
  });

  it("does not retry a request Customer.io refused as a whole", async () => {
    mockTrack(() => json(400, { errors: [{ reason: "invalid", message: "malformed" }] }));
    const { req } = request({ connection });

    const error = await thrown(deliver(req, build));
    expect(error.retry).toBe(false);
    expect(error.message).toContain("malformed");
  });

  it("gives up on a delivery that has been failing for longer than the retry window", async () => {
    const requests = mockTrack(() => json(200));
    const firstFailed = new Date(Date.now() - RETRY_WINDOW_MS - 60_000).toISOString();
    const { req, swell } = request({ connection }, { attempts: 12, date_first_failed: firstFailed });

    const error = await thrown(deliver(req, build));
    expect(error.retry).toBe(false);
    expect(requests).toHaveLength(0);
    expect(swell.settings).not.toHaveBeenCalled();
  });

  it("keeps retrying inside the retry window", async () => {
    mockTrack(() => json(200));
    const firstFailed = new Date(Date.now() - RETRY_WINDOW_MS + 60_000).toISOString();
    const { req } = request({ connection }, { attempts: 9, date_first_failed: firstFailed });

    expect(await deliver(req, build)).toEqual({ sent: 1 });
  });

  it("still reports the failure when the issue cannot be recorded", async () => {
    mockTrack(() => json(401), 401);
    const { req, swell } = request({ connection });
    swell.get.mockRejectedValue(new Error("store unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const error = await thrown(deliver(req, build));
    expect(error.status).toBe(401);
  });
});
