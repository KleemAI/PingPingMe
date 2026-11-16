/**
 * Command-line helper (after `npm run build`):
 *   npm run seed -- admin <email> <password> "<Full name>"   → create the first admin on an empty production database
 */
import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { env } from "../../config/env";
import { newId } from "../../common/util";
import { hashPassword } from "../../auth/password";
import { ENTITIES, UserEntity } from "../entities";

async function main() {
  config();
  const [cmd, email, password, ...name] = process.argv.slice(2);
  if (cmd !== "admin" || !email || !password || password.length < 6) {
    console.log('Usage: npm run seed -- admin <email> <password(6+ chars)> "<Full name>"');
    process.exit(1);
  }
  const ds = new DataSource({ type: "postgres", url: env.databaseUrl, ssl: env.dbSsl ? true : false, entities: ENTITIES, synchronize: env.dbSync });
  await ds.initialize();
  const repo = ds.getRepository(UserEntity);
  const existing = await repo.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    existing.passwordHash = await hashPassword(password);
    existing.role = "admin";
    existing.active = true;
    await repo.save(existing);
    console.log(`Updated ${email}: admin, password reset.`);
  } else {
    await repo.insert({ id: newId("u"), name: name.join(" ") || "Admin", email: email.toLowerCase(), role: "admin", active: true, passwordHash: await hashPassword(password) });
    console.log(`Created admin ${email}.`);
  }
  await ds.destroy();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
