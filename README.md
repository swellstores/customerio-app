# Customer.io for Swell

A Swell integration app that keeps a Customer.io workspace supplied with a store's customers and with what they do: orders, shipments, abandoned carts and subscriptions. Data flows one way, from Swell to Customer.io, and the app only reads the store.

## Setup

### What you need from Customer.io

A Customer.io account and the workspace's Track API keys: **Account Settings → API Credentials → Track API keys**, Site ID and API key.

The app relies on two workspace settings, both Customer.io defaults: people are identified by `id`, and "Reference people by" is "cio_id or id", so an email changed in Swell reaches the same person.

### Install and connect

1. Install the app and open it under **Apps** in the Swell dashboard.
2. Paste the Site ID and API key, save, and press **Test connection**. It confirms the workspace. The data center (US or EU) is found from the keys; there is nothing to choose.
3. Turn on **Send data to Customer.io**.
4. Optional: **Actions → Sync existing customers** sends the customers the store already has.
5. In Customer.io, build campaigns on the events below. If Customer.io sends your abandoned-cart or order emails, switch off the matching Swell notifications so customers do not get both.

The test and live environments of a store have separate settings.

### Settings

| Setting | What it does |
| --- | --- |
| Site ID, API key | The workspace's Track API keys |
| Data center | Read-only. Found from the keys on first use, and again when the Site ID changes |
| Test connection | Checks the saved keys with Customer.io. Save the settings first |
| Send data to Customer.io | Off after install. While it is off, Swell does not call the app's event functions, and what happens in the store meanwhile is not sent later |
| Actions → Sync existing customers | Sends every customer of the store, see [Dashboard actions](#dashboard-actions) |

### A workspace that already has people

The app identifies every person by their Swell account id.

- A person who is in the workspace with an email and no `id` (a newsletter signup, for example) receives the Swell id and becomes the same person. This is Customer.io's documented behaviour; it was not run in our tests.
- A person who is there with the same email and a different `id` (from another platform or an earlier integration) keeps the old id. Customer.io writes the Swell customer's attributes to that person and logs "Failed Attribute Change: id", and the customer's events go to a second person that has the Swell id and no email, so campaigns started by those events cannot send. Seen in the test workspace. Remove the old ids, or delete those people, before switching the app on.
- For the same reason, do not connect the test and the live environment of a store to one workspace: the same customer has a different id in each.

## Features

### People

A Swell account becomes a person whose `id` is the Swell account id. Guests are included. Implemented by `functions/sync-customer.ts` on `account.created` and `account.updated`.

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

Every event is sent together with its person, so a campaign never starts for someone Customer.io does not know yet. Implemented by `functions/track-order.ts`, `track-shipment.ts`, `track-cart.ts` and `track-subscription.ts`.

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
| `subscription.payment_expiring` | Subscription Payment Expiring | Swell does not raise this event today, so it never arrives |
| `subscription.trial_will_end` | Subscription Trial Ending | |
| `subscription.paused`, `subscription.resumed` | Subscription Paused, Subscription Resumed | |
| `subscription.canceled` | Subscription Cancelled | |
| `subscription.completed` | Subscription Completed | Fixed-length plans |

Order events carry `order_id`, `order_number`, `status`, `currency`, `subtotal`, `discount`, `coupon`, `shipping`, `tax`, `total`, `item_count`, `paid`, `payment_method`, `shipping_method`, `shipping_address`, `subscription_id` for renewal orders, and `products`. Each product has `product_id`, `variant_id`, `sku`, `name`, `variant`, `slug`, `price`, `quantity`, `total` and `image_url`. Cart and subscription events follow the same naming; see `functions/lib/events.ts` for the full lists.

A renewal of a subscription produces both an Order Completed and a Subscription Paid event. Filter campaigns on `subscription_id` to tell renewals from first orders.

### Dashboard actions

These send on request. They work whether **Send data to Customer.io** is on or off, they update people who are already in the workspace and never duplicate them, and they do not change anyone's subscription status.

| Action | Where | What it does | Implemented by |
| --- | --- | --- | --- |
| Test connection | The app's settings | Checks the saved keys and finds the data center. A successful test also closes an open "keys refused" incident | `functions/test-connection.ts` |
| Send to Customer.io | A customer's page | Sends this customer's current details now | `functions/send-customer.ts` |
| Send to Customer.io | The customer list, on selected rows | Sends the selected customers | `functions/sync-customers.ts` |
| Sync existing customers | The app's settings, Actions menu | Sends every customer of the store | `functions/sync-customers.ts` |

The last two run as a workflow, in steps of up to 1,000 customers, so a large store does not run into a time limit: a store of 32,000 customers took 77 seconds. With wrong keys the run fails in about 12 seconds, before any customer is read.

### When something goes wrong

- **Repeated delivery.** Each event carries an id derived from the Swell event id, in the format Customer.io deduplicates on. A delivery that Swell repeats is ignored by Customer.io.
- **Customer.io unavailable** (timeout, rate limit, outage). Swell retries the delivery, for up to 48 hours. Events keep the time they happened.
- **Keys missing or refused.** The delivery is retried in the same way, and the store's administrators get one email per incident (Settings → Notifications → Credentials refused). Events from the last 48 hours arrive after the keys are corrected, each at its next retry. Swell spaces retries from a minute to 12 hours apart, so the last of them can arrive half a day later, with the time it happened.
- **Data refused by Customer.io.** The delivery is not retried. Customer.io's reason is in the delivery's response in the store's event log, and in `swell logs --type function --app customerio`.
- **Older than 48 hours.** A delivery that keeps failing is dropped after 48 hours. Customer.io does not start campaigns from events older than 72 hours, and Swell switches off a function that fails for about four days, which a merchant cannot undo. Dropping keeps the app running.

## Day-to-day use

Once the app is switched on there is nothing to do in Swell.

- **To see what arrived**, open **Profile activity** in Customer.io, or a person's **Activity** tab. An event opens to the data it carries.
- **If the "Customer.io is not receiving data" email arrives**, correct the Site ID and API key in the app's settings, save, and press **Test connection**. The events of the last 48 hours follow on their own.
- **If a customer is missing or out of date in Customer.io**, for example after an import or after the app was switched off for a while, use **Send to Customer.io** on the customer's page or on selected rows of the customer list.
- **To pause**, switch off **Send data to Customer.io**. The keys stay saved.

## Limits and known issues

- **One way only.** Nothing comes back from Customer.io: an unsubscribe made there does not change `email_optin` in Swell.
- **Deleted customers stay.** A customer deleted in Swell remains in Customer.io; delete the person there as well when a customer asks to be erased.
- **No history of orders.** Past orders are not sent as events. The person's attributes carry order count, value and dates.
- **No storefront activity** such as page and product views. A storefront that adds Customer.io's JavaScript snippet should identify shoppers by their Swell account id, so both streams reach the same person.
- **Partial refunds and anonymous carts are not sent**: Swell has no event for a partial refund, and a cart without a customer has nobody to attach to.
- **Very large orders.** Customer.io accepts 32 KB per event. A product list that does not fit is shortened, and the event carries `products_truncated: true`.
- **Not instant.** Events are sent by Swell's event functions and usually arrive within seconds. Customer.io's Track API allows about 1,000 requests a second, far more than a store produces.
- **Existing people with other ids** are split in two, see [A workspace that already has people](#a-workspace-that-already-has-people).

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

### Structure

| Path | Purpose |
| --- | --- |
| `swell.json` | Manifest: read-only scopes and the listing's short description and images. `read_products` is what puts SKU, slug and image on product lines; without it events still arrive, with names and prices only |
| `settings/connection.json` | Keys, the on/off switch, Test connection and Sync existing customers |
| `functions/sync-customer.ts` | `account.created`, `account.updated` → person |
| `functions/track-order.ts`, `track-shipment.ts`, `track-cart.ts`, `track-subscription.ts` | Store events → person + event |
| `functions/test-connection.ts`, `send-customer.ts` | The settings and customer-page actions |
| `functions/sync-customers.ts` | Workflow: all customers, or the ones selected in the customer list |
| `functions/lib/customerio.ts` | The only module that talks to Customer.io (Track API v2 batch) |
| `functions/lib/connection.ts` | Reads the keys and finds the workspace's data center |
| `functions/lib/people.ts`, `events.ts` | Swell record → Customer.io payload |
| `functions/lib/deliver.ts` | The retry and failure rules above |
| `functions/lib/ulid.ts` | Event id and timestamp from the Swell event id |
| `functions/lib/issues.ts`, `models/delivery-issues.json` | The record that exists while the keys are refused |
| `content/accounts.json` | "Send to Customer.io" on the customer page and list |
| `notifications/credentials-refused.*` | Email to administrators, sent when that record is created |
| `test/unit/` | Unit tests; Customer.io and the store are stand-ins |

### App Store listing

| What | Where |
| --- | --- |
| Full description | `DESCRIPTION.md` |
| Short description | `description` in `swell.json` (up to 70 characters) |
| Icon and cover | `assets/icon.png`, `assets/image.png` |
| Screenshots | `assets/images/*.png` (3200 × 1800), listed in `images` in `swell.json` |

## License

[MIT](LICENSE.md)
