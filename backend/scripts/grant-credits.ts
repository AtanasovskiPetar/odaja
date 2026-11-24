// Give an account credits for Odaja's AI by hand (early supporters, support).
//   bun run credits:grant <email> <credits> [note]
// Uses DATABASE_URL and the AI settings in the environment (.env).
import { eq } from "drizzle-orm";
import { aiConfigFrom, MILLI } from "../ai/config";
import { createCredits } from "../ai/credits";
import { createDb } from "../db/index";
import { user } from "../db/schema";

const [email, amount, ...note] = process.argv.slice(2);
const credits = Number(amount);
if (!email || !Number.isFinite(credits) || credits === 0) {
  console.error("Usage: bun run credits:grant <email> <credits> [note]");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL ?? "postgres://odaja:odaja_dev_password@localhost:5432/odaja");
const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
if (!account) {
  console.error(`No account with the email ${email}.`);
  process.exit(1);
}
const balance = await createCredits(db, aiConfigFrom(process.env, { emailConfigured: false })).grant(account.id, credits, "grant", note.length ? { note: note.join(" ") } : undefined);
console.log(`${email}: ${credits > 0 ? "+" : ""}${credits} credits, balance ${balance / MILLI}.`);
process.exit(0);
