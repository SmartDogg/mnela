import { fromBuffer as zipFromBuffer, type Entry, type ZipFile } from 'yauzl';

export interface ZipEntry {
  fileName: string;
  size: number;
  read(): Promise<Buffer>;
}

/**
 * Streaming-ish ZIP reader: opens the archive, yields entry handles whose
 * `read()` decompresses a single entry into a Buffer on demand. yauzl is
 * preferred over adm-zip for huge ChatGPT/Claude exports (multi-GB archives
 * with single 100MB+ JSON files) because it avoids buffering everything.
 */
export async function readZipEntries(buf: Buffer): Promise<ZipEntry[]> {
  const zipfile = await openZip(buf);
  const out: Pick<Entry, 'fileName' | 'uncompressedSize'>[] = [];
  return new Promise<ZipEntry[]>((resolve, reject) => {
    const entries: ZipEntry[] = [];
    zipfile.on('entry', (entry: Entry) => {
      if (entry.fileName.endsWith('/')) {
        zipfile.readEntry();
        return;
      }
      out.push({ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize });
      entries.push({
        fileName: entry.fileName,
        size: entry.uncompressedSize,
        read: () => readEntry(zipfile, entry),
      });
      zipfile.readEntry();
    });
    zipfile.once('end', () => resolve(entries));
    zipfile.once('error', reject);
    zipfile.readEntry();
  });
}

function openZip(buf: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    zipFromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('failed to open zip'));
      resolve(zipfile);
    });
  });
}

function readEntry(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
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
