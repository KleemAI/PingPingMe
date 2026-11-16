import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/**
 * Outbound channel adapter.
 * Today: a simulated provider. To go live, implement `deliver` with the official WhatsApp Business
 * Platform (Cloud API) — POST /{phone-number-id}/messages with the access token from an env var.
 * Credentials stay on the server.
 *
 * Test hook: any text containing "[fail]" fails, so failed-send + retry can be demonstrated.
 */
@Injectable()
export class ChannelProvider {
  readonly simulated = true;

  async deliver(channel: string, to: string, text: string): Promise<{ externalId: string }> {
    void to;
    if (text.includes("[fail]")) throw new Error(`${channel} provider rejected the message (simulated)`);
    return { externalId: `sim.${randomUUID()}` };
  }
}
