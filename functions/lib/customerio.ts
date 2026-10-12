/**
 * Customer.io Track API client: the only module that talks to Customer.io.
 * Uses the v2 batch endpoint so a person and what they did travel in one request.
 */

export type Region = "us" | "eu";

export interface Connection {
  site_id: string;
  api_key: string;
  region: Region;
}

export type Attributes = Record<string, unknown>;

export interface IdentifyOperation {
  type: "person";
  action: "identify";
  identifiers: { id: string };
  attributes: Attributes;
}

export interface EventOperation {
  type: "person";
  action: "event";
  identifiers: { id: string };
  name: string;
  /** ULID. Customer.io ignores an event whose id it has already seen */
  id?: string;
  /** Unix seconds */
  timestamp?: number;
  attributes: Attributes;
}

export type Operation = IdentifyOperation | EventOperation;

/** One operation Customer.io refused while accepting the rest of the batch */
export interface Rejection {
  batch_index?: number;
  field?: string;
  reason?: string;
  message?: string;
}

/**
 * credentials: the Site ID or API key is missing or was refused.
 * rejected: Customer.io refused the whole request; sending it again cannot help.
 * unavailable: timeout, rate limit or outage; sending it again later can help.
 */
export type FailureKind = "credentials" | "rejected" | "unavailable";

export class CustomerioError extends Error {
  kind: FailureKind;
  status: number;

  constructor(kind: FailureKind, status: number, message: string) {
    super(message);
    this.name = "CustomerioError";
    this.kind = kind;
    this.status = status;
  }
}

const HOSTS: Record<Region, string> = {
  us: "https://track.customer.io",
  eu: "https://track-eu.customer.io",
};

// Customer.io limits: 500 KB per batch request, 32 KB per operation
export const MAX_BATCH_BYTES = 450_000;
export const MAX_OPERATION_BYTES = 30_000;

// Functions are stopped after 10 seconds, so give up while there is still time to report
const REQUEST_TIMEOUT_MS = 7000;

const encoder = new TextEncoder();

export function byteSize(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

export function hasCredentials(connection: Partial<Connection> | undefined): connection is Connection {
  return Boolean(connection?.site_id?.trim() && connection?.api_key?.trim());
}

function authorization(connection: Connection): string {
  return `Basic ${btoa(`${connection.site_id.trim()}:${connection.api_key.trim()}`)}`;
}

async function call(connection: Connection, url: string, init: RequestInit): Promise<Response> {
  if (!hasCredentials(connection)) {
    throw new CustomerioError("credentials", 401, "The Site ID or API key is missing in the app settings.");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: authorization(connection),
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CustomerioError("unavailable", 503, `Customer.io could not be reached: ${(err as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CustomerioError("credentials", response.status, "Customer.io refused the Site ID or API key.");
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new CustomerioError("unavailable", response.status, `Customer.io answered ${response.status}.`);
  }
  return response;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function describe(rejection: Rejection): string {
  return [rejection.field, rejection.reason, rejection.message].filter(Boolean).join(": ");
}

/**
 * Sends one batch. Resolves with the operations Customer.io refused (none when all were accepted);
 * the other operations of the same batch were accepted.
 */
export async function sendBatch(connection: Connection, batch: Operation[]): Promise<Rejection[]> {
  if (batch.length === 0) {
    return [];
  }

  const host = HOSTS[connection.region] || HOSTS.us;
  const response = await call(connection, `${host}/api/v2/batch`, {
    method: "POST",
    body: JSON.stringify({ batch }),
  });

  if (response.status === 200) {
    return [];
  }

  const body = await readJson(response);
  const rejections: Rejection[] = Array.isArray(body?.errors) ? body.errors : [];

  if (response.status === 207) {
    return rejections;
  }

  const detail = rejections.map(describe).filter(Boolean).join("; ");
  throw new CustomerioError(
    "rejected",
    response.status,
    `Customer.io refused the request (${response.status})${detail ? `: ${detail}` : "."}`,
  );
}

/** Splits operations into batches that stay under the request size limit, keeping their order */
export function splitIntoBatches(operations: Operation[], maxBytes = MAX_BATCH_BYTES): Operation[][] {
  const batches: Operation[][] = [];
  let current: Operation[] = [];
  let size = 0;

  for (const operation of operations) {
    const operationSize = byteSize(operation) + 1;
    if (current.length > 0 && size + operationSize > maxBytes) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(operation);
    size += operationSize;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

export interface Workspace {
  region: Region;
  environment_id: number;
}

/**
 * Checks the credentials and finds the region of the workspace they belong to.
 * Customer.io answers this from either regional host.
 */
export async function getWorkspace(connection: Omit<Connection, "region">): Promise<Workspace> {
  const response = await call({ ...connection, region: "us" }, `${HOSTS.us}/api/v1/accounts/region`, {
    method: "GET",
  });
  const body = await readJson(response);

  if (response.status !== 200 || (body?.region !== "us" && body?.region !== "eu")) {
    throw new CustomerioError("unavailable", response.status, `Customer.io answered ${response.status}.`);
  }
  return { region: body.region, environment_id: body.environment_id };
}
