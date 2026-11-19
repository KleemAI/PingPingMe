import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { EmailVerification } from "./email-verification.service";
import { Mailer } from "../mail/mailer.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => ({ secret: env.jwtSecret, signOptions: { expiresIn: env.jwtExpiresIn as never } }) })],
  controllers: [AuthController],
  providers: [AuthService, EmailVerification, Mailer, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService, Mailer],
})
export class AuthModule {}
