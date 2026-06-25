# 67notes

A minimal, self-contained markdown notes app. A Go backend serves a React UI
(embedded into the binary) and stores everything in MinIO.

```
React UI  ──HTTP──▶  Go backend  ──S3 API──▶  MinIO
(embedded)          (this binary)            notes / notes-images buckets
```

The browser talks **only** to the Go backend — never directly to MinIO.

## Features

- Side-panel directory tree, built from a single recursive list on load.
- Split markdown editor / live preview (GFM: tables, task lists, etc.).
- Image support — pasted, picked, or drag-free upload — stored in a **separate**
  `notes-images` bucket. Each upload is namespaced under its note's prefix with a
  UUID filename (`<note>/<uuid>-<name>`), so it's unique to that note and is
  **deleted automatically when the note (or its folder) is deleted**.
- File attachments — uploaded to MinIO and linked from the note.
- Case-insensitive **content search** across all `.md` notes (concurrent reads).
- Create / rename-by-path / delete notes and folders.
- Light / dark themes (persisted).
- Single binary: the whole UI is embedded via `go:embed`.

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

## Layout

```
main.go         flags, embed, SPA + API wiring
storage.go      MinIO client: list/get/put/delete, dirs, blobs, search
handlers.go     HTTP handlers + path validation
web/            Vite + React + TypeScript frontend
```
