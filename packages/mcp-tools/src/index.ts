export type { McpToolContext, SimilarSearcher, EventSink, AuditTxRunner } from './context.js';
export {
  type ToolDefinition,
  type ToolScope,
  type ToolAuditMeta,
  PHASE_5_TOOLS,
  findTool,
  invokeTool,
  runTool,
} from './registry.js';
export { McpScopeError, McpInputError, McpUnknownToolError } from './errors.js';
export {
  ENTITY_TYPES,
  EntityTypeSchema,
  GetDocumentInputSchema,
  GetDocumentOutputSchema,
  FindSimilarInputSchema,
  FindSimilarOutputSchema,
  AddEntitiesInputSchema,
  AddEntitiesOutputSchema,
  AddLinksInputSchema,
  AddLinksOutputSchema,
  type GetDocumentInput,
  type GetDocumentOutput,
  type FindSimilarInput,
  type FindSimilarOutput,
  type AddEntitiesInput,
  type AddEntitiesOutput,
  type AddLinksInput,
  type AddLinksOutput,
} from './schemas.js';
export { GET_DOCUMENT_TOOL, getDocument } from './tools/get-document.js';
export { FIND_SIMILAR_TOOL, findSimilar } from './tools/find-similar.js';
export { ADD_ENTITIES_TOOL, addEntities } from './tools/add-entities.js';
export { ADD_LINKS_TOOL, addLinks } from './tools/add-links.js';
