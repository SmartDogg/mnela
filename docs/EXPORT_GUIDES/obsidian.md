# Importing an Obsidian vault

Mnela treats an Obsidian vault as a folder of Markdown files. Frontmatter
is parsed via `gray-matter`; `[[wikilinks]]` are preserved as plain text
(the graph builder later turns them into edges if both ends exist).

## Package the vault

The vault is "just a folder" — zip it directly:

```bash
cd ~/Documents
zip -r my-vault.zip my-obsidian-vault/
```

Don't add the `.obsidian/` workspace settings folder unless you want them
ingested as JSON-source docs (they aren't useful in Mnela). Easiest exclude:

```bash
zip -r my-vault.zip my-obsidian-vault/ -x '*/.obsidian/*'
```

## Upload

- Web UI: `/activity?tab=uploads` → drop the ZIP.
- Folder watch: extract into `${MNELA_DATA_DIR}/dropbox/` (each `.md` is
  ingested independently — useful for live mirroring via `rsync` or
  Syncthing).
- API: `POST /api/v1/imports`.

## What gets imported

- One `Document(source=obsidian_vault)` per `.md` file.
- Frontmatter keys land in `Document.metadata`. Notable keys Mnela acts on:
  - `tags:` → entity hints
  - `created:` / `date:` → `Document.occurredAt` if parseable
  - `project:` → if the value matches an existing project slug, the doc
    auto-links to that project on import
- Attachments referenced by `![[image.png]]` are NOT auto-uploaded.
  Drop the `_attachments/` directory (or the full asset folder) into
  `${MNELA_DATA_DIR}/dropbox/` separately and Mnela will link by filename.

## What does NOT carry over

- Canvas / whiteboard files (`.canvas`)
- Daily notes specifically — they import as ordinary documents with
  `source=obsidian_vault`. To migrate them to Mnela's daily-tab semantics,
  edit `Document.source` to `daily` after import or re-import with a
  preprocessing step that flips the source field.
- Themes / community plugins / hotkeys / workspace state.

## Read-only viewing from Obsidian

Mnela can generate a vault representation back. `/admin/system → Storage →
Generate vault` (Phase 11) writes Markdown mirrors to `${MNELA_DATA_DIR}/vault/`.
Point Obsidian at that directory as a read-only vault — edits there are
discarded on the next regeneration. The canonical source of truth stays in
Postgres.
