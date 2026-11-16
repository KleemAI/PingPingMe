import { Global, Module } from "@nestjs/common";
import { ChannelProvider } from "./channel.provider";
import { InboundService } from "./inbound.service";
import { OutboxService } from "./outbox.service";
import { WebhooksController } from "./webhooks.controller";

@Global()
@Module({
  controllers: [WebhooksController],
  providers: [ChannelProvider, InboundService, OutboxService],
  exports: [ChannelProvider, InboundService, OutboxService],
})
export class ChannelModule {}
