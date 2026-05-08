import { PrismaService } from '@mnela/db';
import { HybridSearchAdapter } from '@mnela/search';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SearchBridge {
  private readonly adapter: HybridSearchAdapter;

  constructor(private readonly prisma: PrismaService) {
    this.adapter = new HybridSearchAdapter(() => this.prisma.active());
  }

  async findSimilar(
    text: string,
    limit: number,
  ): Promise<
    {
      documentId: string;
      title: string;
      snippet?: string;
      score: number;
    }[]
  > {
    const trimmed = text.length > 600 ? text.slice(0, 600) : text;
    const result = await this.adapter.search({ query: trimmed, page: 1, limit });
    return result.hits.map((h) => {
      const out: { documentId: string; title: string; snippet?: string; score: number } = {
        documentId: h.documentId,
        title: h.title,
        score: h.score,
      };
      if (h.snippet) out.snippet = h.snippet;
      return out;
    });
  }
}
