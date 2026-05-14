import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { diskStorage } from 'multer';

import { backupsDir } from '../../../env.js';

/**
 * Multer disk storage for /admin/backups/upload. Streams the .tar.gz
 * straight into a `.incoming/` subdir of the backups volume; the
 * upload controller renames into place (and re-validates filename)
 * only after the upload completes. 50 GiB transport ceiling matches
 * the imports ceiling — backups can be huge.
 */
export const BACKUP_UPLOAD_RAW_CEILING_BYTES = 50 * 1024 * 1024 * 1024;

const dir = backupsDir();
const incomingDir = path.join(dir, '.incoming');
mkdirSync(incomingDir, { recursive: true });

export const backupUploadStorage = diskStorage({
  destination: incomingDir,
  filename: (_req, file, cb) => {
    // Preserve the user-provided name (sanitised) so the final rename
    // can use it; collisions get a random suffix.
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload.tar.gz';
    cb(null, `${crypto.randomUUID()}-${safe}`);
  },
});
