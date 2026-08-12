import { createServer, type Server } from "node:http";
import { createFinanceApp, type FinanceApp } from "./app.js";

export interface RunningServer {
  readonly server: Server;
  readonly app: FinanceApp;
  readonly port: number;
  close(): Promise<void>;
}

export function startServer(port = Number(process.env.PORT ?? 4106)): Promise<RunningServer> {
  const app = createFinanceApp();
  const server = createServer(app.router.nodeListener());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        app,
        port: boundPort,
        close: () =>
          new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

const isDirectRun = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isDirectRun) {
  startServer().then(({ port }) => {
    console.log(`finance-erp listening on :${port}`);
  }).catch((e) => {
    console.error("finance-erp failed to start", e);
    process.exit(1);
  });
}
