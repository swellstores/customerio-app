import { deliver } from "./lib/deliver";
import { hasSyncedChange, identify, identifyChange } from "./lib/people";

export const config: SwellConfig = {
  description: "Keep the Customer.io person up to date when a customer is created or changed",
  model: {
    events: ["account.created", "account.updated"],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  const account = req.data;
  const event = req.data.$event;
  const updated = event?.type === "account.updated";

  // Swell records an update for every login; only changes to fields we send are worth a request.
  // Decided before anything else, so these updates cost nothing and never fail while the keys are refused
  if (!account.id || (updated && !hasSyncedChange(event?.data))) {
    return { skipped: "Nothing to send for this record" };
  }

  return deliver(req, () => [updated ? identifyChange(account, event?.data) : identify(account)]);
}
