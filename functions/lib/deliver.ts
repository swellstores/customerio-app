/**
 * Shared delivery path of the event functions: read the settings, build the batch,
 * send it, and turn the outcome into what Swell should do with the delivery.
 *
 * Swell retries a failed delivery for days and switches a function off after about four days
 * of continuous failure. A merchant cannot switch it back on. So a delivery is retried only
 * while that can help, and never for longer than RETRY_WINDOW_MS.
 */

import { resolveConnection } from "./connection";
import type { Settings } from "./connection";
import { CustomerioError, sendBatch } from "./customerio";
import type { Operation, Rejection } from "./customerio";
import { recordCredentialsIssue } from "./issues";

// Customer.io does not start campaigns from events older than 72 hours,
// so there is little to gain from a later delivery
export const RETRY_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface Outcome {
  sent?: number;
  skipped?: string;
}

function tooOld(req: SwellRequest): boolean {
  const firstFailed = req.data.$event?.delivery?.date_first_failed;
  return Boolean(firstFailed) && Date.now() - new Date(firstFailed as string).getTime() > RETRY_WINDOW_MS;
}

/** What Customer.io said about the operations it refused, for the delivery log */
export function describeRejections(rejections: Rejection[], batch: Operation[]): string {
  return rejections
    .map((rejection) => {
      const operation = batch[rejection.batch_index ?? -1];
      const subject = operation?.action === "event" ? `the event "${operation.name}"` : "the customer profile";
      const reason = [rejection.field, rejection.reason, rejection.message].filter(Boolean).join(": ");
      return `Customer.io refused ${subject}${reason ? ` (${reason})` : ""}.`;
    })
    .join(" ");
}

/**
 * Runs one event delivery. `build` returns the operations to send, or nothing to skip the event.
 */
export async function deliver(
  req: SwellRequest,
  build: () => Promise<Operation[] | undefined> | Operation[] | undefined,
): Promise<Outcome> {
  const source = req.data.$event?.type || "event";
  const appId = req.appId as string;

  if (tooOld(req)) {
    throw new SwellError("Not delivered to Customer.io within 48 hours. Giving up on this event.", {
      status: 410,
      retry: false,
    });
  }

  // Swell only calls the function while the app is enabled, but the merchant
  // may have switched it off since the event was recorded
  const settings = (await req.swell.settings()) as Settings;
  if (settings?.connection?.enabled !== true) {
    return { skipped: "The app is not enabled" };
  }

  // Built before the keys are looked at: a record with nothing to send
  // is skipped even while the keys are refused, instead of failing and being retried
  const batch = await build();
  if (!batch?.length) {
    return { skipped: "Nothing to send for this record" };
  }

  try {
    const connection = await resolveConnection(req.swell, appId, settings);

    const rejections = await sendBatch(connection, batch);
    if (rejections.length > 0) {
      // Sending the same data again cannot help. The reason stays in the delivery log
      throw new SwellError(describeRejections(rejections, batch), { status: 422, retry: false });
    }
    return { sent: batch.length };
  } catch (err) {
    if (!(err instanceof CustomerioError)) {
      throw err;
    }
    if (err.kind === "credentials") {
      // Retried, so the events of the last 48 hours arrive once the merchant corrects the keys
      await recordCredentialsIssue(req.swell, err.message, source);
      throw new SwellError(err.message, { status: 401 });
    }
    if (err.kind === "rejected") {
      throw new SwellError(err.message, { status: 422, retry: false });
    }
    throw new SwellError(err.message, { status: 503 });
  }
}
