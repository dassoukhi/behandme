// Development tool: Clerk session tokens for the end-to-end test accounts, so that a test can call the
// gateway as each of them (the app's scripts/e2e). Finds or creates one user per role in the Clerk
// *development* instance (test e-mails, never real people), opens a session for each and mints a token
// valid for `--minutes`. Writes { role: { userId, token } } to the given file; prints no secret.
//
// Usage: node scripts/e2e-sessions.mjs <output.json> [--minutes 20]
import { createClerkClient } from "@clerk/backend";
import { readFileSync, writeFileSync } from "node:fs";

const ROLES = ["owner", "accessor", "v1", "v2", "v3"];
const NAMES = {
  owner: ["Olivia", "Test"],
  accessor: ["Adam", "Test"],
  v1: ["Victor", "Un"],
  v2: ["Valentine", "Deux"],
  v3: ["Vincent", "Trois"],
};

const [output, flag, value] = process.argv.slice(2);
if (!output) {
  console.error("Usage: node scripts/e2e-sessions.mjs <output.json> [--minutes 20]");
  process.exit(2);
}
const minutes = flag === "--minutes" ? Number(value) : 20;

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const secretKey = env.CLERK_SECRET_KEY;
if (!secretKey?.startsWith("sk_test_")) {
  console.error("Refused: CLERK_SECRET_KEY must be a development key (sk_test_…).");
  process.exit(1);
}
const clerk = createClerkClient({ secretKey });

const sessions = {};
for (const role of ROLES) {
  const email = `behindme-e2e-${role}+clerk_test@example.com`;
  const found = await clerk.users.getUserList({ emailAddress: [email] });
  const user =
    found.data[0] ??
    (await clerk.users.createUser({
      emailAddress: [email],
      firstName: NAMES[role][0],
      lastName: NAMES[role][1],
      skipPasswordRequirement: true,
    }));
  const session = await clerk.sessions.createSession({ userId: user.id });
  const { jwt } = await clerk.sessions.getToken(session.id, undefined, minutes * 60);
  sessions[role] = { userId: user.id, token: jwt };
  console.log(`${role}: ${user.id} (${email})`);
}
writeFileSync(output, JSON.stringify(sessions, null, 2));
console.log(`Tokens valid ${minutes} minutes, written to ${output}`);
