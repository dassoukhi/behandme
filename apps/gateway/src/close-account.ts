/**
 * Closes an account on request, as DELETE /users/me does for its owner: for heirs (article 85 of the loi Informatique
 * et Libertés) or for someone who lost access to the app, once support has checked who asks (the help page says what
 * heirs send: a death certificate and proof that they are heirs). Run where the gateway's environment is, after a
 * build: without --confirm it only says what closing would do, which support tells the heirs first.
 *   npm run account:close -- <user id or e-mail> [--confirm]
 * user.deleted goes to the outbox in the same transaction as the profile's deletion; the running gateway relays it
 * to handover and the notifier, which revoke the envelopes and forget the notifications.
 */
process.env.NODE_ENV ??= "production";
// No relay or consumer here: the running gateway sends what this writes to the outbox.
process.env.MESSAGING_ENABLED = "false";

const [target, ...flags] = process.argv.slice(2);
if (!target || flags.some((flag) => flag !== "--confirm")) {
  console.error(
    "Usage: npm run account:close -- <user id or e-mail> [--confirm]",
  );
  process.exit(2);
}
const confirm = flags.includes("--confirm");

// Imported after the env: ConfigModule validates it when app.module is evaluated.
const { NestFactory } = await import("@nestjs/core");
const { AppModule } = await import("./app.module.js");
const { ProfileService } =
  await import("./users/application/profile.service.js");
const { closureSummary, describeClosure } =
  await import("./users/application/account-closure.js");
const { HANDOVER_CLIENT } =
  await import("./handover/application/handover-client.js");

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ["error", "warn"],
});
let status = 0;
try {
  const profiles = app.get(ProfileService);
  const profile = await profiles.findAccount(target);
  if (!profile) {
    if (target.includes("@")) {
      console.error(`No account uses ${target}.`);
      status = 1;
    } else if (!confirm) {
      // A deletion interrupted after the profile went: only the Clerk account may be left.
      console.log(
        `No profile for ${target}. With --confirm, only its Clerk account, if any, is deleted.`,
      );
    } else {
      await profiles.closeAccount(target);
      console.log(
        `${target}: no profile; its Clerk account is deleted if it was left.`,
      );
    }
  } else {
    const records = await app.get(HANDOVER_CLIENT).list(profile.id);
    for (const line of describeClosure(profile, closureSummary(records)))
      console.log(line);
    if (confirm) {
      await profiles.closeAccount(profile.id);
      console.log(`${profile.id}: closed.`);
    } else {
      console.log(
        "Nothing was changed. Tell the heirs what closing does, then run again with --confirm.",
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  status = 1;
} finally {
  await app.close();
}
process.exit(status);
