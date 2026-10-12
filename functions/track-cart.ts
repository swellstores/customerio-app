import { deliver } from "./lib/deliver";
import { cartAttributes, trackEvent } from "./lib/events";
import { identify } from "./lib/people";
import type { SwellRecord } from "./lib/people";

export const config: SwellConfig = {
  description: "Send the Cart Abandoned event to Customer.io",
  model: {
    events: ["cart.abandoned"],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  const event = req.data.$event!;

  return deliver(req, async () => {
    // A cart without an account has no email, so there is nobody to message
    if (!req.data.account_id) {
      return undefined;
    }
    const cart = (await req.swell.get(`/carts/${req.data.id}`, {
      expand: ["account", "items.product", "items.variant"],
    })) as SwellRecord | null;
    // The shopper may have come back or ordered by the time a delayed delivery runs
    if (!cart?.account?.id || cart.status !== "abandoned" || cart.order_id) {
      return undefined;
    }
    return [identify(cart.account), trackEvent(cart.account.id, event, cartAttributes(cart))];
  });
}
