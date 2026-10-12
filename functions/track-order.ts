import { deliver } from "./lib/deliver";
import { orderAttributes, trackEvent } from "./lib/events";
import { identify } from "./lib/people";
import type { SwellRecord } from "./lib/people";

export const config: SwellConfig = {
  description: "Send order events to Customer.io",
  model: {
    events: [
      "order.submitted",
      "order.paid",
      "order.payment_failed",
      "order.delivered",
      "order.refunded",
      "order.canceled",
    ],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  const event = req.data.$event!;

  return deliver(req, async () => {
    const order = (await req.swell.get(`/orders/${req.data.id}`, {
      expand: ["account", "items.product", "items.variant"],
    })) as SwellRecord | null;
    if (!order?.account?.id || order.draft) {
      return undefined;
    }
    return [identify(order.account), trackEvent(order.account.id, event, orderAttributes(order))];
  });
}
