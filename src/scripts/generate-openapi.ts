import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../bootstrap/create-app.js';
import { buildOpenApiDocument } from '../bootstrap/swagger.js';

/**
 * Writes openapi.json without starting a server. CI runs this and fails if the
 * committed file differs, so the contract can never drift from the code — and the
 * frontends generate their clients from this exact file.
 *
 * It lives under src/ (not scripts/) because Nest DI needs `emitDecoratorMetadata`,
 * which only tsc emits — esbuild-based runners like tsx silently drop it and every
 * injected dependency arrives as undefined.
 */

// Deliberately not calling app.init(): the spec must be generatable from source
// alone, so CI (and a laptop with no database running) can check it for drift.
const app = await createApp();
const document = buildOpenApiDocument(app);

const target = resolve(process.cwd(), 'openapi.json');
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

await app.close();
console.log(`openapi.json written (${Object.keys(document.paths).length} paths)`);
