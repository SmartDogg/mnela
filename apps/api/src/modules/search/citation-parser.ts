/**
 * Streaming parser for inline `<cite doc-id="<cuid>">snippet</cite>` tags
 * (ADR-0040). Designed for token-delta streams where a tag may span chunks.
 * The parser tracks a single state across feed() calls; emit visible-text
 * deltas (with tags stripped and replaced by `[N]` markers) and citations
 * (when a tag closes) via the provided callbacks.
 *
 * Validation:
 *  - `doc-id` must match cuid syntax `c[a-z0-9]{24,}` — else the tag and its
 *    contents are dropped from output and the parser records a `dropped` count
 *    on the returned summary.
 *  - Snippet trimmed to non-empty; empty snippet drops the tag.
 *  - Nested cites: the inner `<cite ` opener is rendered literally (its
 *    text plus an attempt at the rest), the outer tag still emits a citation.
 *  - Truncated tag at end-of-stream: dropped silently (logged by caller).
 */

const CUID_RE = /^c[a-z0-9]{24,}$/;
const SNIPPET_MAX_OUT = 200;

type State = 'text' | 'maybe-tag' | 'opening' | 'attrs' | 'inner' | 'closing';

export interface CitationOut {
  ord: number;
  docId: string;
  snippet: string;
}

export interface ParserCallbacks {
  /** Visible text delta with cite tags stripped + `[N]` markers inserted. */
  onText(delta: string): void;
  /** Emitted when a valid `<cite>` closes. */
  onCitation(c: CitationOut): void;
}

export interface ParserSummary {
  emitted: number;
  dropped: number;
}

export class CitationParser {
  private state: State = 'text';
  private buf = '';
  private attrBuf = '';
  private innerBuf = '';
  private closingBuf = '';
  private currentDocId: string | null = null;
  private nextOrd = 1;
  private dropped = 0;
  private emitted = 0;

  constructor(private readonly cb: ParserCallbacks) {}

  feed(chunk: string): void {
    for (const ch of chunk) this.consume(ch);
    if (this.state === 'text' && this.buf.length > 0) {
      this.cb.onText(this.buf);
      this.buf = '';
    }
  }

  /**
   * Flush any pending buffered visible text. Tags still open at end-of-stream
   * are dropped (counted as dropped).
   */
  end(): ParserSummary {
    if (this.state === 'text' && this.buf.length > 0) {
      this.cb.onText(this.buf);
      this.buf = '';
    } else if (this.state !== 'text') {
      // Tag was open at EOS — discard partial content. `<` already swallowed.
      this.dropped++;
    }
    return { emitted: this.emitted, dropped: this.dropped };
  }

  private consume(c: string): void {
    switch (this.state) {
      case 'text': {
        if (c === '<') {
          if (this.buf.length > 0) {
            this.cb.onText(this.buf);
            this.buf = '';
          }
          this.state = 'maybe-tag';
          this.attrBuf = '';
        } else {
          this.buf += c;
          // Cap unflushed visible-text buffer at 1KB to keep memory bounded.
          if (this.buf.length >= 1024) {
            this.cb.onText(this.buf);
            this.buf = '';
          }
        }
        break;
      }
      case 'maybe-tag': {
        this.attrBuf += c;
        // We're looking for the literal prefix `cite` (then space or `>`).
        if ('cite'.startsWith(this.attrBuf.toLowerCase())) {
          if (this.attrBuf.length === 4) {
            // Matched 'cite' exactly. Next char decides.
            this.state = 'opening';
          }
        } else {
          // Not a cite tag — flush as literal text.
          this.cb.onText('<' + this.attrBuf);
          this.attrBuf = '';
          this.state = 'text';
        }
        break;
      }
      case 'opening': {
        if (c === ' ' || c === '\t' || c === '\n') {
          this.state = 'attrs';
          this.attrBuf = '';
        } else if (c === '>') {
          // `<cite>` with no doc-id — drop.
          this.dropped++;
          this.state = 'inner';
          this.innerBuf = '';
          this.currentDocId = null;
        } else {
          // Not really a cite tag (e.g. `<citepart>`); roll back.
          this.cb.onText('<cite' + c);
          this.state = 'text';
        }
        break;
      }
      case 'attrs': {
        if (c === '>') {
          this.currentDocId = extractDocId(this.attrBuf);
          this.state = 'inner';
          this.innerBuf = '';
        } else {
          this.attrBuf += c;
          // Defend against unclosed tags eating memory.
          if (this.attrBuf.length > 512) {
            this.cb.onText('<cite ' + this.attrBuf);
            this.attrBuf = '';
            this.state = 'text';
          }
        }
        break;
      }
      case 'inner': {
        if (c === '<') {
          this.state = 'closing';
          this.closingBuf = '';
        } else {
          this.innerBuf += c;
          if (this.innerBuf.length > 1024) {
            // Treat as malformed: emit the literal partial as text and drop.
            this.cb.onText('<cite>' + this.innerBuf);
            this.innerBuf = '';
            this.dropped++;
            this.state = 'text';
          }
        }
        break;
      }
      case 'closing': {
        this.closingBuf += c;
        // Looking for `/cite>` after the `<`.
        if ('/cite>'.startsWith(this.closingBuf.toLowerCase())) {
          if (this.closingBuf.length === 6) {
            // Tag closed.
            this.commitCitation();
            this.state = 'text';
          }
        } else {
          // Not a closing tag — treat the inner < as literal, keep collecting.
          this.innerBuf += '<' + this.closingBuf;
          this.closingBuf = '';
          this.state = 'inner';
        }
        break;
      }
    }
  }

  private commitCitation(): void {
    const snippet = this.innerBuf.trim();
    this.innerBuf = '';
    if (!this.currentDocId || !CUID_RE.test(this.currentDocId) || snippet.length === 0) {
      this.dropped++;
      this.currentDocId = null;
      return;
    }
    const ord = this.nextOrd++;
    const truncated =
      snippet.length > SNIPPET_MAX_OUT ? snippet.slice(0, SNIPPET_MAX_OUT - 1) + '…' : snippet;
    // Marker placed at the citation point; flush any pending text first.
    if (this.buf.length > 0) {
      this.cb.onText(this.buf);
      this.buf = '';
    }
    this.cb.onText(`[${ord}]`);
    this.cb.onCitation({ ord, docId: this.currentDocId, snippet: truncated });
    this.emitted++;
    this.currentDocId = null;
  }
}

function extractDocId(attrs: string): string | null {
  // Accepts `doc-id="cmd123..."` or `doc-id='cmd123...'` with arbitrary
  // surrounding whitespace and other attributes.
  const m = /(?:^|\s)doc-id\s*=\s*("([^"]+)"|'([^']+)')/i.exec(attrs);
  if (!m) return null;
  return (m[2] ?? m[3] ?? '').trim();
}
