/**
 * One file may produce many ParsedDocuments — e.g. a ChatGPT export ZIP
 * yields one document per conversation.
 */
export interface ParsedDocument {
  source: ParsedSource;
  sourceId?: string;
  title: string;
  rawText: string;
  language?: 'ru' | 'en' | 'mixed' | null;
  type?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Files referenced by this document (export attachments, embedded images, etc).
   * The worker is responsible for moving them to the attachments dir and creating
   * Attachment rows.
   */
  attachments?: ParsedAttachment[];
}

export type ParsedSource =
  | 'chatgpt_export'
  | 'claude_export'
  | 'obsidian_vault'
  | 'manual_upload'
  | 'api_ingest'
  | 'telegram'
  | 'voice_note'
  | 'email'
  | 'web_clip';

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  /** Absolute path to a temp file the worker should move into place. */
  tempPath: string;
  size: number;
  metadata?: Record<string, unknown>;
}

export interface ParseContext {
  /** Original mime reported by the upload / chokidar. */
  mimeType: string;
  /** Lowercase file extension including the dot, or '' for none. */
  extension: string;
  /** The raw filename (no path). */
  filename: string;
  /** Source flavor inferred by the registry ('manual_upload' default). */
  origin: ParsedSource;
  /** Working directory for parsers that need to extract temp files. */
  workdir: string;
}

export interface Parser {
  readonly name: string;
  canParse(ctx: ParseContext): boolean;
  parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]>;
}
