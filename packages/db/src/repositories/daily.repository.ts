import type { DailyNote, Prisma } from '@prisma/client';

import type { PrismaProvider } from './types.js';

export interface UpsertDailyInput {
  date: Date;
  contentMd: string;
  mood?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export class DailyNoteRepository {
  constructor(private readonly getPrisma: PrismaProvider) {}

  findByDate(date: Date): Promise<DailyNote | null> {
    return this.getPrisma().dailyNote.findUnique({ where: { date } });
  }

  upsert(input: UpsertDailyInput): Promise<DailyNote> {
    const { date, contentMd, mood, metadata } = input;
    const create: Prisma.DailyNoteCreateInput = { date, contentMd };
    if (mood !== undefined) create.mood = mood;
    if (metadata !== undefined) create.metadata = metadata;
    const update: Prisma.DailyNoteUpdateInput = { contentMd };
    if (mood !== undefined) update.mood = mood;
    if (metadata !== undefined) update.metadata = metadata;
    return this.getPrisma().dailyNote.upsert({ where: { date }, create, update });
  }

  list(from?: Date, to?: Date): Promise<DailyNote[]> {
    const where: Prisma.DailyNoteWhereInput = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }
    return this.getPrisma().dailyNote.findMany({
      where,
      orderBy: { date: 'desc' },
    });
  }
}
