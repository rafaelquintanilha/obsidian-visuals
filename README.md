# Obsidian Visuals

Agent Skill for turning Obsidian notes into visual concepts, Luma/UNI-1 prompts, generated images, and reference edits.

The skill is intentionally lightweight. The core workflow is Markdown instructions plus `curl` calls to the Luma Agents API. The TypeScript file in the repository root is an optional Cursor SDK terminal runner, not required by the skill itself.

## What It Does

- Reads an Obsidian note through the Obsidian CLI.
- Explores links, backlinks, and nearby note context.
- Proposes visual concepts before generation.
- Calls Luma only after prompt approval.
- Supports covers, diagrams, explainers, quote cards, thumbnails, moodboards, storyboards, and image edits.
- Supports Luma `web_search` grounding when explicitly approved.
- Supports reference edits with `type: "image_edit"` and `source`.
- Saves approved images to Obsidian `Attachments/` and prepends embeds only after separate approval.

## Repository Layout

```text
.agents/skills/obsidian-visuals/
  SKILL.md
  agents/openai.yaml
  references/
agent.ts
package.json
.env.example
```

The canonical skill lives at `.agents/skills/obsidian-visuals/`.

## Requirements

- Obsidian CLI available as `obsidian`.
- Luma Agents API key for generation.
- Optional: Cursor API key and Node.js if using the terminal runner.

Create a local `.env` from the example:

```sh
cp .env.example .env
```

Then set:

```sh
LUMA_API_KEY=...
OBSIDIAN_VAULT_PATH=/absolute/path/to/obsidian-vault
```

For the Cursor SDK runner, also set:

```sh
CURSOR_API_KEY=...
CURSOR_DEFAULT_MODEL=composer-2
```

`CURSOR_DEFAULT_MODEL` changes the runner's startup model. The `--model` flag and interactive `/model <id>` command still override it for that session.

Do not commit `.env`.

## Use As An Agent Skill

For agents that read project-local skills from `.agents/skills`, clone this repository into your project and use the skill from:

```text
.agents/skills/obsidian-visuals/
```

For agents that expect a direct skill directory, copy or clone `.agents/skills/obsidian-visuals` into that agent's skill folder.

## Optional Cursor SDK Runner

Install dependencies:

```sh
pnpm install
```

Check configuration:

```sh
pnpm run check
```

Start the terminal assistant:

```sh
pnpm run agent
```

Useful options:

```sh
pnpm run agent -- --vault "/absolute/path/to/vault"
pnpm run agent -- --target "/absolute/path/to/vault/Zettelkasten/My Essay.md"
pnpm run agent -- --model composer-2
pnpm run agent -- --agent-id agent-...
pnpm run agent -- --plain
```

Inside the runner:

```text
/status
/models
/models composer
/model composer-2
/agents
/resume 1
/resume agent-...
/runs
/run 1
/run run-...
/debug
/history
/vault /absolute/path/to/vault
/note Zettelkasten/My Essay.md
/note none
/verbose on
/force on
/exit
```

## Safety Model

The skill separates these approvals:

- concept selection
- prompt approval
- Luma/API generation approval
- web search grounding approval, when `web_search` is used
- reference upload approval, when a local file must be uploaded
- save-to-vault approval
- note-edit approval

Local previews stay in `tmp/` unless the user approves saving a specific output to the vault.

## Luma Notes

The Luma Agents API returns a job ID first. Poll `GET /generations/{id}` until the job completes. Completed image URLs are returned in `output[0].url` and are presigned.

For local image edits, prefer inline base64 `source` data with `media_type` before uploading to a public host.
