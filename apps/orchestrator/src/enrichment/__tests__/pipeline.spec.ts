import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publishEventMock = vi.fn();
const peekSlotMock = vi.fn().mockResolvedValue(null);
const recordCompletionMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@mnela/queue', () => ({
  publishEvent: publishEventMock,
  peekSlot: peekSlotMock,
  recordEnrichmentCompletion: recordCompletionMock,
}));

const { EnrichmentPipeline } = await import('../pipeline.js');

interface FakeProviderResult {
  text?: string;
  final?: { type: 'done' } | { type: 'error'; reason: string; message?: string; resetAt?: Date };
}

function makeCliProvider(result: FakeProviderResult = {}): {
  config: { id: string; kind: 'claude_cli'; name: string; model: string };
  supportsTools: true;
  supportsVision: true;
  stream: () => AsyncGenerator<never>;
  test: () => Promise<{ ok: true; latencyMs: number }>;
  run: (args: { prompt: string }) => Promise<{
    text: string;
    final: { type: 'done' } | { type: 'error'; reason: string; message?: string; resetAt?: Date };
  }>;
} {
  return {
    config: {
      id: 'builtin:claude-cli',
      kind: 'claude_cli',
      name: 'Claude Code (built-in)',
      model: '',
    },
    supportsTools: true,
    supportsVision: true,
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<never> {
      // unused — tests drive the fake provider via .run()
      return;
    },
    async test() {
      return { ok: true, latencyMs: 1 };
    },
    async run() {
      return {
        text: result.text ?? '',
        final: result.final ?? { type: 'done' as const },
      };
    },
  };
}

beforeEach(() => {
  publishEventMock.mockReset();
  process.env['DATABASE_URL'] ||= 'postgres://x:x@127.0.0.1:5432/mnela';
  process.env['REDIS_URL'] ||= 'redis://127.0.0.1:6379';
});

afterEach(() => {
  vi.clearAllMocks();
});

interface PipelineDeps {
  documents?: { update: (...args: unknown[]) => Promise<unknown> };
  redis?: unknown;
  claudeStatus?: {
    get: (...args: unknown[]) => Promise<unknown>;
    set: (...args: unknown[]) => Promise<unknown>;
  };
  rateLimit?: {
    isPaused: (...args: unknown[]) => Promise<unknown>;
    pause: (...args: unknown[]) => Promise<unknown>;
  };
  providerResult?: FakeProviderResult;
}

function makePipeline(overrides: PipelineDeps = {}) {
  const documents = overrides.documents ?? {
    update: vi.fn(async () => ({})),
  };
  const redis = overrides.redis ?? { client: {} };
  const claudeStatus = overrides.claudeStatus ?? {
    get: vi.fn(async () => ({ available: true, checkedAt: new Date().toISOString() })),
    set: vi.fn(async () => undefined),
  };
  const rateLimit = overrides.rateLimit ?? {
    isPaused: vi.fn(async () => false),
    pause: vi.fn(async () => undefined),
  };
  const provider = makeCliProvider(overrides.providerResult);
  const providers = {
    resolveForFeature: vi.fn(async () => provider),
  };
  const pipeline = new EnrichmentPipeline(
    documents as never,
    {} as never, // attachments — not exercised by existing tests
    {} as never, // entities
    {} as never, // documentEntities
    redis as never,
    claudeStatus as never,
    rateLimit as never,
    { get: vi.fn(async () => null) } as never, // systemConfig
    providers as never,
  );
  return { pipeline, documents, claudeStatus, rateLimit, providers, provider };
}

describe('EnrichmentPipeline', () => {
  it('skips when claude is unavailable (CLI provider)', async () => {
    const { pipeline, claudeStatus, documents } = makePipeline({
      claudeStatus: {
        get: vi.fn(async () => ({
          available: false,
          reason: 'no-binary' as const,
          checkedAt: new Date().toISOString(),
        })),
        set: vi.fn(async () => undefined),
      },
    });
    const outcome = await pipeline.run({ dbJobId: 'j1', documentId: 'd1' });
    expect(outcome.status).toBe('skipped');
    expect(claudeStatus.get).toHaveBeenCalled();
    expect(documents.update).not.toHaveBeenCalled();
  });

  it('returns rate-limited when queue is already paused', async () => {
    const { pipeline } = makePipeline({
      rateLimit: {
        isPaused: vi.fn(async () => true),
        pause: vi.fn(async () => undefined),
      },
    });
    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('rate-limited');
  });

  it('on rate-limit error, pauses queue and reverts document status', async () => {
    const reset = new Date(Date.now() + 60_000);
    const documents = { update: vi.fn(async () => ({})) };
    const rateLimit = { isPaused: vi.fn(async () => false), pause: vi.fn(async () => undefined) };
    const claudeStatus = {
      get: vi.fn(async () => ({ available: true, checkedAt: new Date().toISOString() })),
      set: vi.fn(async () => undefined),
    };
    const { pipeline } = makePipeline({
      documents,
      rateLimit,
      claudeStatus,
      providerResult: { final: { type: 'error', reason: 'rate-limit', resetAt: reset } },
    });

    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('rate-limited');
    expect(rateLimit.pause).toHaveBeenCalledWith(reset);
    expect(claudeStatus.set).toHaveBeenCalled();
    expect(documents.update).toHaveBeenCalledWith('d', { status: 'enriching' });
    expect(documents.update).toHaveBeenCalledWith('d', { status: 'parsed' });
  });

  it('on auth error, marks claude unavailable and document parsed', async () => {
    const documents = { update: vi.fn(async () => ({})) };
    const claudeStatus = {
      get: vi.fn(async () => ({ available: true, checkedAt: new Date().toISOString() })),
      set: vi.fn(async () => undefined),
    };
    const { pipeline } = makePipeline({
      documents,
      claudeStatus,
      providerResult: { final: { type: 'error', reason: 'auth' } },
    });

    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('auth-error');
    expect(claudeStatus.set).toHaveBeenCalled();
  });

  it('on success, parses structured output and emits document.enriched', async () => {
    const documents = { update: vi.fn(async () => ({})) };
    const { pipeline } = makePipeline({
      documents,
      providerResult: {
        text: 'Here is the work I did. {"summary":"all good","addedEntitiesCount":3,"addedEdgesCount":5,"droppedLowConfidence":1}',
      },
    });

    const outcome = await pipeline.run({ dbJobId: 'j7', documentId: 'docZ' });
    expect(outcome.status).toBe('enriched');
    expect(outcome.addedEntities).toBe(3);
    expect(outcome.addedEdges).toBe(5);
    expect(outcome.droppedLowConfidence).toBe(1);
    expect(documents.update).toHaveBeenCalledWith('docZ', { status: 'enriched' });
    expect(publishEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'document.enriched',
        payload: expect.objectContaining({
          jobId: 'j7',
          documentId: 'docZ',
          addedEntities: 3,
          addedEdges: 5,
        }),
      }),
    );
  });

  it('marks document failed on provider error', async () => {
    const documents = { update: vi.fn(async () => ({})) };
    const { pipeline } = makePipeline({
      documents,
      providerResult: { final: { type: 'error', reason: 'generic', message: 'exit 1' } },
    });

    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('failed');
    expect(documents.update).toHaveBeenCalledWith('d', { status: 'failed' });
  });
});
