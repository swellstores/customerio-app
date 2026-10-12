import { deliver } from "./lib/deliver";
import { shipmentAttributes, trackEvent } from "./lib/events";
import { identify } from "./lib/people";
import type { SwellRecord } from "./lib/people";

export const config: SwellConfig = {
  description: "Send the Order Shipped event to Customer.io",
  model: {
    events: ["shipment.created"],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  const shipment = req.data;
  const event = req.data.$event!;

  return deliver(req, async () => {
    if (!shipment.order_id || shipment.draft || shipment.canceled) {
      return undefined;
    }
    const order = (await req.swell.get(`/orders/${shipment.order_id}`, {
      expand: ["account", "items.product", "items.variant"],
    })) as SwellRecord | null;
    if (!order?.account?.id) {
      return undefined;
    }
    return [identify(order.account), trackEvent(order.account.id, event, shipmentAttributes(shipment, order))];
  });
}
