import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { env } from "../config/env";
import { pgConnection } from "./resolve-host";
import { ChangeBus } from "./change-bus";
import { ENTITIES } from "./entities";
import { SeedService } from "./seed/seed.service";
import { UnitOfWork } from "./unit-of-work.service";
import { retryDroppedConnections } from "./connection-retry";

retryDroppedConnections();

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        if (!env.databaseUrl) throw new Error("DATABASE_URL is missing — copy .env.example to .env and paste your Neon connection string.");
        return {
          type: "postgres" as const,
          ...(await pgConnection(env.databaseUrl, env.dbSsl)),
          entities: ENTITIES,
          synchronize: env.dbSync,
          // Neon (and its pooler) closes connections that sit idle, so don't keep them long:
          // close idle ones after 10 s, recycle every connection after 4 minutes, and send TCP keep-alives.
          extra: { max: 10, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000, maxLifetimeSeconds: 240, keepAlive: true, keepAliveInitialDelayMillis: 10_000 },
          retryAttempts: 5,
          retryDelay: 2000,
        };
      },
    }),
  ],
  providers: [ChangeBus, UnitOfWork, SeedService],
  exports: [ChangeBus, UnitOfWork, SeedService],
})
export class DatabaseModule {}
