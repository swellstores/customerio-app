import { resolveConnection } from "./lib/connection";
import type { Settings } from "./lib/connection";
import { CustomerioError, hasCredentials, sendBatch } from "./lib/customerio";
import { identify } from "./lib/people";
import type { SwellRecord } from "./lib/people";

export const config: SwellConfig = {
  description: "Send one customer to Customer.io now, from the customer's page",
  action: true,
};

export default async function (req: SwellRequest) {
  const recordId = req.data.$action?.record_id ?? "";
  if (!/^[0-9a-f]{24}$/i.test(recordId)) {
    throw new SwellError("Unknown customer", { status: 400 });
  }

  const settings = (await req.swell.settings()) as Settings;
  if (!hasCredentials(settings?.connection)) {
    throw new SwellError("Connect Customer.io first: enter the Site ID and API key in the app settings.", {
      status: 400,
    });
  }

  const account = (await req.swell.get(`/accounts/${recordId}`)) as SwellRecord | null;
  if (!account?.id) {
    throw new SwellError("Unknown customer", { status: 404 });
  }

  try {
    const connection = await resolveConnection(req.swell, req.appId as string, settings);
    const [rejection] = await sendBatch(connection, [identify(account)]);
    if (rejection) {
      const reason = [rejection.field, rejection.reason, rejection.message].filter(Boolean).join(": ");
      throw new SwellError(`Customer.io refused this customer${reason ? ` (${reason})` : ""}.`, { status: 422 });
    }
  } catch (err) {
    if (!(err instanceof CustomerioError)) {
      throw err;
    }
    throw new SwellError(err.message, { status: err.kind === "unavailable" ? 502 : 400 });
  }

  return { message: `${account.name || account.email || "The customer"} was sent to Customer.io.` };
}
