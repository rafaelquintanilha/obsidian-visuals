# Cursor SDK Harness

This repository includes an optional local terminal harness for running the `obsidian-visuals` skill through the Cursor TypeScript SDK. It is intentionally not a web app.

## Setup

Create a local `.env` file with:

```sh
CURSOR_API_KEY=...
CURSOR_DEFAULT_MODEL=composer-2
LUMA_API_KEY=...
OBSIDIAN_VAULT_PATH=/absolute/path/to/obsidian-vault
```

`CURSOR_API_KEY` is required to start the Cursor SDK agent. `LUMA_API_KEY` is required only when the user approves a Luma generation.
`CURSOR_DEFAULT_MODEL` sets the runner's startup model. The `--model` flag and `/model <id>` command override it for a session.

## Run

```sh
bun install
bun run agent
```

The default run opens an interactive assistant prompt. It does not assume a note. Tell the assistant what you want, including the note path when the task depends on a note.

Useful options:

```sh
bun run check
bun run agent -- --check
bun run agent -- --target "/absolute/path/to/note.md"
bun run agent -- --vault "/absolute/path/to/vault"
bun run agent -- --model composer-2
bun run agent -- --agent-id agent-...
bun run agent -- --plain
```

`--target` only configures a default note for the assistant to use if the user refers to "the configured note". It does not start work by itself.

For vault content, the assistant is instructed to use `obsidian` shell commands from the vault directory and to ask before falling back to direct file reads if Obsidian CLI fails. If no vault is configured, the assistant asks for one before reading notes.

## Local Commands

Inside the conversation:

```text
/status
/note Zettelkasten/My Essay.md
/note none
/vault /absolute/path/to/vault
/verbose on
/plain on
/force on
/agents
/resume agent-...
/runs
/run run-...
/debug
/clear
/exit
```

Changing `/note` or `/vault` refreshes the assistant context on the next user turn.
Use `/agents` and `/resume <agent-id>` to restore a previous local conversation. Use `/runs`, `/run <run-id>`, or `/debug` to inspect Cursor SDK session state without sending another user turn.

## Safety Gates

The harness and skill separate these approvals:

- concept selection
- prompt approval
- Luma generation approval
- reference upload approval, if a local file must be uploaded
- web search grounding approval, if `web_search` is enabled
- save-to-vault approval
- note-edit approval

Generated previews should stay in `tmp/` until the user approves saving them into the vault.
