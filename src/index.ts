import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = await loadConfig();
const app = await buildServer(config);

await app.listen({
  host: config.server.host,
  port: config.server.port
});
