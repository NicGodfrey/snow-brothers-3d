import { seedDemoTenant } from "./fixtures/seed.js";
import { createIdentityModule } from "./infrastructure/container.js";
import { Pbkdf2PasswordHasher } from "./infrastructure/crypto/hashing.js";
import { createIdentityServer } from "./http/server.js";

const port = Number(process.env.PORT ?? 8087);
const seed = process.env.SEED_DEMO !== "false";

// The demo seed activates six users, so a production-strength KDF would make startup
// needlessly slow; the real default applies to anything not seeded here.
const module = createIdentityModule({
  passwordHasher: new Pbkdf2PasswordHasher(seed ? 10_000 : undefined),
});

if (seed) {
  const refs = seedDemoTenant(module);
  process.stdout.write(
    `identity-access: seeded tenant ${refs.tenantId} with ${module.repositories.users.count(refs.tenantId)} users, ` +
      `${module.repositories.roles.count(refs.tenantId)} roles, ` +
      `${module.repositories.bindings.count(refs.tenantId)} role bindings\n`,
  );
}

createIdentityServer(module).listen(port, () => {
  process.stdout.write(`identity-access listening on http://127.0.0.1:${port}\n`);
});
