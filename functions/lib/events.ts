/**
 * Maps Swell records to Customer.io events.
 * Names and properties follow Customer.io's ecommerce naming where it has one,
 * so the data has the shape Customer.io documents for campaigns and templates.
 */

import { byteSize, MAX_OPERATION_BYTES } from "./customerio";
import type { Attributes, EventOperation } from "./customerio";
import { compact, unix } from "./people";
import type { SwellRecord } from "./people";
import { eventUlid, idTimestamp } from "./ulid";

/** Swell event → Customer.io event name */
export const EVENT_NAMES: Record<string, string> = {
  "order.submitted": "Order Completed",
  "order.paid": "Order Paid",
  "order.payment_failed": "Order Payment Failed",
  "order.delivered": "Order Fulfilled",
  "order.refunded": "Order Refunded",
  "order.canceled": "Order Cancelled",
  "shipment.created": "Order Shipped",
  "cart.abandoned": "Cart Abandoned",
  "subscription.activated": "Subscription Started",
  "subscription.paid": "Subscription Paid",
  "subscription.payment_failed": "Subscription Payment Failed",
  "subscription.payment_expiring": "Subscription Payment Expiring",
  "subscription.trial_will_end": "Subscription Trial Ending",
  "subscription.paused": "Subscription Paused",
  "subscription.resumed": "Subscription Resumed",
  "subscription.canceled": "Subscription Cancelled",
  "subscription.completed": "Subscription Completed",
};

function imageUrl(record: SwellRecord | null | undefined): string | undefined {
  return record?.images?.[0]?.file?.url || undefined;
}

/** A line item of an order, cart or subscription. Expects `product` and `variant` expanded when available */
export function productLine(item: SwellRecord): Attributes {
  const product = item.product || {};
  const variant = item.variant || {};

  return compact({
    product_id: item.product_id,
    variant_id: item.variant_id,
    sku: variant.sku || product.sku,
    name: item.product_name || product.name,
    variant: item.variant_name || variant.name,
    slug: product.slug,
    price: item.price,
    quantity: item.quantity,
    total: item.price_total,
    image_url: imageUrl(variant) || imageUrl(product),
  });
}

function address(value: SwellRecord | null | undefined): Attributes | undefined {
  if (!value?.address1 && !value?.city && !value?.country) {
    return undefined;
  }
  return compact({
    name: value.name,
    address1: value.address1,
    address2: value.address2,
    city: value.city,
    state: value.state,
    zip: value.zip,
    country: value.country,
    phone: value.phone,
  });
}

/** Totals shared by orders and carts */
function totals(record: SwellRecord): Attributes {
  return compact({
    currency: record.currency,
    subtotal: record.sub_total,
    discount: record.discount_total,
    coupon: record.coupon_code,
    shipping: record.shipment_total,
    tax: record.tax_total,
    total: record.grand_total,
    item_count: record.item_quantity,
  });
}

export function orderAttributes(order: SwellRecord): Attributes {
  return compact({
    order_id: order.id,
    order_number: order.number,
    status: order.status,
    ...totals(order),
    paid: order.paid === true,
    payment_total: order.payment_total,
    refund_total: order.refund_total,
    payment_method: order.billing?.method,
    guest: order.guest === true,
    subscription_id: order.subscription_id,
    shipping_method: order.shipping?.service_name,
    shipping_address: address(order.shipping),
    comments: order.comments,
    cancel_reason: order.cancel_reason,
    ordered_at: unix(order.date_created),
    products: (order.items || []).map(productLine),
  });
}

export function cartAttributes(cart: SwellRecord): Attributes {
  return compact({
    cart_id: cart.id,
    checkout_url: cart.checkout_url,
    ...totals(cart),
    abandoned_at: unix(cart.date_abandoned),
    products: (cart.items || []).map(productLine),
  });
}

/** Expects the shipment's order with `items.product` and `items.variant` expanded */
export function shipmentAttributes(shipment: SwellRecord, order: SwellRecord): Attributes {
  const orderItems = new Map<string, SwellRecord>((order.items || []).map((item: SwellRecord) => [item.id, item]));

  return compact({
    order_id: order.id,
    order_number: order.number,
    shipment_id: shipment.id,
    shipment_number: shipment.number,
    carrier: shipment.carrier_name || shipment.carrier,
    service: shipment.service_name || shipment.service,
    tracking_code: shipment.tracking_code,
    estimated_delivery_at: unix(shipment.date_estimated),
    currency: order.currency,
    shipping_address: address(shipment.destination) || address(order.shipping),
    products: (shipment.items || []).map((item: SwellRecord) =>
      productLine({ ...orderItems.get(item.order_item_id), ...item, price_total: undefined }),
    ),
  });
}

/** Expects `product` and `variant` expanded when available */
export function subscriptionAttributes(subscription: SwellRecord): Attributes {
  return compact({
    subscription_id: subscription.id,
    subscription_number: subscription.number,
    status: subscription.status,
    plan_name: subscription.plan_name,
    interval: subscription.interval,
    interval_count: subscription.interval_count,
    currency: subscription.currency,
    price: subscription.price,
    quantity: subscription.quantity,
    coupon: subscription.coupon_code,
    total: subscription.grand_total,
    recurring_total: subscription.recurring_total,
    trial: subscription.trial === true,
    trial_end_at: unix(subscription.date_trial_end),
    period_start_at: unix(subscription.date_period_start),
    period_end_at: unix(subscription.date_period_end),
    payment_expiring_at: unix(subscription.date_payment_expiring),
    payment_retry_at: unix(subscription.date_payment_retry),
    paused_at: unix(subscription.date_paused),
    pause_end_at: unix(subscription.date_pause_end),
    canceled_at: unix(subscription.date_canceled),
    cancel_at: unix(subscription.date_cancel_at),
    cancel_reason: subscription.cancel_reason,
    products: [productLine(subscription), ...(subscription.items || []).map(productLine)],
  });
}

/**
 * Builds the Customer.io event for a Swell event. The id and timestamp come from the Swell
 * event id: the id makes a repeated delivery harmless, and the timestamp is when the event
 * happened, not when it was delivered.
 */
export function trackEvent(
  accountId: string,
  swellEvent: { id?: string; type: string },
  attributes: Attributes,
): EventOperation {
  const name = EVENT_NAMES[swellEvent.type];
  if (!name) {
    throw new Error(`No Customer.io event is mapped to ${swellEvent.type}`);
  }

  const operation: EventOperation = {
    type: "person",
    action: "event",
    identifiers: { id: String(accountId) },
    name,
    attributes,
  };

  const id = eventUlid(swellEvent.id, name);
  if (id) {
    operation.id = id;
    operation.timestamp = idTimestamp(swellEvent.id);
  }
  return fitOperation(operation);
}

/**
 * Customer.io refuses an operation over 32 KB. A very long product list is cut
 * to fit, and the event says so, so the rest of the event still arrives.
 */
export function fitOperation(operation: EventOperation, maxBytes = MAX_OPERATION_BYTES): EventOperation {
  const products = operation.attributes.products;
  if (!Array.isArray(products) || byteSize(operation) <= maxBytes) {
    return operation;
  }

  const fitted: EventOperation = { ...operation, attributes: { ...operation.attributes, products_truncated: true } };
  let kept = products.length;
  do {
    kept = Math.floor(kept / 2);
    fitted.attributes.products = products.slice(0, kept);
  } while (kept > 0 && byteSize(fitted) > maxBytes);
  return fitted;
}
