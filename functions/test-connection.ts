import { isRegionCurrent, saveRegion } from "./lib/connection";
import type { Settings } from "./lib/connection";
import { CustomerioError, getWorkspace, hasCredentials } from "./lib/customerio";
import { resolveCredentialsIssue } from "./lib/issues";

export const config: SwellConfig = {
  description: "Check the saved Site ID and API key with Customer.io and find the workspace's data center",
  action: true,
};

const REGION_NAMES = { us: "United States", eu: "European Union" };

export default async function (req: SwellRequest) {
  const settings = (await req.swell.settings()) as Settings;
  const connection = settings?.connection || {};
  const enabled = connection.enabled === true;

  if (!hasCredentials(connection)) {
    throw new SwellError("Enter the Site ID and API key, save the settings, then test again.", { status: 400 });
  }

  let workspace;
  try {
    workspace = await getWorkspace(connection);
  } catch (err) {
    if (err instanceof CustomerioError && err.kind === "credentials") {
      throw new SwellError(
        "Customer.io did not accept the Site ID and API key. Copy both again from Account Settings → API Credentials → Track API keys in Customer.io.",
        { status: 400 },
      );
    }
    throw new SwellError(`${(err as Error).message} Try again in a minute.`, { status: 502 });
  }

  if (workspace.region !== connection.region || !isRegionCurrent(connection)) {
    await saveRegion(req.swell, req.appId as string, workspace.region, connection.site_id);
  }
  await resolveCredentialsIssue(req.swell);

  let message = `Connected to Customer.io workspace ${workspace.environment_id} in the ${REGION_NAMES[workspace.region]} data center.`;
  if (!enabled) {
    message += ' Turn on "Send data to Customer.io" to start.';
  }
  return { message };
}
