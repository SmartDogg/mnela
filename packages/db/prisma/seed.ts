import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

interface SeedDocumentInput {
  source: 'manual_upload' | 'chatgpt_export' | 'claude_export';
  title: string;
  rawText: string;
  type?: string;
  language?: string;
  projects?: string[];
  status?: 'parsed' | 'enriched';
}

async function upsertProject(slug: string, name: string, description: string) {
  return prisma.project.upsert({
    where: { slug },
    create: { slug, name, description, status: 'active' },
    update: { name, description },
  });
}

async function upsertDocument(input: SeedDocumentInput) {
  const hash = sha256(input.rawText);
  return prisma.document.upsert({
    where: { contentHash: hash },
    create: {
      source: input.source,
      title: input.title,
      rawText: input.rawText,
      cleanText: input.rawText,
      contentHash: hash,
      tokenCount: Math.ceil(input.rawText.length / 4),
      type: input.type ?? 'note',
      language: input.language ?? 'en',
      status: input.status ?? 'parsed',
    },
    update: {},
  });
}

async function upsertEntity(name: string, type: 'project' | 'person' | 'technology' | 'concept') {
  const normalizedName = name.toLowerCase().replace(/\s+/g, '-');
  return prisma.entity.upsert({
    where: { normalizedName_type: { normalizedName, type } },
    create: { name, normalizedName, type, aliases: [] },
    update: { name },
  });
}

async function linkDocumentEntity(documentId: string, entityId: string, mentions: number) {
  return prisma.documentEntity.upsert({
    where: { documentId_entityId: { documentId, entityId } },
    create: { documentId, entityId, mentions },
    update: { mentions },
  });
}

async function linkDocumentProject(documentId: string, projectId: string) {
  return prisma.documentProject.upsert({
    where: { documentId_projectId: { documentId, projectId } },
    create: { documentId, projectId },
    update: {},
  });
}

async function upsertEdge(
  fromId: string,
  toId: string,
  relationType: string,
  confidence: number,
  evidenceDocumentId?: string,
) {
  const status =
    confidence > 0.8 ? 'auto_confirmed' : confidence > 0.5 ? 'needs_review' : 'rejected';
  return prisma.edge.upsert({
    where: { fromId_toId_relationType: { fromId, toId, relationType } },
    create: { fromId, toId, relationType, confidence, status, evidenceDocumentId },
    update: { confidence, status, evidenceDocumentId },
  });
}

async function seedSystemConfig() {
  const defaults: Record<string, unknown> = {
    'site.title': 'Mnela',
    'site.locale': 'en',
    'enrichment.enabled': false,
    'enrichment.confidenceThresholds': { autoConfirmed: 0.8, needsReview: 0.5 },
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: value as never },
      update: {},
    });
  }
}

async function main() {
  console.info('Seeding system config…');
  await seedSystemConfig();

  console.info('Seeding projects…');
  const mnela = await upsertProject('mnela', 'Mnela', 'The second-brain product itself.');
  const claudeCode = await upsertProject(
    'claude-code',
    'Claude Code',
    'Notes and decisions about working with Claude Code as an MCP host.',
  );

  console.info('Seeding documents…');
  const doc1 = await upsertDocument({
    source: 'manual_upload',
    title: 'Mnela kickoff thoughts',
    rawText:
      'Mnela is a self-hosted second brain exposed as an MCP server. It uses Postgres as the source of truth and emits a markdown vault as an export. Server-side Claude Code subprocess handles enrichment.',
    type: 'note',
    language: 'en',
    status: 'enriched',
  });
  const doc2 = await upsertDocument({
    source: 'manual_upload',
    title: 'Why Postgres FTS over a vector DB for v1',
    rawText:
      'For MVP we keep Postgres as the only datastore. tsvector with russian + english dictionaries plus pg_trgm covers fuzzy search. Vector embeddings are reserved for later — pgvector extension is installed but unused.',
    type: 'decision',
    language: 'en',
    status: 'enriched',
  });
  const doc3 = await upsertDocument({
    source: 'manual_upload',
    title: 'MCP transport choice',
    rawText:
      'We expose the Mnela MCP server over HTTP. Local server-side Claude Code uses stdio. HTTP transport requires Bearer-token auth on every request.',
    type: 'decision',
    language: 'en',
    status: 'enriched',
  });
  const doc4 = await upsertDocument({
    source: 'manual_upload',
    title: 'Confidence rubric for graph edges',
    rawText:
      'Edges with confidence above 0.8 land in the graph automatically. Between 0.5 and 0.8 they go to the inbox for review. Below 0.5 they are dropped and logged.',
    type: 'note',
    language: 'en',
    status: 'enriched',
  });

  await Promise.all([
    linkDocumentProject(doc1.id, mnela.id),
    linkDocumentProject(doc2.id, mnela.id),
    linkDocumentProject(doc3.id, mnela.id),
    linkDocumentProject(doc3.id, claudeCode.id),
    linkDocumentProject(doc4.id, mnela.id),
  ]);

  console.info('Seeding chunks…');
  for (const doc of [doc1, doc2, doc3, doc4]) {
    await prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });
    await prisma.documentChunk.create({
      data: {
        documentId: doc.id,
        chunkIndex: 0,
        text: doc.rawText,
        tokenCount: Math.ceil(doc.rawText.length / 4),
      },
    });
  }

  console.info('Seeding entities…');
  const ePostgres = await upsertEntity('Postgres', 'technology');
  const eMcp = await upsertEntity('MCP', 'concept');
  const eClaudeCode = await upsertEntity('Claude Code', 'product');
  const eMnela = await upsertEntity('Mnela', 'project');
  const ePgvector = await upsertEntity('pgvector', 'technology');

  await Promise.all([
    linkDocumentEntity(doc1.id, eMnela.id, 2),
    linkDocumentEntity(doc1.id, ePostgres.id, 1),
    linkDocumentEntity(doc1.id, eClaudeCode.id, 1),
    linkDocumentEntity(doc1.id, eMcp.id, 1),
    linkDocumentEntity(doc2.id, ePostgres.id, 2),
    linkDocumentEntity(doc2.id, ePgvector.id, 1),
    linkDocumentEntity(doc3.id, eMcp.id, 2),
    linkDocumentEntity(doc3.id, eClaudeCode.id, 1),
    linkDocumentEntity(doc4.id, eMnela.id, 1),
  ]);

  console.info('Seeding edges…');
  await Promise.all([
    upsertEdge(eMnela.id, eMcp.id, 'exposes_via', 0.95, doc1.id),
    upsertEdge(eMnela.id, ePostgres.id, 'depends_on', 0.95, doc1.id),
    upsertEdge(eMnela.id, eClaudeCode.id, 'integrates_with', 0.9, doc1.id),
    upsertEdge(ePostgres.id, ePgvector.id, 'has_extension', 0.65, doc2.id),
    upsertEdge(eClaudeCode.id, eMcp.id, 'speaks', 0.95, doc3.id),
  ]);

  console.info('Seeding daily note…');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.dailyNote.upsert({
    where: { date: today },
    create: {
      date: today,
      contentMd:
        '## Today\n\n- Sketched Mnela schema\n- Decided on Postgres-first storage\n- Wrote seed data',
      mood: 'focused',
    },
    update: {},
  });

  console.info('Seeding inbox item…');
  const existingInbox = await prisma.inboxItem.findFirst({
    where: { type: 'link_suggestion', title: 'Suggested link: Postgres → pgvector' },
  });
  if (!existingInbox) {
    await prisma.inboxItem.create({
      data: {
        type: 'link_suggestion',
        title: 'Suggested link: Postgres → pgvector',
        description:
          'Edge proposed with confidence 0.65 from "Why Postgres FTS over a vector DB for v1". Promote to auto-confirmed?',
        payload: {
          fromEntityId: ePostgres.id,
          toEntityId: ePgvector.id,
          relationType: 'has_extension',
          confidence: 0.65,
        },
        documentId: doc2.id,
      },
    });
  }

  console.info('Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
