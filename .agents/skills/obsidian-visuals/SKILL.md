---
name: obsidian-visuals
description: Turn Obsidian notes into visual concepts, Luma/UNI-1 prompts, reference edits, and optionally generated visuals. Use when the user asks to create covers, diagrams, explainers, quote cards, thumbnails, moodboards, storyboards, or reuse/edit an existing image from notes in an Obsidian vault.
compatibility: Requires Obsidian CLI for vault access. Optional Luma generation requires curl and LUMA_API_KEY in the environment or a local .env file.
---

# Obsidian Visuals

Use this skill to transform Obsidian notes into visual artifacts. The default output is concepts and prompts only. Do not generate images, save files, or edit notes unless the user explicitly approves that step.

## Default Workflow

1. Read the vault instructions first if the task uses a specific vault.
2. Read the target note with `obsidian read`.
3. Explore note context with bounded graph traversal:
   - `obsidian links` for outgoing links
   - `obsidian backlinks` for incoming links
   - `obsidian search:context` for 2-4 central phrases
   - read at most 10 total notes unless the user asks for deeper research
4. Produce 2-3 visual concepts before writing prompts.
5. After concept approval, write the final Luma prompt.
6. After prompt approval, call Luma.
7. If the user asks to reuse or edit an existing image, follow the reference/edit workflow before calling Luma again.
8. After image approval, save the image.
9. After separate note-edit approval, insert the image embed into the note.

## Approval Gates

Always separate these approvals:

- concept approval
- prompt approval
- Luma/API generation approval
- reference upload approval, if a local image must be uploaded
- web search grounding approval, if `web_search` will be enabled
- save-to-vault approval
- note-edit approval

Never upload a local image to a third-party host unless the user approves the provider and file; prefer inline base64 for supported local image edits. Never enable Luma web search unless the user approves web grounding for that generation. Never save generated images to `Attachments/` until the user has approved the specific output. Never edit a note until the user approves the exact insertion.

## Visual Jobs

Choose one job from the user's request:

- `cover`: editorial cover image for a note, essay, or Substack post
- `diagram`: conceptual diagram of relationships, systems, or arguments
- `explainer`: visual summary of a note's thesis
- `quote-card`: image built around a selected passage
- `thumbnail`: YouTube/Substack/social thumbnail
- `moodboard`: style exploration for a project or theme
- `storyboard`: sequence of scenes from an essay, script, or outline
- `edit`: revise an existing generated image while preserving approved parts

If the user does not specify a job, default to `cover` for essays and `explainer` for technical notes.

## Text Policy

Default to `no-rendered-text`: the image should work as a visual cover without AI-rendered words.

Supported text modes:

- `no-rendered-text`: no visible text inside the image
- `text-safe`: leave negative space for title text to be added later
- `rendered-text`: ask Luma to render text only when explicitly requested

For literary essays and Substack covers, prefer `no-rendered-text` or `text-safe`.

## Concept Output

For each concept, report:

- name
- job
- text policy
- visual thesis
- composition
- motifs from the note
- style profile
- what to avoid
- why it fits

Do not call Luma while producing concepts.

## Luma

Use curl and `.env` loading only. Read [references/luma-curl.md](references/luma-curl.md) before calling Luma.

For requests like "use the same image", "make this moonlit", "keep composition", "change lighting", "same style", or "use as reference", read [references/luma-reference-editing.md](references/luma-reference-editing.md).

For requests that need external visual grounding, current objects, real places, public figures, or reference images from the web, ask before enabling Luma `web_search`.

When building the Luma prompt, include:

- job type and aspect ratio
- source note title
- distilled thesis
- visual motifs
- composition
- style profile
- text policy
- avoid list
- any approved edit instruction

## Obsidian

Use Obsidian CLI for vault access and note edits. Read [references/obsidian-policy.md](references/obsidian-policy.md) before saving files or editing notes.

For top-of-note image insertion, use `obsidian prepend`; it inserts after YAML frontmatter.

## Style Profiles

Use style profiles as reusable preferences, not hard rules. Read [references/style-profiles.md](references/style-profiles.md) when the user asks for a consistent visual style or when choosing defaults for a known content type.

## Cursor SDK Harness

When running this skill through the Cursor TypeScript SDK terminal harness, read [references/cursor-sdk-harness.md](references/cursor-sdk-harness.md). Keep previews in `tmp/` unless the user explicitly approves saving to the vault.
