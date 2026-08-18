#!/usr/bin/env node
/**
 * Official API smoke. Reads CURSOR_API_KEY from the environment.
 * Never prints the key.
 */
const key = process.env.CURSOR_API_KEY;
if (!key) {
  console.error("CURSOR_API_KEY missing");
  process.exit(2);
}

const base = (process.env.CURSOR_API_BASE || "https://api.cursor.com").replace(/\/$/, "");
const headers = {
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
};

const models = await fetch(`${base}/v1/models`, { headers });
const agents = await fetch(`${base}/v1/agents?limit=20`, { headers });
const lucy = await fetch(
  `${base}/v1/agents/bc-9a1ae0da-1b80-5fe3-985e-94bc5ea1f3eb`,
  { headers },
);

const summary = {
  modelsStatus: models.status,
  agentsStatus: agents.status,
  lucyStatus: lucy.status,
  modelsOk: models.ok,
  agentsOk: agents.ok,
  lucyVisibleToOfficialApi: lucy.ok,
};
console.log(JSON.stringify(summary, null, 2));
if (!models.ok && !agents.ok) process.exit(1);
