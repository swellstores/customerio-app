# Customer.io for Swell

A Swell integration app that keeps a Customer.io workspace supplied with a store's customers and with what they do: orders, shipments, abandoned carts and subscriptions. Data flows one way, from Swell to Customer.io, and the app only reads the store.

## Setup for a merchant

1. In Customer.io, open **Settings → API credentials → Track API keys** and copy the Site ID and API key.
2. In Swell, open the app, paste both values, save, and press **Test connection**. It confirms the workspace. The data center (US or EU) is found from the keys; there is nothing to choose.
3. Turn on **Send data to Customer.io**.
4. Optional: **Actions → Sync existing customers** sends the customers the store already has.
5. In Customer.io, build campaigns on the events below. If Customer.io sends your abandoned-cart or order emails, switch off the matching Swell notifications so customers do not get both.

The test and live environments of a store have separate settings.

Workspace settings the app relies on, both Customer.io defaults: people are identified by `id`, and "Reference people by" is "cio_id or id", so an email changed in Swell reaches the same person.

**A workspace that already has people.** The app identifies every person by their Swell account id.

- A person who is in the workspace with an email and no `id` (a newsletter signup, for example) receives the Swell id and becomes the same person. This is Customer.io's documented behaviour; it was not run in our tests.
- A person who is there with the same email and a different `id` (from another platform or an earlier integration) keeps the old id. Customer.io writes the Swell customer's attributes to that person and logs "Failed Attribute Change: id", and the customer's events go to a second person that has the Swell id and no email, so campaigns started by those events cannot send. Seen in the test workspace. Remove the old ids, or delete those people, before switching the app on.
- For the same reason, do not connect the test and the live environment of a store to one workspace: the same customer has a different id in each.

## What is sent

### People

A Swell account becomes a person whose `id` is the Swell account id. Guests are included.

| Attribute | From the Swell account |
| --- | --- |
| `email`, `first_name`, `last_name`, `name` | the same fields |
| `phone_number` | `phone` |
| `created_at` | `date_created` |
| `account_type`, `customer_group`, `locale`, `currency` | `type`, `group`, `locale`, `currency` |
| `country`, `state`, `city` | the default shipping address, else billing |
| `email_optin`, `sms_optin` | marketing consent, always `true` or `false` |
| `order_count`, `order_value` | number of orders and total spent |
| `first_order_at`, `last_order_at` | `date_first_order`, `date_last_order` |
| `cart_abandoned_count`, `last_cart_abandoned_at` | abandoned cart history |
| `account_balance` | `balance` |

Dates are Unix seconds, the format Customer.io needs for date conditions in segments. A field emptied in Swell removes the attribute in Customer.io.

**Phone numbers.** The number is sent as `phone_number`, not as Customer.io's `phone`. A default workspace treats `phone` as an identifier, and Swell does not keep phone numbers unique: two customers sharing a number would be written to the same person. To send SMS, set the message's "To" field to `{{customer.phone_number}}`.

**Subscription status.** `email_optin` is always sent as a plain attribute. Customer.io's own `unsubscribed` flag is written only when a customer's email consent changes in Swell: `true` when they opt out, `false` when they opt in. No other update touches it, so an unsubscribe made through a Customer.io message is never undone.

A customer who has never opted in therefore arrives as a subscribed person with `email_optin: false`: Customer.io treats everyone as subscribed until told otherwise. Add the condition "`email_optin` is true" to marketing campaigns and segments. Order and shipping messages do not need it.

### Events

Every event is sent together with its person, so a campaign never starts for someone Customer.io does not know yet.

| Swell event | Customer.io event | Notes |
| --- | --- | --- |
| `order.submitted` | Order Completed | Customer.io's name for "order placed" |
| `order.paid` | Order Paid | |
| `order.payment_failed` | Order Payment Failed | |
| `shipment.created` | Order Shipped | Carrier, tracking code and the shipped items |
| `order.delivered` | Order Fulfilled | Every item fulfilled |
| `order.refunded` | Order Refunded | Full refunds only: Swell has no event for a partial one |
| `order.canceled` | Order Cancelled | |
| `cart.abandoned` | Cart Abandoned | Carries `checkout_url`, the link back to the cart. Only carts with a customer |
| `subscription.activated` | Subscription Started | Also when a canceled subscription is restored |
| `subscription.paid` | Subscription Paid | Each paid billing cycle |
| `subscription.payment_failed` | Subscription Payment Failed | |
| `subscription.payment_expiring` | Subscription Payment Expiring | |
| `subscription.trial_will_end` | Subscription Trial Ending | |
| `subscription.paused`, `subscription.resumed` | Subscription Paused, Subscription Resumed | |
| `subscription.canceled` | Subscription Cancelled | |
| `subscription.completed` | Subscription Completed | Fixed-length plans |

Order events carry `order_id`, `order_number`, `status`, `currency`, `subtotal`, `discount`, `coupon`, `shipping`, `tax`, `total`, `item_count`, `paid`, `payment_method`, `shipping_method`, `shipping_address`, `subscription_id` for renewal orders, and `products`. Each product has `product_id`, `variant_id`, `sku`, `name`, `variant`, `slug`, `price`, `quantity`, `total` and `image_url`. Cart and subscription events follow the same naming; see `functions/lib/events.ts` for the full lists.

A renewal of a subscription produces both an Order Completed and a Subscription Paid event. Filter campaigns on `subscription_id` to tell renewals from first orders.

## How it behaves when something goes wrong

- **Repeated delivery.** Each event carries an id derived from the Swell event id, in the format Customer.io deduplicates on. A delivery that Swell repeats is ignored by Customer.io.
- **Customer.io unavailable** (timeout, rate limit, outage). Swell retries the delivery, for up to 48 hours. Events keep the time they happened.
- **Keys missing or refused.** The delivery is retried in the same way, and the store's administrators get one email per incident (Settings → Notifications → Credentials refused). Events from the last 48 hours arrive after the keys are corrected, each at its next retry. Swell spaces retries from a minute to 12 hours apart, so the last of them can arrive half a day later, with the time it happened.
- **Data refused by Customer.io.** The delivery is not retried. Customer.io's reason is in the delivery's response in the store's event log, and in `swell logs --type function --app customerio`.
- **Older than 48 hours.** A delivery that keeps failing is dropped after 48 hours. Customer.io does not start campaigns from events older than 72 hours, and Swell switches off a function that fails for about four days, which a merchant cannot undo. Dropping keeps the app running.
- **App switched off.** While "Send data to Customer.io" is off, Swell does not call the app's event functions at all. The buttons that send customers on request still work.

## Structure

| Path | Purpose |
| --- | --- |
| `swell.json` | Manifest: read-only scopes and the App Store listing. `read_products` is what puts SKU, slug and image on product lines; without it events still arrive, with names and prices only |
| `DESCRIPTION.md` | The listing's full description. The platform reads it from this file only |
| `settings/connection.json` | Keys, the on/off switch, Test connection and Sync existing customers. The data center field is read-only |
| `functions/sync-customer.ts` | `account.created`, `account.updated` → person |
| `functions/track-order.ts`, `track-shipment.ts`, `track-cart.ts`, `track-subscription.ts` | Store events → person + event |
| `functions/test-connection.ts` | Settings action: checks the keys, finds the data center |
| `functions/send-customer.ts` | Action on a customer's page: send this customer now |
| `functions/sync-customers.ts` | Workflow: all customers (settings action) or the selected ones (customer list) |
| `functions/lib/customerio.ts` | The only module that talks to Customer.io (Track API v2 batch) |
| `functions/lib/connection.ts` | Reads the keys and finds the workspace's data center |
| `functions/lib/people.ts`, `events.ts` | Swell record → Customer.io payload |
| `functions/lib/deliver.ts` | The retry and failure rules above |
| `functions/lib/ulid.ts` | Event id and timestamp from the Swell event id |
| `functions/lib/issues.ts`, `models/delivery-issues.json` | The record that exists while the keys are refused |
| `content/accounts.json` | "Send to Customer.io" on the customer page and list |
| `notifications/credentials-refused.*` | Email to administrators, sent when that record is created |
| `assets/` | Icon, cover and the listing gallery (`images/`), built by `../listing/build.mjs` |
| `test/unit/` | Unit tests; Customer.io and the store are stand-ins |

## Development

```bash
npm install
npm test
npm run typecheck
swell app push
```

Use `swell app push --force` after a change that touches only `functions/lib/`: push compares top-level files, so the functions that import the library would keep the old code.

To run an action without the dashboard, send the dashboard's request with the function's record id from `swell inspect functions app.customerio.<name>`:

```bash
swell api put '/:functions/<function id>' --body '{"$action":{"id":"test-connection","source":"field","settings":"connection"}}'
```

## Not included

- Deleting people. A customer deleted in Swell stays in Customer.io; delete the person there as well when a customer asks to be erased.
- Unsubscribes made in Customer.io flowing back to Swell's `email_optin`.
- Past orders as events. The person attributes carry order count, value and dates.
- Storefront activity such as page and product views. A storefront that adds Customer.io's JavaScript snippet should identify shoppers by their Swell account id, so both streams reach the same person.
