import { resolveConnection } from "./lib/connection";
import type { Settings } from "./lib/connection";
import { CustomerioError, getWorkspace, sendBatch, splitIntoBatches } from "./lib/customerio";
import { describeRejections } from "./lib/deliver";
import { recordCredentialsIssue } from "./lib/issues";
import { identify } from "./lib/people";
import type { SwellRecord } from "./lib/people";

export const config: SwellConfig = {
  kind: "workflow",
  description: "Send existing customers to Customer.io: all of them, or the ones selected in the customer list",
  action: true,
};

const PAGE_SIZE = 200;
// A step is the unit that is retried, so it stays small enough to repeat cheaply
const PAGES_PER_STEP = 5;
const SOURCE = "sync-customers";

interface Part {
  cursor?: string;
  sent: number;
  rejected: number;
  done: boolean;
}

/** Reports a credentials failure where the merchant will see it, then fails the step */
async function reportingCredentials<T>(swell: SwellWorkflowAPI, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof CustomerioError && err.kind === "credentials") {
      await recordCredentialsIssue(swell, err.message, SOURCE);
    }
    throw err;
  }
}

/** Fails the run at once when the keys are missing or refused, before any customer is read */
async function checkConnection(swell: SwellWorkflowAPI, appId: string): Promise<void> {
  await reportingCredentials(swell, async () => {
    const settings = (await swell.settings()) as Settings;
    const connection = await resolveConnection(swell, appId, settings);
    await getWorkspace(connection);
  });
}

/**
 * Sends the next customers after `cursor`, in id order. Identify is an upsert by the Swell
 * account id, so repeating a part, or the whole run, changes nothing in Customer.io.
 */
async function sendPart(
  swell: SwellWorkflowAPI,
  appId: string,
  selection: Record<string, any>,
  cursor: string | undefined,
): Promise<Part> {
  return reportingCredentials(swell, async () => {
    const settings = (await swell.settings()) as Settings;
    const connection = await resolveConnection(swell, appId, settings);
    const part: Part = { cursor, sent: 0, rejected: 0, done: false };

    for (let page = 0; page < PAGES_PER_STEP && !part.done; page++) {
      // The store refuses an empty $and, so the filter is only sent when it has conditions
      const conditions = [...(selection.$and || []), ...(part.cursor ? [{ id: { $gt: part.cursor } }] : [])];
      const accounts = (await swell.get("/accounts", {
        ...selection,
        ...(conditions.length > 0 ? { $and: conditions } : {}),
        sort: "id asc",
        limit: PAGE_SIZE,
      })) as { results?: SwellRecord[] };
      const results = accounts?.results || [];

      for (const batch of splitIntoBatches(results.map((account) => identify(account)))) {
        const rejections = await sendBatch(connection, batch);
        if (rejections.length > 0) {
          console.warn(describeRejections(rejections, batch));
        }
        part.sent += batch.length - rejections.length;
        part.rejected += rejections.length;
      }

      if (results.length > 0) {
        part.cursor = results[results.length - 1].id;
      }
      part.done = results.length < PAGE_SIZE;
    }
    return part;
  });
}

export default class SyncCustomers {
  async run(req: SwellWorkflowRequest, step: SwellWorkflowStep) {
    const data = (req.data || {}) as SwellData;
    // Only a run started from the dashboard carries a selection we can trust
    const action = req.workflow.trigger === "action" ? data.$action : undefined;
    const selection = (action?.source === "bulk" && action.selection?.query) || {};

    await step.do(
      "check the connection",
      { retries: { limit: 1, delay: "5 seconds" }, timeout: "30 seconds" },
      () => checkConnection(req.swell, req.appId),
    );

    let cursor: string | undefined;
    let sent = 0;
    let rejected = 0;

    for (let number = 1; ; number++) {
      const part = await step.do(
        `send customers, part ${number}`,
        { retries: { limit: 4, delay: "15 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        () => sendPart(req.swell, req.appId, selection, cursor),
      );
      sent += part.sent;
      rejected += part.rejected;
      cursor = part.cursor;
      if (part.done) {
        break;
      }
    }

    return { sent, rejected };
  }
}
