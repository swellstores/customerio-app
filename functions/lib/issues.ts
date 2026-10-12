/**
 * The credentials issue: a record in the app's own collection that exists while Customer.io
 * refuses the keys. Creating it sends the store's administrators an email (see notifications/),
 * which is the reason it is a record and not a log line.
 */

const KEY = "credentials";

// The same problem seen again after a quiet day is a new incident: it gets a new record,
// which sends a new email
const SAME_INCIDENT_MS = 24 * 60 * 60 * 1000;

/** The part of the store client that functions and workflows share */
export interface StoreClient {
  settings(): Promise<unknown>;
  get(path: string, data?: any): Promise<unknown>;
  post(path: string, data?: any): Promise<unknown>;
  put(path: string, data?: any): Promise<unknown>;
  delete(path: string, data?: any): Promise<unknown>;
}

async function findIssue(swell: StoreClient): Promise<Record<string, any> | undefined> {
  const found = (await swell.get("/delivery-issues", { where: { key: KEY }, limit: 1 })) as {
    results?: Record<string, any>[];
  };
  return found?.results?.[0];
}

/**
 * Called when the keys are missing or refused. `source` is the store event or app action
 * that met the problem. Never throws: failing to record a problem must not hide the problem itself.
 */
export async function recordCredentialsIssue(swell: StoreClient, message: string, source: string): Promise<void> {
  try {
    const now = new Date();
    const existing = await findIssue(swell);

    if (existing) {
      const lastSeen = new Date(existing.date_last_seen || existing.date_created).getTime();
      if (now.getTime() - lastSeen < SAME_INCIDENT_MS) {
        await swell.put(`/delivery-issues/${existing.id}`, {
          message,
          source,
          count: (existing.count || 1) + 1,
          date_last_seen: now.toISOString(),
        });
        return;
      }
      await swell.delete(`/delivery-issues/${existing.id}`);
    }

    // The id of the settings record is the app's record id, which is what the dashboard
    // address of the app's page is built from. The email links to that page
    const settings = (await swell.settings()) as { id?: string } | null;
    await swell.post("/delivery-issues", {
      key: KEY,
      message,
      source,
      count: 1,
      date_last_seen: now.toISOString(),
      app_id: settings?.id,
    });
  } catch (err) {
    console.error("Unable to record the credentials issue", (err as Error).message);
  }
}

/** Called when Customer.io accepts the keys again */
export async function resolveCredentialsIssue(swell: StoreClient): Promise<void> {
  try {
    const existing = await findIssue(swell);
    if (existing) {
      await swell.delete(`/delivery-issues/${existing.id}`);
    }
  } catch (err) {
    console.error("Unable to resolve the credentials issue", (err as Error).message);
  }
}
