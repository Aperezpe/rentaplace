// Start one RentAPlace copy as an API-only server (no pages), on loopback.
// usage: RAP_DB=... RAP_LOG_DIR=... RAP_OUTBOX_DIR=... PORT=... node serve.mjs <appDir>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const appDir = resolve(process.argv[2]);
process.env.RAP_ROOT = appDir;
process.env.RAP_LOG_STDOUT = '0';
const load = (file) => import(pathToFileURL(resolve(appDir, file)).href);
const { createApp } = await load('src/server.ts');
const { bootstrap } = await load('src/bootstrap.ts');
const db = bootstrap();
const { server } = createApp(db);
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`listening ${process.env.PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); try { db.close(); } catch {} process.exit(0); });
