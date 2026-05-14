---
name: Feature request
about: Suggest an improvement or new capability
title: 'feat: <one-line summary>'
labels: enhancement
---

## Problem you're hitting

<!-- What can't you do today? Specific scenario, not just "would be nice". -->

## What you'd like

<!-- Behaviour, UI, or API shape. Sketch is fine. -->

## Alternatives you've considered

<!-- Workarounds, related issues, existing knobs that almost solve it. -->

## Scope hint

- [ ] UI-only change (apps/web)
- [ ] API surface change (apps/api)
- [ ] Ingestion / parser change (packages/ingestion + apps/worker)
- [ ] Enrichment / orchestrator change
- [ ] LLM provider abstraction (packages/llm-providers)
- [ ] Deploy / DX (scripts, infra, docs)

## Out of scope

See `mnela-tz-prompt.md` §18 (amended by ADR-0053). v1 explicitly does NOT
ship: mobile app, multi-tenant, plugins API, marketplace, federated
search, LLM proxy, TTS, image gen, Notion/Drive/GitHub sync.
