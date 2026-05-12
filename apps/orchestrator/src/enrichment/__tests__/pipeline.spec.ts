import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runClaudeMock = vi.fn();
vi.mock('@mnela/claude-runner', () => ({ runClaude: runClaudeMock }));

const publishEventMock = vi.fn();
const peekSlotMock = vi.fn().mockResolvedValue(null);
const recordCompletionMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@mnela/queue', () => ({
  publishEvent: publishEventMock,
  peekSlot: peekSlotMock,
  recordEnrichmentCompletion: recordCompletionMock,
}));

const { EnrichmentPipeline } = await import('../pipeline.js');

interface FakeRunOpts {
  result?: { result?: string };
  rateLimitHit?: { resetAt: Date | null; raw: string; source: string };
  authError?: 'invalid-key' | 'not-logged-in' | 'oauth-revoked' | null;
  exitCode?: number | null;
  timedOut?: boolean;
}

function fakeRun(opts: FakeRunOpts = {}) {
  return {
    exitCode: opts.exitCode ?? 0,
    signal: null,
    stdout: '',
    stderr: '',
    frames: [],
    result: opts.result ?? { type: 'result', session_id: 's', result: '' },
    rateLimitHit: opts.rateLimitHit ?? null,
    authError: opts.authError ?? null,
    timedOut: opts.timedOut ?? false,
  };
}

beforeEach(() => {
  runClaudeMock.mockReset();
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
  const pipeline = new EnrichmentPipeline(
    documents as never,
    {} as never, // attachments — not exercised by existing tests
    {} as never, // entities
    {} as never, // documentEntities
    redis as never,
    claudeStatus as never,
    rateLimit as never,
    { get: vi.fn(async () => null) } as never, // systemConfig
  );
  return { pipeline, documents, claudeStatus, rateLimit };
}

describe('EnrichmentPipeline', () => {
  it('skips when claude is unavailable', async () => {
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
    expect(runClaudeMock).not.toHaveBeenCalled();
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
    expect(runClaudeMock).not.toHaveBeenCalled();
  });

  it('on rate-limit hit, pauses queue and reverts document status', async () => {
    const reset = new Date(Date.now() + 60_000);
    runClaudeMock.mockResolvedValueOnce(
      fakeRun({
        rateLimitHit: { resetAt: reset, raw: 'rate', source: 'api_retry_frame' },
      }),
    );
    const documents = { update: vi.fn(async () => ({})) };
    const rateLimit = { isPaused: vi.fn(async () => false), pause: vi.fn(async () => undefined) };
    const claudeStatus = {
      get: vi.fn(async () => ({ available: true, checkedAt: new Date().toISOString() })),
      set: vi.fn(async () => undefined),
    };
    const { pipeline } = makePipeline({ documents, rateLimit, claudeStatus });

    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('rate-limited');
    expect(rateLimit.pause).toHaveBeenCalledWith(reset);
    expect(claudeStatus.set).toHaveBeenCalled();
    expect(documents.update).toHaveBeenCalledWith('d', { status: 'enriching' });
    expect(documents.update).toHaveBeenCalledWith('d', { status: 'parsed' });
  });

  it('on auth error, marks claude unavailable and document parsed', async () => {
    runClaudeMock.mockResolvedValueOnce(fakeRun({ authError: 'not-logged-in' }));
    const documents = { update: vi.fn(async () => ({})) };
    const claudeStatus = {
      get: vi.fn(async () => ({ available: true, checkedAt: new Date().toISOString() })),
      set: vi.fn(async () => undefined),
    };
    const { pipeline } = makePipeline({ documents, claudeStatus });

    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('auth-error');
    expect(claudeStatus.set).toHaveBeenCalled();
  });

  it('on success, parses structured output and emits document.enriched', async () => {
    runClaudeMock.mockResolvedValueOnce(
      fakeRun({
        result: {
          result:
            'Here is the work I did. {"summary":"all good","addedEntitiesCount":3,"addedEdgesCount":5,"droppedLowConfidence":1}',
        },
      }),
    );
    const documents = { update: vi.fn(async () => ({})) };
    const { pipeline } = makePipeline({ documents });

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

  it('marks document failed on non-zero exit', async () => {
    runClaudeMock.mockResolvedValueOnce(fakeRun({ exitCode: 1 }));
    const documents = { update: vi.fn(async () => ({})) };
    const { pipeline } = makePipeline({ documents });

    const outcome = await pipeline.run({ dbJobId: 'j', documentId: 'd' });
    expect(outcome.status).toBe('failed');
    expect(documents.update).toHaveBeenCalledWith('d', { status: 'failed' });
  });
});
