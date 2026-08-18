#!/usr/bin/env node
/**
 * List queue-mode lucy jobs waiting for a parent Task resume + token inject.
 * Task-spawned copies cannot use official createRun (legacy 400).
 */
const base = (process.env.AGI_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.env.AGI_CONTROL_TOKEN;
const headers = {};
if (token) headers.authorization = `Bearer ${token}`;

const res = await fetch(`${base}/v1/lucy/pending`, { headers });
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
if (!res.ok) process.exit(1);
