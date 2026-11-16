import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { env } from "../config/env";
import { pgConnection } from "./resolve-host";
import { ChangeBus } from "./change-bus";
import { ENTITIES } from "./entities";
import { SeedService } from "./seed/seed.service";
import { UnitOfWork } from "./unit-of-work.service";

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
          extra: { max: 10, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 },
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
