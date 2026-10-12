import { afterEach, describe, it, expect, vi } from "vitest";
import {
  byteSize,
  CustomerioError,
  getWorkspace,
  sendBatch,
  splitIntoBatches,
} from "../../functions/lib/customerio";
import type { Operation } from "../../functions/lib/customerio";
import { identify } from "../../functions/lib/people";
import { account, connection } from "../fixtures/records";
import { json, mockCustomerio } from "../helpers/fetch";

const batch: Operation[] = [identify(account)];

afterEach(() => {
  vi.unstubAllGlobals();
});

async function failure(promise: Promise<unknown>): Promise<CustomerioError> {
  const error = await promise.then(
    () => undefined,
    (err) => err,
  );
  expect(error).toBeInstanceOf(CustomerioError);
  return error;
}

describe("sendBatch", () => {
  it("posts the batch to the US data center with basic authentication", async () => {
    const requests = mockCustomerio(() => json(200));

    expect(await sendBatch(connection, batch)).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://track.customer.io/api/v2/batch");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.Authorization).toBe(`Basic ${btoa("site:key")}`);
    expect(requests[0].body).toEqual({ batch });
  });

  it("uses the EU data center when the workspace is there", async () => {
    const requests = mockCustomerio(() => json(200));
    await sendBatch({ ...connection, region: "eu" }, batch);
    expect(requests[0].url).toBe("https://track-eu.customer.io/api/v2/batch");
  });

  it("ignores spaces pasted around the keys", async () => {
    const requests = mockCustomerio(() => json(200));
    await sendBatch({ ...connection, site_id: " site ", api_key: "key\n" }, batch);
    expect(requests[0].headers.Authorization).toBe(`Basic ${btoa("site:key")}`);
  });

  it("sends nothing for an empty batch", async () => {
    const requests = mockCustomerio(() => json(200));
    expect(await sendBatch(connection, [])).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("returns the operations Customer.io refused while accepting the rest", async () => {
    const errors = [{ batch_index: 0, field: "identifiers", reason: "invalid", message: "id is too long" }];
    mockCustomerio(() => json(207, { errors }));
    expect(await sendBatch(connection, batch)).toEqual(errors);
  });

  it("reports refused keys as a credentials failure", async () => {
    mockCustomerio(() => json(401, { meta: { error: "Unauthorized request" } }));
    const error = await failure(sendBatch(connection, batch));
    expect(error.kind).toBe("credentials");
  });

  it("reports missing keys without calling Customer.io", async () => {
    const requests = mockCustomerio(() => json(200));
    const error = await failure(sendBatch({ ...connection, api_key: " " }, batch));
    expect(error.kind).toBe("credentials");
    expect(requests).toHaveLength(0);
  });

  it("reports a refused request as final", async () => {
    mockCustomerio(() => json(400, { errors: [{ reason: "invalid", field: "batch", message: "malformed" }] }));
    const error = await failure(sendBatch(connection, batch));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("malformed");
  });

  it.each([408, 429, 500, 503])("reports status %i as worth another try", async (status) => {
    mockCustomerio(() => json(status));
    const error = await failure(sendBatch(connection, batch));
    expect(error.kind).toBe("unavailable");
  });

  it("reports a network failure as worth another try", async () => {
    mockCustomerio(() => {
      throw new TypeError("network down");
    });
    const error = await failure(sendBatch(connection, batch));
    expect(error.kind).toBe("unavailable");
  });
});

describe("getWorkspace", () => {
  it("returns the region and workspace of the credentials", async () => {
    const requests = mockCustomerio(() =>
      json(200, { region: "eu", url: "https://track-eu.customer.io", environment_id: 42 }),
    );
    expect(await getWorkspace(connection)).toEqual({ region: "eu", environment_id: 42 });
    expect(requests[0].url).toBe("https://track.customer.io/api/v1/accounts/region");
    expect(requests[0].method).toBe("GET");
  });

  it("reports refused keys", async () => {
    mockCustomerio(() => json(401));
    const error = await failure(getWorkspace(connection));
    expect(error.kind).toBe("credentials");
  });
});

describe("splitIntoBatches", () => {
  it("keeps every batch under the size limit and the operations in order", () => {
    const operations = Array.from({ length: 50 }, (_, index) => identify({ ...account, id: `id-${index}` }));
    const limit = byteSize(operations[0]) * 10;
    const batches = splitIntoBatches(operations, limit);

    expect(batches.length).toBeGreaterThan(4);
    for (const part of batches) {
      expect(byteSize(part)).toBeLessThanOrEqual(limit + 2);
    }
    expect(batches.flat()).toEqual(operations);
  });

  it("returns no batches for no operations", () => {
    expect(splitIntoBatches([])).toEqual([]);
  });
});
