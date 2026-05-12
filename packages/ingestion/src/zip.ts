import { open as yauzlOpen, fromBuffer as zipFromBuffer, type Entry, type ZipFile } from 'yauzl';

export interface ZipEntry {
  fileName: string;
  size: number;
  read(): Promise<Buffer>;
  /**
   * Stream the entry to a writable file path without buffering into RAM.
   * Required for binary attachments inside multi-GB exports (DALL-E PNGs,
   * Claude file attachments) — `read()` would buffer the entire entry.
   */
  streamTo(destPath: string): Promise<void>;
}

/**
 * Buffer-based ZIP reader (small archives only — loads everything via yauzl
 * `fromBuffer`). Kept for unit tests and for the dispatcher's tiny head-buffer
 * detection path. Prefer `readZipEntriesFromFile` for real uploads.
 */
export async function readZipEntries(buf: Buffer): Promise<ZipEntry[]> {
  const zipfile = await openFromBuffer(buf);
  return collectEntries(zipfile);
}

/**
 * Path-based ZIP reader: opens the archive via yauzl with a file descriptor,
 * never loads the full archive into memory. The 1.4 GB ChatGPT exports go
 * through this path — the in-memory buffer reader would OOM the process.
 */
export async function readZipEntriesFromFile(path: string): Promise<ZipEntry[]> {
  const zipfile = await openFromPath(path);
  return collectEntries(zipfile);
}

function collectEntries(zipfile: ZipFile): Promise<ZipEntry[]> {
  return new Promise<ZipEntry[]>((resolve, reject) => {
    const entries: ZipEntry[] = [];
    zipfile.on('entry', (entry: Entry) => {
      if (entry.fileName.endsWith('/')) {
        zipfile.readEntry();
        return;
      }
      entries.push({
        fileName: entry.fileName,
        size: entry.uncompressedSize,
        read: () => readEntryToBuffer(zipfile, entry),
        streamTo: (destPath) => streamEntryToFile(zipfile, entry, destPath),
      });
      zipfile.readEntry();
    });
    zipfile.once('end', () => resolve(entries));
    zipfile.once('error', reject);
    zipfile.readEntry();
  });
}

function openFromBuffer(buf: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    zipFromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('failed to open zip'));
      resolve(zipfile);
    });
  });
}

function openFromPath(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzlOpen(path, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error(`failed to open zip at ${path}`));
      resolve(zipfile);
    });
  });
}

function readEntryToBuffer(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('failed to open entry stream'));
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.once('end', () => resolve(Buffer.concat(chunks)));
      stream.once('error', reject);
    });
  });
}

async function streamEntryToFile(zipfile: ZipFile, entry: Entry, destPath: string): Promise<void> {
  const { createWriteStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('failed to open entry stream'));
      const out = createWriteStream(destPath);
      stream.once('error', reject);
      out.once('error', reject);
      out.once('finish', () => resolve());
      stream.pipe(out);
    });
  });
}
