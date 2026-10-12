import { vi } from "vitest";

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** Replaces `fetch` with a stand-in for Customer.io and records what the app sent */
export function mockCustomerio(respond: (request: SentRequest) => Response | Promise<Response>) {
  const requests: SentRequest[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request: SentRequest = {
      url: String(input),
      method: init.method || "GET",
      headers: (init.headers || {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    requests.push(request);
    return respond(request);
  });
  vi.stubGlobal("fetch", mock);
  return requests;
}

export function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Like mockCustomerio, with the workspace lookup answered separately: `respond` only sees batch
 * requests, and the returned list only holds those. Pass a status as `workspace` to refuse the lookup.
 */
export function mockTrack(
  respond: (request: SentRequest) => Response | Promise<Response>,
  workspace: { region: string; environment_id: number } | number = { region: "us", environment_id: 1 },
) {
  const batches: SentRequest[] = [];
  const lookups: SentRequest[] = [];
  mockCustomerio((request) => {
    if (request.url.endsWith("/api/v1/accounts/region")) {
      lookups.push(request);
      return typeof workspace === "number" ? json(workspace) : json(200, workspace);
    }
    batches.push(request);
    return respond(request);
  });
  return Object.assign(batches, { lookups });
}
