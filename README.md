# 67notes

A minimal, self-contained markdown notes app. A Go backend serves a React UI
(embedded into the binary) and stores everything in MinIO.

```
React UI  ──HTTP──▶  Go backend  ──S3 API──▶  MinIO
(embedded)          (this binary)            notes / notes-images buckets
```

The browser talks **only** to the Go backend — never directly to MinIO.

## Features

- Side-panel directory tree, built from a single recursive list on load, with
  inline new-note / new-folder actions and per-row **rename** and **delete** for
  both notes and folders.
- Markdown editor with **edit / split / preview** modes (preview is the default);
  GFM rendering (tables, task lists, etc.). The formatting toolbar is shown only
  while editing.
- **Undo / redo** (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y`) with coalesced
  history, `Ctrl/Cmd+S` to save, and a **Cancel** button to discard unsaved edits.
- **Remembers the last-open note** across browser refreshes (localStorage).
- **Search** lives in the top bar and opens a dedicated `/search` page: one card
  per matching file with a match count and a **“Display content”** toggle that
  reveals every matching line with ±5 lines of context (adjacent matches are
  merged) and the query highlighted. Backed by a case-insensitive content scan
  across all `.md` notes (concurrent reads).
- Image support — pasted, picked, or drag-free upload — stored in a **separate**
  `notes-images` bucket. Each upload is namespaced under its note's prefix with a
  UUID filename (`<note>/<uuid>-<name>`), so it's unique to that note and is
  **deleted automatically when the note (or its folder) is deleted**.
- File attachments — uploaded to MinIO and linked from the note.
- **Ask Claude** side panel (`?` button in the top bar) — a resizable, dockable
  chat that streams answers from a **local Claude CLI**. It has the `notes` skill
  wired in, so it can search, read, and edit your notes while answering. See
  [AI chat](#ai-chat-ask-claude) for setup.
- Light / dark themes (persisted).
- Single binary: the whole UI is embedded via `go:embed`, with SPA fallback so
  client-side routes (e.g. `/search`) resolve on a hard refresh.

> **Rename caveat:** there is no move/rename endpoint, so the UI renames a note by
> copying it to the new path and deleting the old one. Because deleting a note
> cascades to its images, **renaming a note drops its attached images.**

## Build & run

```sh
make build      # builds the React UI, then the Go binary with the UI embedded
./67notes       # serves on :6767 by default
```

Then open http://localhost:6767.

> `go build` alone requires `web/dist` to exist (it's embedded). Use `make build`,
> which builds the frontend first.

### Frontend dev mode (hot reload)

```sh
./67notes &        # backend on :6767
make dev           # Vite dev server, proxies /api -> :6767
```

## Configuration

Flags (env var in parentheses), with defaults:

| Flag             | Env                 | Default          |
| ---------------- | ------------------- | ---------------- |
| `-addr`          | `ADDR`              | `:6767`          |
| `-minio`         | `MINIO_ENDPOINT`    | `127.0.0.1:7778` |
| `-access-key`    | `MINIO_ACCESS_KEY`  | `minioadmin`     |
| `-secret-key`    | `MINIO_SECRET_KEY`  | `minioadmin`     |
| `-notes-bucket`  | `NOTES_BUCKET`      | `notes`          |
| `-blobs-bucket`  | `IMAGES_BUCKET`     | `notes-images`   |
| `-ssl`           | `MINIO_SSL`         | `false`          |

Both buckets are created automatically if missing.

## AI chat (Ask Claude)

The **Ask Claude** panel (the `?` button in the top bar) talks to a **Claude CLI
installed on the same machine as the server**, not to any hosted API directly.
When you send a message, the backend shells out to:

```sh
claude -p "/notes\n\n<your message>" --dangerously-skip-permissions
```

and streams the CLI's stdout straight back to the browser. The leading `/notes`
loads the bundled **notes skill**, which lets Claude search, read, and edit your
notes (over this same HTTP API) while it answers. Each message is independent —
no conversation history is kept server-side.

### 1. Install the Claude CLI

The server runs whatever `claude` is on its `PATH`. Install
[Claude Code](https://code.claude.com/docs) with the native installer:

```sh
# macOS, Linux, WSL:
curl -fsSL https://claude.ai/install.sh | bash
# Windows PowerShell:
#   irm https://claude.ai/install.ps1 | iex
```

Then authenticate it once. The simplest path is to run `claude` interactively and
log in via the browser (credentials persist); for headless setups use a token or
API key instead:

```sh
claude                                  # interactive: log in once via browser
# headless alternatives:
#   export CLAUDE_CODE_OAUTH_TOKEN=...   # from `claude setup-token`
#   export ANTHROPIC_API_KEY=...         # from the Anthropic Console
```

Verify it works non-interactively — this is exactly how the server calls it:

```sh
claude -p "say hello" --dangerously-skip-permissions
```

### 2. Install the notes skill

The skill ships **in this repo** at [`.claude/skills/notes/`](.claude/skills/notes/)
and is picked up automatically — there's nothing extra to install **as long as
you start the server from the repo root**, because the CLI discovers project
skills relative to its working directory.

To make the skill available everywhere (e.g. if you run the binary from another
directory, or want to use it from a terminal too), copy it into your user skills:

```sh
mkdir -p ~/.claude/skills
cp -r .claude/skills/notes ~/.claude/skills/notes
```

The skill resolves the server as `${NOTES_URL:-http://localhost:6767}`. If you
run 67notes on a non-default address, export `NOTES_URL` **before** launching the
server so the spawned CLI inherits it:

```sh
export NOTES_URL=http://localhost:9000
./67notes -addr :9000
```

### Notes & caveats

- **`--dangerously-skip-permissions`** is used because the skill needs to run
  `curl`/`Bash` and print mode can't prompt for approval. This is fine for a
  local, single-user, no-auth app — but it means anyone who can reach the server
  can run the CLI with full tool access. **Don't expose 67notes to untrusted
  networks** while the chat is enabled.
- The chat requires `claude` on the **server's** `PATH`. If it's missing, the
  `/api/chat` request returns an error that's surfaced in the panel.
- Replies are streamed (`text/plain`, flushed per chunk); closing the panel or
  hitting **Stop** cancels the request and kills the subprocess.

## API

| Method | Path                      | Purpose                                  |
| ------ | ------------------------- | ---------------------------------------- |
| GET    | `/api/tree`               | List all notes/dirs (for the tree)       |
| GET    | `/api/note?path=`         | Get a note's content                     |
| PUT    | `/api/note?path=`         | Create/update a note (body = markdown)   |
| DELETE | `/api/note?path=`         | Delete a note                            |
| POST   | `/api/dir?path=`          | Create a (empty) directory               |
| DELETE | `/api/dir?path=`          | Delete a directory, its notes + images   |
| POST   | `/api/blob`               | Upload image/file (multipart `file`, `note`) |
| GET    | `/api/blob?key=`          | Fetch an image/file                      |
| GET    | `/api/search?q=`          | Case-insensitive content search          |
| POST   | `/api/chat`               | Stream a Claude CLI reply (body = `{message}`) |

## Layout

```
main.go               flags, embed, SPA + API wiring
storage.go            MinIO client: list/get/put/delete, dirs, blobs, search
handlers.go           HTTP handlers + path validation; /api/chat shells out to the Claude CLI
.claude/skills/notes  the notes skill the chat panel loads (curl over this API)
web/                  Vite + React + TypeScript frontend
  src/ChatPanel.tsx   the resizable Ask Claude side panel
```
