/**
 * Server-side Claude is given a single prompt per document. The CLAUDE.md
 * template (infra/claude/CLAUDE.md.template) sets the global behavior — this
 * prompt only carries the document id and the expected JSON schema for the
 * structured_output. Claude calls mnela_get_document / mnela_find_similar /
 * mnela_add_entities / mnela_add_links via the stdio MCP host.
 */
export function enrichmentPromptFor(documentId: string): string {
  return [
    `You are enriching a single document for Mnela. Document id: ${documentId}.`,
    '',
    'Steps:',
    '1. Call mnela_get_document with that id to fetch the document and chunks.',
    '2. Extract: a 200-word summary, entities (people, projects, technologies, concepts, organizations), and links between them with confidence in [0, 1].',
    '3. Call mnela_find_similar with the document content (or any salient sub-string) to discover related documents (top 10).',
    '4. For every entity, call mnela_add_entities — pass the documentId so mention-edges get persisted.',
    '5. For every relationship — including ones that cross to entities found in similar documents — call mnela_add_links with evidenceDocumentId set to the current document id.',
    '6. After all writes, return a final JSON of the shape: { "summary": string, "addedEntitiesCount": number, "addedEdgesCount": number, "droppedLowConfidence": number, "notes"?: string }.',
    '',
    'Rules:',
    '- Confidence rubric: 1.0 explicit / 0.9 strongly implied / 0.7 plausible / 0.5 speculative / <0.5 drop.',
    '- Never fabricate. If unsure, lower the confidence.',
    '- Bilingual reasoning: the user writes in English and Russian.',
    '- Do not delete user data.',
  ].join('\n');
}
