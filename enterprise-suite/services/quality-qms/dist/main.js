/**
 * Standalone bootstrap: `npm start` (or node --import tsx src/main.ts).
 */
import { createQualityQmsServer } from "./http/server.js";
import { createQualityQmsModule } from "./infrastructure/module.js";
const port = Number(process.env.PORT ?? 3010);
const module_ = createQualityQmsModule();
const server = createQualityQmsServer(module_);
server.listen(port, () => {
    console.log(`quality-qms listening on :${port}`);
});
//# sourceMappingURL=main.js.map