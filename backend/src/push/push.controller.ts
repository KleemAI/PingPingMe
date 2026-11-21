import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentSession, CurrentUser } from "../auth/decorators";
import { PushService } from "./push.service";

/** The phone app registers its Expo push token here after sign-in. */
@Controller("push") @AllowCustomer()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post("register") @HttpCode(200)
  register(@CurrentUser() u: User, @CurrentSession() sid: string, @Body() b: { token?: string; platform?: string }) {
    return this.push.register(u, sid, b?.token, b?.platform);
  }

  @Post("unregister") @HttpCode(200)
  unregister(@CurrentUser() u: User, @Body() b: { token?: string }) { return this.push.unregister(u, b?.token); }
}
