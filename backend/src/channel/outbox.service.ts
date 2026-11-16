import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LessThan } from "typeorm";
import { SYSTEM_USER } from "../common/system-user";
import { ContactEntity, ConversationEntity, MessageEntity } from "../database/entities";
import { UnitOfWork } from "../database/unit-of-work.service";
import { ChannelProvider } from "./channel.provider";
import { InboundService } from "./inbound.service";

/**
 * Background delivery of outgoing customer messages.
 * Messages are written as `queued` inside the business transaction; after commit they are handed to the
 * provider and marked `sent` or `failed` (visible in the inbox, with safe manual retry).
 * A sweeper re-sends anything left `queued` (e.g. after a restart).
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Outbox");
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();

  constructor(private readonly uow: UnitOfWork, private readonly provider: ChannelProvider, private readonly inbound: InboundService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.sweep().catch((e) => this.log.warn(e.message)), 30_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(messageIds: string[]) {
    for (const id of messageIds) await this.deliverOne(id);
  }

  private async deliverOne(id: string) {
    if (this.inFlight.has(id)) return;
    this.inFlight.add(id);
    try {
      const em = this.uow.manager;
      const m = await em.findOne(MessageEntity, { where: { id } });
      if (!m || m.status !== "queued" || !m.conversationId) return;
      const conv = await em.findOne(ConversationEntity, { where: { id: m.conversationId } });
      const contact = conv && (await em.findOne(ContactEntity, { where: { id: conv.contactId } }));
      if (!conv || !contact) return;
      try {
        const { externalId } = await this.provider.deliver(conv.channel, contact.phone, m.text);
        await this.uow.write(SYSTEM_USER, async ({ em }) => {
          await em.update(MessageEntity, { id, status: "queued" }, { status: "sent", externalId, error: null });
        });
        if (this.provider.simulated) {
          // Simulated provider receipt — goes through the same idempotent intake as a real webhook.
          setTimeout(() => {
            this.uow
              .write(SYSTEM_USER, ({ em }) => this.inbound.ingest(em, { eventId: `st.${externalId}.delivered`, type: "status", externalId, status: "delivered" }))
              .catch(() => undefined);
          }, 1500);
        }
      } catch (e) {
        await this.uow.write(SYSTEM_USER, async ({ em }) => {
          await em.update(MessageEntity, { id, status: "queued" }, { status: "failed", error: (e as Error).message.slice(0, 500) });
        });
      }
    } finally {
      this.inFlight.delete(id);
    }
  }

  private async sweep() {
    const stuck = await this.uow.manager.find(MessageEntity, {
      where: { status: "queued", audience: "customer", createdAt: LessThan(Date.now() - 30_000) as never },
      select: { id: true },
      take: 50,
    });
    if (stuck.length) await this.dispatch(stuck.map((m) => m.id));
  }
}
