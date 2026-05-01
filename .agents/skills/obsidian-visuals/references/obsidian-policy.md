# Obsidian Policy

Use Obsidian CLI for vault operations:

```sh
obsidian vault
obsidian read path="Zettelkasten/Note.md"
obsidian links path="Zettelkasten/Note.md"
obsidian backlinks path="Zettelkasten/Note.md" format=json
obsidian search:context query="phrase" path="Zettelkasten" limit=5
obsidian prepend path="Zettelkasten/Note.md" content="![[image.png]]"
```

Do not pipe Obsidian CLI output. It can hang in some environments.

For context exploration:

- read the target note first
- inspect outgoing links
- inspect backlinks
- search 2-4 central phrases
- read at most 10 total notes by default

For saving generated images:

- do not save until the user approves the exact generated output
- use the vault's `Attachments/` folder unless the user chooses another location
- use a stable filename derived from the note title and job, for example `as-lamentacoes-de-thomas-mann-cover-2026-05-01.png`

For inserting an approved image at the top of a note:

- use `obsidian prepend`, because it inserts after YAML frontmatter
- insert only the embed, unless the user asks for caption or metadata

Example:

```sh
obsidian prepend path="Zettelkasten/As lamentações de Thomas Mann.md" content="![[as-lamentacoes-de-thomas-mann-cover-2026-05-01.png]]"
```
