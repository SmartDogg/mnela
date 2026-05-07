import { Injectable, NotFoundException } from '@nestjs/common';
import { DailyNoteRepository } from '@mnela/db';
import type { DailyNote } from '@prisma/client';

@Injectable()
export class DailyService {
  constructor(private readonly notes: DailyNoteRepository) {}

  list(from?: Date, to?: Date): Promise<DailyNote[]> {
    return this.notes.list(from, to);
  }

  async findByDate(date: Date): Promise<DailyNote> {
    const note = await this.notes.findByDate(date);
    if (!note) throw new NotFoundException(`No daily note for ${date.toISOString().slice(0, 10)}`);
    return note;
  }

  upsert(date: Date, contentMd: string, mood?: string | null): Promise<DailyNote> {
    const input: Parameters<DailyNoteRepository['upsert']>[0] = { date, contentMd };
    if (mood !== undefined) input.mood = mood;
    return this.notes.upsert(input);
  }
}
