// Start the reference pipe's wire server (for --target and CI). Usage: tsx serve.ts [port]
import { startServer } from './src/server.js';
const port = Number(process.argv[2] ?? 8080);
const h = await startServer({ port });
console.log(`reference pipe listening on ${h.url}`);
process.on('SIGINT', async () => { await h.close(); process.exit(0); });
process.on('SIGTERM', async () => { await h.close(); process.exit(0); });
