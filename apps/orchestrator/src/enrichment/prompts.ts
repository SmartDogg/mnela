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

/**
 * Project context refresh: Claude reads the project's recent documents +
 * decisions + entities via the MCP tools, writes back a fresh context.md
 * via mnela_update_project_context. Returns a final JSON envelope so the
 * orchestrator can record what happened.
 */
export function projectContextRefreshPromptFor(slug: string): string {
  return [
    `You are refreshing the context.md for Mnela project: ${slug}.`,
    '',
    'Steps:',
    `1. Call mnela_get_project_context with slug "${slug}". You receive the project metadata, its 20 most recent documents, its decisions, the top co-occurring entities, and any open questions captured in metadata.`,
    '2. Synthesize a Markdown context document with these top-level sections (omit any section that has no signal):',
    '   - "## Overview" — 3-5 sentences in the user\'s own voice describing what this project is about right now.',
    '   - "## Key entities" — bullet list of the top 10 entities (Name [type] — one-line role).',
    '   - "## Recent decisions" — chronological bullet list of the 5 most recent decisions; cite their titles verbatim.',
    '   - "## Open questions" — bullet list of unresolved questions (use the input, plus anything obvious from recent docs).',
    '   - "## Recent activity" — bullet list of the 5 most recently added documents (title + date).',
    `3. Call mnela_update_project_context with slug "${slug}" and the contextMd you produced.`,
    '4. Return a final JSON of the shape: { "summary": string, "addedEntitiesCount": 0, "addedEdgesCount": 0, "droppedLowConfidence": 0, "notes"?: string } — entity/edge counts are 0 because this task only rewrites the prose.',
    '',
    'Rules:',
    '- Be concise. Do not invent decisions or entities the input did not provide.',
    '- Bilingual: prefer the language the documents are written in.',
    '- Do not delete user data; mnela_update_project_context overwrites contextMd, but nothing else.',
  ].join('\n');
}
