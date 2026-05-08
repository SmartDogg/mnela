import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 over file contents (binary or text).
 * Used as the dedup key for Document.contentHash and Attachment.contentHash.
 */
export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Hash that includes a logical sub-key (e.g. ChatGPT conversation_id) on top
 * of the file hash, so a single export ZIP yielding many conversations
 * deduplicates per-conversation, not per-archive.
 */
export function namespaceHash(fileHash: string, subKey: string): string {
  return createHash('sha256').update(fileHash).update('').update(subKey).digest('hex');
}
