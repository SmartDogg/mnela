import crypto from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import path from 'node:path';

import { diskStorage } from 'multer';

import { loadEnv, resolvedDataDir } from '../../env.js';

/**
 * 50 GiB raw upper bound at the Multer transport layer. The real configurable
 * limit lives in SystemConfig (`imports.maxBytes`, default 5 GiB) and is
 * enforced inside ImportsService — see ADR-0048. This number exists only so a
 * runaway client cannot stream petabytes of data into our incoming dir before
 * we get a chance to reject it.
 */
export const MULTER_RAW_CEILING_BYTES = 50 * 1024 * 1024 * 1024;

const env = loadEnv();
const incomingDir = path.resolve(resolvedDataDir(env), 'uploads', '.incoming');
mkdirSync(incomingDir, { recursive: true });

/**
 * Multer disk storage for the uploads pipeline. We stream directly to
 * `<dataDir>/uploads/.incoming/<uuid>-<safe-name>` so a 1.4 GB ChatGPT export
 * never sits in heap. ImportsService renames the file out of `.incoming/`
 * into `uploads/<batchId>-<name>` once the size + hash checks pass.
 */
export const incomingUploadStorage = diskStorage({
  destination: incomingDir,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
    cb(null, `${crypto.randomUUID()}-${safe}`);
  },
});

/**
 * Stream a sha256 over the file at `filePath` without buffering it. Backs the
 * post-Multer hash step in ImportsService / DocumentsService.
 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.once('end', () => resolve(hash.digest('hex')));
    stream.once('error', reject);
  });
}
