import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'slug must be kebab-case lowercase');

/**
 * Project status. `active` covers manual + accepted suggestions. `suggested`
 * is detector-emitted; `dismissed` is a previously-rejected suggestion kept
 * around for the revival audit trail. Legacy admin tools still expect to be
 * able to PATCH `paused/archived` for back-compat — those map to `active`
 * with `metadata.legacyStatus` if the caller cares.
 */
const ProjectStatusSchema = z.enum(['active', 'suggested', 'dismissed']);

export const CreateProjectSchema = z.object({
  // ADR-0051: slug is optional on create — when omitted the service mints
  // one from `name`. Existing callers (MCP write tools) can still set it
  // explicitly to match the legacy contract.
  slug: SlugSchema.optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: ProjectStatusSchema.optional(),
  contextMd: z.string().max(100_000).nullable().optional(),
  /** When true, an asynchronous autofill job is enqueued after creation. */
  autoFill: z.boolean().optional(),
  /** Document ids the caller wants linked synchronously at creation time. */
  documentIds: z.array(z.string().min(1)).max(500).optional(),
  /**
   * When set, accept this suggestion: the service expects a row with
   * `status='suggested'` and `slug=acceptFromSlug`, and flips it to
   * `active` instead of creating a new row. Document links from the
   * suggestion are preserved (linkSource stays `suggested`).
   */
  acceptFromSlug: SlugSchema.optional(),
});

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    contextMd: z.string().max(100_000).nullable().optional(),
    autoFill: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}

export const ListProjectsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: ProjectStatusSchema.optional(),
});

export class ListProjectsQuery extends createZodDto(ListProjectsQuerySchema) {}

export const PreviewProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class PreviewProjectDto extends createZodDto(PreviewProjectSchema) {}

export const LinkDocumentSchema = z.object({
  documentId: z.string().min(1),
});

export class LinkDocumentDto extends createZodDto(LinkDocumentSchema) {}
