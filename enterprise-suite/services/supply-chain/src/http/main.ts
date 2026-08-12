import { createSupplyChainModule } from "../infrastructure/module.js";
import { createSupplyChainServer } from "./server.js";

const port = Number(process.env.PORT ?? 4106);
const module_ = createSupplyChainModule();
const server = createSupplyChainServer(module_);

server.listen(port, () => {
  console.log(`[supply-chain] listening on :${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
