import type { Job, JobStatus } from '@prisma/client';

import type { PrismaService } from '@mnela/db';

const TERMINAL: ReadonlySet<JobStatus> = new Set(['completed', 'failed', 'cancelled']);

export async function waitForJob(
  prisma: PrismaService,
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Job> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await prisma.client.job.findUnique({ where: { id: jobId } });
    if (job && TERMINAL.has(job.status)) return job;
    await sleep(intervalMs);
  }
  throw new Error(`waitForJob: ${jobId} did not reach terminal status within ${timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
