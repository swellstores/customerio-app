import { describe, it, expect } from "vitest";
import { byteSize, MAX_OPERATION_BYTES } from "../../functions/lib/customerio";
import {
  cartAttributes,
  EVENT_NAMES,
  orderAttributes,
  shipmentAttributes,
  subscriptionAttributes,
  trackEvent,
} from "../../functions/lib/events";
import { idTimestamp } from "../../functions/lib/ulid";
import { account, cart, order, shipment, subscription, swellEvent } from "../fixtures/records";

describe("orderAttributes", () => {
  it("maps totals to Customer.io's ecommerce property names", () => {
    expect(orderAttributes(order)).toMatchObject({
      order_id: order.id,
      order_number: "100036",
      status: "payment_pending",
      currency: "USD",
      subtotal: 57,
      discount: 5,
      coupon: "WELCOME",
      shipping: 4,
      tax: 0,
      total: 56,
      item_count: 3,
      paid: false,
      guest: true,
      payment_method: "card",
      shipping_method: "Standard",
      ordered_at: 1787746453,
    });
  });

  it("lists the products with variant details and images", () => {
    expect(orderAttributes(order).products).toEqual([
      {
        product_id: "6a70911f8a03a75bffa4c5ab",
        sku: "24-WG088",
        name: "Sprite Foam Roller",
        slug: "sprite-foam-roller",
        price: 19,
        quantity: 1,
        total: 19,
        image_url: "https://cdn.example.com/roller.jpg",
      },
      {
        product_id: "6a70911f8a03a75bffa4c5ac",
        variant_id: "6a70911f8a03a75bffa4c5ad",
        sku: "24-WG087-8",
        name: "Yoga Strap",
        variant: "8 foot",
        slug: "yoga-strap",
        price: 19,
        quantity: 2,
        total: 38,
        image_url: "https://cdn.example.com/strap-8.jpg",
      },
    ]);
  });

  it("includes the shipping address without empty parts", () => {
    expect(orderAttributes(order).shipping_address).toEqual({
      name: "Ada Lovelace",
      address1: "1 Market St",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "US",
    });
    expect(orderAttributes({ ...order, shipping: { price: null } })).not.toHaveProperty("shipping_address");
  });

  it("works when products were not expanded", () => {
    const bare = { ...order, items: [{ product_id: "p1", product_name: "Mug", quantity: 1, price: 5, price_total: 5 }] };
    expect(orderAttributes(bare).products).toEqual([
      { product_id: "p1", name: "Mug", price: 5, quantity: 1, total: 5 },
    ]);
  });
});

describe("cartAttributes", () => {
  it("carries the recovery link", () => {
    expect(cartAttributes(cart)).toMatchObject({
      cart_id: cart.id,
      checkout_url: cart.checkout_url,
      total: 19,
      abandoned_at: 1790958456,
    });
    expect(cartAttributes(cart).products).toHaveLength(1);
  });
});

describe("shipmentAttributes", () => {
  it("describes the shipped items from the order", () => {
    const attributes = shipmentAttributes(shipment, order);
    expect(attributes).toMatchObject({
      order_id: order.id,
      order_number: "100036",
      shipment_id: shipment.id,
      carrier: "UPS",
      service: "UPS Ground",
      tracking_code: "1Z999AA10123456784",
    });
    // Two were ordered, one is in this shipment
    expect(attributes.products).toEqual([
      {
        product_id: "6a70911f8a03a75bffa4c5ac",
        variant_id: "6a70911f8a03a75bffa4c5ad",
        sku: "24-WG087-8",
        name: "Yoga Strap",
        variant: "8 foot",
        slug: "yoga-strap",
        price: 19,
        quantity: 1,
        image_url: "https://cdn.example.com/strap-8.jpg",
      },
    ]);
  });
});

describe("subscriptionAttributes", () => {
  it("maps the plan, the amounts and the billing period", () => {
    expect(subscriptionAttributes(subscription)).toMatchObject({
      subscription_id: subscription.id,
      status: "active",
      plan_name: "Monthly",
      interval: "monthly",
      interval_count: 1,
      price: 15,
      recurring_total: 15,
      trial: false,
      period_start_at: 1790812800,
      period_end_at: 1793491200,
    });
    expect(subscriptionAttributes(subscription).products).toEqual([
      {
        product_id: "6a70911f8a03a75bffa4c5ab",
        sku: "COFFEE",
        name: "Coffee Club",
        slug: "coffee-club",
        price: 15,
        quantity: 1,
        total: 15,
      },
    ]);
  });
});

describe("trackEvent", () => {
  it("names the event and stamps it with the Swell event's id and time", () => {
    const event = swellEvent("order.submitted");
    const operation = trackEvent(account.id, event, { order_id: order.id });

    expect(operation).toMatchObject({
      type: "person",
      action: "event",
      identifiers: { id: account.id },
      name: "Order Completed",
      timestamp: idTimestamp(event.id),
      attributes: { order_id: order.id },
    });
    expect(operation.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(trackEvent(account.id, event, {}).id).toBe(operation.id);
  });

  it("has a name for every event the functions subscribe to", () => {
    expect(Object.keys(EVENT_NAMES)).toHaveLength(17);
    expect(() => trackEvent(account.id, swellEvent("order.unknown"), {})).toThrow();
  });

  it("never uses Customer.io's reserved event properties", () => {
    for (const attributes of [orderAttributes(order), cartAttributes(cart), subscriptionAttributes(subscription)]) {
      expect(attributes).not.toHaveProperty("recipient");
      expect(attributes).not.toHaveProperty("from_address");
      expect(attributes).not.toHaveProperty("reply_to");
    }
  });

  it("cuts a product list that would exceed Customer.io's size limit", () => {
    const items = Array.from({ length: 400 }, (_, index) => ({ ...order.items[1], id: `item-${index}` }));
    const operation = trackEvent(account.id, swellEvent("order.submitted"), orderAttributes({ ...order, items }));

    expect(byteSize(operation)).toBeLessThanOrEqual(MAX_OPERATION_BYTES);
    expect(operation.attributes.products_truncated).toBe(true);
    expect((operation.attributes.products as unknown[]).length).toBeGreaterThan(0);
    expect(operation.attributes.item_count).toBe(3);
  });
});
