import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { DmService } from "./dm.service";

/** Personal chat (end-to-end encrypted) for every signed-in user. */
@Controller("dm") @AllowCustomer()
export class DmController {
  constructor(private readonly dm: DmService) {}

  /** `{ me, conversations }` */
  @Get() list(@CurrentUser() u: User) { return this.dm.list(u); }
  @Get("me") me(@CurrentUser() u: User) { return this.dm.me(u); }
  /** `{ username }` */
  @Put("username") username(@CurrentUser() u: User, @Body() b: { username?: string }) { return this.dm.setUsername(u, b?.username); }
  /** `{ publicKey, backup: { salt, nonce, box, … } }` */
  @Put("keys") keys(@CurrentUser() u: User, @Body() b: { publicKey?: string; backup?: unknown }) { return this.dm.setKeys(u, b); }
  @Get("keys/backup") backup(@CurrentUser() u: User) { return this.dm.backup(u); }
  /** `?q=ravi` → people whose username starts with it */
  @Get("users") search(@CurrentUser() u: User, @Query("q") q?: string) { return this.dm.search(u, q); }
  @Get("users/:id") person(@CurrentUser() u: User, @Param("id") id: string) { return this.dm.person(u, id); }
  @Get(":id/messages") messages(@CurrentUser() u: User, @Param("id") id: string, @Query("before") before?: string) { return this.dm.messages(u, id, before); }
  /** `{ to | conversationId, box, nonce, senderKey, recipientKey, fileIds? }` */
  @Post("send") @HttpCode(200) send(@CurrentUser() u: User, @Body() b: Record<string, unknown>) { return this.dm.send(u, b ?? {}); }
  @Post(":id/read") @HttpCode(200) read(@CurrentUser() u: User, @Param("id") id: string) { return this.dm.read(u, id); }
  /** `{ userId, blocked }` */
  @Post("block") @HttpCode(200) block(@CurrentUser() u: User, @Body() b: { userId?: string; blocked?: boolean }) { return this.dm.block(u, String(b?.userId ?? ""), b?.blocked !== false); }
}
