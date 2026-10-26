import { createGameServer } from './game.ts';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3001);
const origins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean);
const game = createGameServer({ port, origins, socialPath: process.env.SOCIAL_STORE_PATH || fileURLToPath(new URL('./data/social.json', import.meta.url)) });
game.http.on('listening', () => console.log(`BROWSERSTRIKE authoritative server | :${port} | 64Hz / 20Hz snapshots | /ws /social`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void game.close().then(() => process.exit(0)); });