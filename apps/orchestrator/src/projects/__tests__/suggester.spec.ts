import { describe, expect, it, vi } from 'vitest';

import { ProjectsSuggesterService } from '../projects-suggester.service.js';

interface MockedDetector {
  detectBatch: ReturnType<typeof vi.fn>;
  detectClusters: ReturnType<typeof vi.fn>;
  listRecentBatchIds: ReturnType<typeof vi.fn>;
}

interface MockedNamer {
  nameCandidate: ReturnType<typeof vi.fn>;
}

interface MockedProjects {
  findBySignatures: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  linkDocuments: ReturnType<typeof vi.fn>;
  updateById: ReturnType<typeof vi.fn>;
}

interface MockedRegistry {
  get: ReturnType<typeof vi.fn>;
}

interface MockedRedis {
  client: { incr: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> };
}

function makeService(opts: {
  enabled: boolean;
  candidate?: unknown;
  existing?: unknown[];
  /** Pre-set the daily counter — defaults to 1 so the budget never trips. */
  passesToday?: number;
}) {
  const detector: MockedDetector = {
    detectBatch: vi.fn().mockResolvedValue(opts.candidate ?? null),
    detectClusters: vi.fn().mockResolvedValue([]),
    listRecentBatchIds: vi.fn().mockResolvedValue([]),
  };
  const namer: MockedNamer = {
    nameCandidate: vi
      .fn()
      .mockResolvedValue({ name: 'Mocked', description: 'desc', fromLlm: false }),
  };
  const projects: MockedProjects = {
    findBySignatures: vi.fn().mockResolvedValue(opts.existing ?? []),
    findBySlug: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((data: { slug: string; name: string }) => ({
      id: 'proj-' + data.slug,
      slug: data.slug,
      name: data.name,
      status: 'suggested',
    })),
    linkDocuments: vi.fn().mockResolvedValue(1),
    updateById: vi.fn(),
  };
  const registry: MockedRegistry = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'projects.suggestions.enabled') return Promise.resolve({ value: opts.enabled });
      if (key === 'projects.suggestions.maxPassesPerDay') return Promise.resolve({ value: 50 });
      return Promise.resolve({ value: null });
    }),
  };
  const redis: MockedRedis = {
    client: {
      incr: vi.fn().mockResolvedValue(opts.passesToday ?? 1),
      expire: vi.fn().mockResolvedValue(1),
    },
  };

  const service = new ProjectsSuggesterService(
    detector as never,
    namer as never,
    projects as never,
    registry as never,
    redis as never,
  );
  return { service, detector, namer, projects, registry, redis };
}

describe('ProjectsSuggesterService', () => {
  it('short-circuits when the gate is off — no detection SQL, no Haiku', async () => {
    const { service, detector, namer, projects } = makeService({ enabled: false });
    const result = await service.run({ mode: 'batch', batchId: 'b1' });
    expect(result.status).toBe('disabled');
    expect(detector.detectBatch).not.toHaveBeenCalled();
    expect(detector.detectClusters).not.toHaveBeenCalled();
    expect(namer.nameCandidate).not.toHaveBeenCalled();
    expect(projects.create).not.toHaveBeenCalled();
  });

  it('persists a new suggestion with linked docs when the detector returns a candidate', async () => {
    const candidate = {
      kind: 'batch' as const,
      batchId: 'b1',
      signature: 'batch:b1',
      docCount: 7,
      documentIds: ['d1', 'd2', 'd3'],
      topEntityIds: ['e1', 'e2'],
      topEntityNames: ['Project Alpha', 'Beta'],
      sampleTitles: ['T1', 'T2'],
      metrics: { docCount: 7, topEntities: ['e1', 'e2'] },
    };
    const { service, projects, namer } = makeService({
      enabled: true,
      candidate,
    });
    const result = await service.run({ mode: 'batch', batchId: 'b1' });
    expect(result.status).toBe('ok');
    expect(result.emitted).toBe(1);
    expect(namer.nameCandidate).toHaveBeenCalledTimes(1);
    expect(projects.create).toHaveBeenCalledTimes(1);
    expect(projects.linkDocuments).toHaveBeenCalledWith(
      expect.stringContaining('proj-'),
      ['d1', 'd2', 'd3'],
      'suggested',
    );
  });

  it('skips a candidate whose signature already maps to an active project', async () => {
    const candidate = {
      kind: 'batch' as const,
      batchId: 'b1',
      signature: 'batch:b1',
      docCount: 7,
      documentIds: ['d1'],
      topEntityIds: ['e1'],
      topEntityNames: ['X'],
      sampleTitles: [],
      metrics: { docCount: 7, topEntities: ['e1'] },
    };
    const existing = [
      {
        id: 'p-existing',
        slug: 'existing',
        signature: 'batch:b1',
        status: 'active',
        signatureMetrics: { docCount: 7, topEntities: ['e1'] },
      },
    ];
    const { service, projects } = makeService({
      enabled: true,
      candidate,
      existing,
    });
    const result = await service.run({ mode: 'batch', batchId: 'b1' });
    expect(result.skippedExisting).toBe(1);
    expect(projects.create).not.toHaveBeenCalled();
  });

  it('revives a dismissed signature when metrics outgrew the snapshot', async () => {
    const candidate = {
      kind: 'batch' as const,
      batchId: 'b1',
      signature: 'batch:b1',
      docCount: 20,
      documentIds: ['d1', 'd2'],
      topEntityIds: ['e1'],
      topEntityNames: ['X'],
      sampleTitles: [],
      metrics: { docCount: 20, topEntities: ['e1'] },
    };
    const existing = [
      {
        id: 'p-dismissed',
        slug: 'dismissed',
        signature: 'batch:b1',
        status: 'dismissed',
        signatureMetrics: { docCount: 10, topEntities: ['e1'] },
      },
    ];
    const { service, projects } = makeService({
      enabled: true,
      candidate,
      existing,
    });
    const result = await service.run({ mode: 'batch', batchId: 'b1' });
    expect(result.emitted).toBe(1);
    expect(projects.create).toHaveBeenCalledTimes(1);
  });
});
