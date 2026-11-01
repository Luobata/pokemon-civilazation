#!/usr/bin/env node
import { resolve } from 'node:path';
import { createNodeServer } from './server.ts';

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const directory = process.env.POKEMON_SAVE_DIR ? resolve(process.env.POKEMON_SAVE_DIR) : null;
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node server/main.ts [port]');
  process.exit(1);
}
const server = createNodeServer({ persistenceDirectory: directory });
server.listen(port, '127.0.0.1', () => {
  console.log(`Pokémon multiplayer server listening on http://127.0.0.1:${port}`);
  if (directory) console.log(`Persistence: ${directory}`);
});
