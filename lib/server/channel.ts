import "server-only";
import crypto from "node:crypto";
import type { Channel } from "../types";

/**
 * Outbound channel adapter.
 * MVP = simulated provider. To go live, replace `deliver` with the official
 * WhatsApp Business Platform (Cloud API) call — keep the access token in env vars
 * on the server, never in the browser.
 *
 * Test hook: any text containing "[fail]" fails, so failed-send + retry can be demoed.
 */
export async function deliver(channel: Channel, to: string, text: string): Promise<{ externalId: string }> {
  if (text.includes("[fail]")) throw new Error(`${channel} provider rejected the message (simulated)`);
  void to;
  return { externalId: `sim.${crypto.randomUUID()}` };
}
