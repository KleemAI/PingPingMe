import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import { CurrentUser } from "../auth/decorators";
import { ActionsService } from "./actions.service";
import { StateService } from "./state.service";

@Controller()
export class StateController {
  constructor(private readonly state: StateService, private readonly actions: ActionsService) {}

  /** Everything the signed-in user may see. `?v=<version>` → `{ unchanged: true }` when nothing changed (cheap poll). */
  @Get("state")
  async get(@CurrentUser() u: User, @Query("v") v?: string) {
    const version = await this.state.version();
    if (v && Number(v) === version) return { unchanged: true, version };
    const state = await this.state.forUser(u);
    return { version: state.scope === "team" ? state.db.version : state.version, state };
  }

  /** `{ type, payload }` — see GET /actions for the commands your role may run. */
  @Post("actions") @HttpCode(200)
  async act(@CurrentUser() u: User, @Body() body: { type?: string; payload?: Record<string, unknown> }) {
    const result = await this.actions.run(u, String(body?.type ?? ""), body?.payload ?? {});
    return { ok: true, result };
  }

  @Get("actions")
  catalog(@CurrentUser() u: User) {
    return { actions: this.actions.catalog(u) };
  }
}
