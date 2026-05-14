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
  | 'web_clip'
  // 'chat' and 'daily' are written by AskService.promoteToDocument (ADR-0050)
  // and the legacy DailyNote migration — they never reach a parser. Listed
  // here so ingestion code typed against the Prisma DocumentSource enum
  // assigns cleanly without a cast.
  | 'chat'
  | 'daily';

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
  /**
   * Absolute path to the input on disk. Set whenever the input was streamed
   * to disk (every real upload after the streaming rewrite). Parsers that
   * deal with multi-GB ZIPs (chatgpt/claude) MUST use this for entry reads
   * instead of the `buf` parameter; the buffer is then a small head sample
   * for magic-byte / format detection only.
   */
  inputPath?: string;
  /**
   * Optional streaming sink — when set, parsers may emit each
   * `ParsedDocument` through it instead of (or in addition to) accumulating
   * them into the array they return. The worker uses this to persist
   * documents incrementally for huge imports (OpenAI account-wide export
   * has 700+ chats + 350 images that, taken as one giant docs[], blow past
   * Node's heap on low-RAM dev boxes). Parsers that don't support
   * streaming simply ignore this field.
   */
  onDocument?: (doc: ParsedDocument) => Promise<void> | void;
}

export interface Parser {
  readonly name: string;
  canParse(ctx: ParseContext): boolean;
  parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]>;
}
