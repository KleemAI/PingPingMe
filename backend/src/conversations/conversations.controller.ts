import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { ConversationsService } from "./conversations.service";

/** Customer & business inboxes. `kind=customer|business` selects the inbox. */
@Controller("conversations") @TeamOnly()
export class ConversationsController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: ConversationsService, private readonly query: QueryService) {}

  @Get()
  list(@Query("kind") kind?: string, @Query("status") status?: string, @Query("assigneeId") assigneeId?: string, @Query("q") q?: string) {
    return this.query.conversations({ kind, status, assigneeId, q });
  }

  @Get(":id")
  get(@Param("id") id: string) { return this.query.conversation(id); }

  @Get(":id/messages")
  async messages(@Param("id") id: string) { return (await this.query.conversation(id)).messages; }

  /** `{ audience: "customer" | "internal", text, attachments?: [fileId] }` */
  @Post(":id/messages") @HttpCode(200)
  async send(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.send(tx, { ...b, conversationId: id })) };
  }

  /** `{ status?, priority?, assigneeId?, labels? }` */
  @Patch(":id")
  async update(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, { ...b, id }));
    return { ok: true };
  }

  @Post(":id/read") @HttpCode(200)
  async read(@CurrentUser() u: User, @Param("id") id: string) {
    await this.uow.write(u, (tx) => this.svc.markRead(tx, { id }));
    return { ok: true };
  }
}

@Controller("messages") @TeamOnly()
export class MessagesController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: ConversationsService) {}

  /** Retry a failed outgoing message, optionally with corrected `text`. */
  @Post(":id/retry") @HttpCode(200)
  async retry(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.retry(tx, { ...b, messageId: id }));
    return { ok: true };
  }
}
