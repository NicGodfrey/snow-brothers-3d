import { createPlane } from "./plane.ts";
import { startServer } from "./http/server.ts";
import type { QaMode } from "./types.ts";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const plane = createPlane();

  if (command === "serve") {
    const server = await startServer(plane);
    console.log(
      JSON.stringify({
        event: "listening",
        url: server.url,
        transport: plane.config.transport,
        hasApiKey: Boolean(plane.config.apiKey),
        dispatchable: plane.registry.dispatchable().length,
        maxInFlight: plane.config.maxInFlight,
        lucy: plane.lucy.health(),
        remote: !["127.0.0.1", "::1", "localhost"].includes(plane.config.bind),
      }),
    );
    return;
  }

  if (command === "status") {
    console.log(
      JSON.stringify(
        plane.registry.snapshot({
          transport: plane.config.transport,
          maxInFlight: plane.config.maxInFlight,
          inFlight: 0,
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (
    command === "ask" ||
    command === "fanout" ||
    command === "debate" ||
    command === "vote" ||
    command === "broadcast" ||
    command === "specialist"
  ) {
    const { question, n, target } = parseArgs(rest);
    const job = await plane.scheduler.submit({
      question,
      mode: command as QaMode,
      n,
      target,
    });
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  if (command === "provision") {
    const limit = Number(flag(rest, "--limit") ?? 101);
    const job = await plane.scheduler.provision(limit);
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  if (command === "lucy-pending") {
    console.log(JSON.stringify({ items: plane.lucy.pending() }, null, 2));
    return;
  }

  console.error(
    "Usage: cli.ts <serve|status|ask|fanout|debate|vote|broadcast|specialist|provision|lucy-pending> [question]",
  );
  process.exitCode = 1;
}

function parseArgs(args: string[]): {
  question: string;
  n?: number;
  target?: string;
} {
  const n = flag(args, "--n");
  const target = flag(args, "--target");
  const question = args.filter((a) => !a.startsWith("--") && a !== n && a !== target).join(" ");
  return {
    question,
    n: n ? Number(n) : undefined,
    target,
  };
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

await main();
