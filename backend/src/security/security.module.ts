import { Global, Module } from "@nestjs/common";
import { RateLimiter } from "./rate-limiter.service";

/** Rate limits, login locks and upload allowances — shared by every module. */
@Global()
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class SecurityModule {}
