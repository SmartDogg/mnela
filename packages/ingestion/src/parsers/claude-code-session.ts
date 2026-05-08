import { type ParseContext, type ParsedDocument, type Parser } from '../parser.js';

interface SessionLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  message?: { role?: string; content?: string | { type?: string; text?: string }[] };
  parentUuid?: string;
  toolUse?: { name?: string; input?: unknown };
  toolResult?: { content?: unknown };
}

/**
 * Claude Code local session — `~/.claude/projects/<slug>/<sessionId>.jsonl`.
 * One JSON object per line; line types include 'user', 'assistant', 'tool_use',
 * 'tool_result', 'system', 'summary'. We render user/assistant messages as a
 * chronological transcript and skip noisy tool internals.
 */
export const claudeCodeSessionParser: Parser = {
  name: 'claude-code-session',
  canParse(): boolean {
    // Selected by registry after JSONL peek (first line is a JSON with sessionId).
    return false;
  },
  async parse(buf: Buffer, ctx: ParseContext): Promise<ParsedDocument[]> {
    const text = buf.toString('utf-8');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: SessionLine[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as SessionLine);
      } catch {
        // skip malformed lines
      }
    }
    if (parsed.length === 0) return [];

    const sessionId =
      parsed.find((l) => typeof l.sessionId === 'string')?.sessionId ?? stripExt(ctx.filename);

    const transcript: string[] = [];
    let messageCount = 0;
    for (const line of parsed) {
      if (line.type !== 'user' && line.type !== 'assistant') continue;
      const role = line.message?.role ?? line.type;
      const body = renderMessageContent(line.message?.content);
      if (!body) continue;
      const ts = line.timestamp ? ` · ${line.timestamp}` : '';
      transcript.push(`## ${role}${ts}`);
      transcript.push('');
      transcript.push(body);
      transcript.push('');
      messageCount += 1;
    }

    if (messageCount === 0) return [];

    return [
      {
        source: 'manual_upload',
        sourceId: sessionId,
        title: `claude-code-session ${sessionId.slice(0, 8)}`,
        rawText: transcript.join('\n').trim(),
        type: 'chat',
        metadata: {
          originalFilename: ctx.filename,
          sessionId,
          messageCount,
          rawLineCount: parsed.length,
        },
      },
    ];
  },
};

type MessageContent = NonNullable<NonNullable<SessionLine['message']>['content']>;

function renderMessageContent(content: MessageContent | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && 'text' in block) {
          const text = (block as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter((t) => t.length > 0)
      .join('\n\n')
      .trim();
  }
  return '';
}

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
