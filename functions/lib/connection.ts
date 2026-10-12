/**
 * The merchant's connection settings.
 *
 * Customer.io has a US and an EU data center. Either one accepts any workspace's keys and
 * passes the data on, so a wrong choice never fails: it only routes a European workspace's
 * data through the United States, or the reverse. The merchant therefore never chooses.
 * The app asks Customer.io which data center the keys belong to, remembers the answer in
 * its settings, and asks again when the Site ID changes.
 */

import { CustomerioError, getWorkspace, hasCredentials } from "./customerio";
import type { Connection, Region } from "./customerio";
import type { StoreClient } from "./issues";

export interface Settings {
  connection?: {
    enabled?: boolean;
    site_id?: string;
    api_key?: string;
    region?: Region | null;
    /** The Site ID that `region` was found for. Not shown in the settings form */
    region_site_id?: string | null;
  };
}

/** True when the saved data center was found for the keys that are saved now */
export function isRegionCurrent(saved: NonNullable<Settings["connection"]>): boolean {
  return (saved.region === "us" || saved.region === "eu") && saved.region_site_id === saved.site_id?.trim();
}

export async function saveRegion(swell: StoreClient, appId: string, region: Region, siteId: string): Promise<void> {
  try {
    await swell.put(`/settings/${appId}`, { connection: { region, region_site_id: siteId.trim() } });
  } catch (err) {
    // Not fatal: the region is found again on the next request
    console.error("Unable to save the Customer.io data center", (err as Error).message);
  }
}

/**
 * The connection to send through, from the app's settings. Throws a credentials failure
 * when the keys are missing or refused.
 */
export async function resolveConnection(swell: StoreClient, appId: string, settings: Settings): Promise<Connection> {
  const saved = settings?.connection || {};
  if (!hasCredentials(saved)) {
    throw new CustomerioError("credentials", 401, "The Site ID or API key is missing in the app settings.");
  }

  let region = saved.region as Region;
  if (!isRegionCurrent(saved)) {
    region = (await getWorkspace(saved)).region;
    await saveRegion(swell, appId, region, saved.site_id);
  }
  return { site_id: saved.site_id, api_key: saved.api_key, region };
}
