import { pathToFileURL } from "node:url";
export * from "./src/index.ts";
import { startServer } from "./src/http.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
