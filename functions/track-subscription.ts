import { deliver } from "./lib/deliver";
import { subscriptionAttributes, trackEvent } from "./lib/events";
import { identify } from "./lib/people";
import type { SwellRecord } from "./lib/people";

export const config: SwellConfig = {
  description: "Send subscription events to Customer.io",
  model: {
    events: [
      "subscription.activated",
      "subscription.paid",
      "subscription.payment_failed",
      "subscription.payment_expiring",
      "subscription.trial_will_end",
      "subscription.paused",
      "subscription.resumed",
      "subscription.canceled",
      "subscription.completed",
    ],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  const event = req.data.$event!;

  return deliver(req, async () => {
    const subscription = (await req.swell.get(`/subscriptions/${req.data.id}`, {
      expand: ["account", "product", "variant"],
    })) as SwellRecord | null;
    if (!subscription?.account?.id || subscription.draft) {
      return undefined;
    }
    return [
      identify(subscription.account),
      trackEvent(subscription.account.id, event, subscriptionAttributes(subscription)),
    ];
  });
}
