# 67notes — API reference for LLM agents

This document describes the HTTP API of the 67notes server so an autonomous
agent can read, search, create, and update markdown notes (and their images).

The agent talks **only** to this HTTP API. It never accesses MinIO/S3 directly.

## Connection

- **Base URL:** `http://localhost:6767` (default; configurable via `-addr`/`ADDR`).
- **Auth:** none. The server is intended to run locally/trusted.
- **Content type of responses:** `application/json` for every endpoint except
  `GET /api/blob`, which streams raw file bytes with the file's own content type.

## Core concepts

- A **note** is a UTF-8 markdown object identified by a `path` (an S3 object key),
  e.g. `projects/ideas.md`. Notes always end in `.md`; the server appends `.md`
  on write if you omit it.
- A **path** is relative, uses `/` separators, has **no leading slash**, and may
  **not** contain `..` (path traversal is rejected with HTTP 400). Directories are
  written as a `path/` prefix (trailing slash).
- The note tree is a flat list of objects; the directory structure is implied by
  `/` in the paths. Empty directories are kept alive by a hidden `.keep` object
  and are reported as `isDir: true` entries.
- **Images / file attachments** live in a separate bucket and are addressed by a
  `key`. On upload they are namespaced under the owning note:
  `«note-path-without-.md»/«uuid»-«filename»`. They are **deleted automatically**
  when the owning note (or its parent folder) is deleted. Reference them in
  markdown using the returned `url`, e.g. `![alt](/api/blob?key=...)`.

## Error format

Any non-2xx response is JSON:

```json
{ "error": "human-readable message" }
```

Common statuses: `400` (bad/missing/traversal path, empty query), `404` (note or
blob not found), `500` (storage error).

---

## Endpoints

### 1. List the note tree

```
GET /api/tree
```

Returns every note and directory in the notes bucket, sorted by path. Call this
first to discover what notes exist.

**Response `200`** — array of objects:

| field          | type    | notes                                            |
| -------------- | ------- | ------------------------------------------------ |
| `path`         | string  | object key; directories end with `/`            |
| `size`         | number  | bytes (0 for directories)                        |
| `lastModified` | string  | RFC3339 UTC, e.g. `2026-06-25T15:56:16Z`; `""` for dirs |
| `isDir`        | boolean | `true` for directories                           |

```json
[
  { "path": "archive/",            "size": 0,  "lastModified": "",                     "isDir": true },
  { "path": "projects/",           "size": 0,  "lastModified": "",                     "isDir": true },
  { "path": "projects/ideas.md",   "size": 57, "lastModified": "2026-06-25T15:56:16Z", "isDir": false }
]
```

```sh
curl http://localhost:6767/api/tree
```

### 2. Read a note

```
GET /api/note?path=<note-path>
```

| query  | required | description                          |
| ------ | -------- | ------------------------------------ |
| `path` | yes      | note key, e.g. `projects/ideas.md`   |

**Response `200`:**

```json
{ "path": "projects/ideas.md", "content": "# Ideas\n\nfull markdown text…" }
```

`404` if the note does not exist.

```sh
curl "http://localhost:6767/api/note?path=projects/ideas.md"
```

### 3. Create or update a note

```
PUT /api/note?path=<note-path>
```

The **request body is the raw markdown content** (send `Content-Type:
text/markdown`). This is an upsert: it creates the note or overwrites it
entirely. If `path` does not end in `.md`, `.md` is appended. Parent directories
are implied by the path — no need to create them first.

**Response `200`:**

```json
{ "path": "projects/ideas.md", "size": 57 }
```

`size` is the number of bytes written. Note: the returned `path` includes the
`.md` suffix that may have been appended, so use it as the canonical key.

```sh
curl -X PUT "http://localhost:6767/api/note?path=projects/ideas.md" \
  -H "Content-Type: text/markdown" \
  --data-binary $'# Ideas\n\nSome **markdown** content.'
```

### 4. Delete a note

```
DELETE /api/note?path=<note-path>
```

Deletes the note **and cascades**: all images/attachments uploaded for this note
(stored under its prefix) are removed too.

**Response `200`:** `{ "status": "deleted" }`

```sh
curl -X DELETE "http://localhost:6767/api/note?path=projects/ideas.md"
```

### 5. Create a directory

```
POST /api/dir?path=<dir-path>
```

Creates an (otherwise empty) directory so it appears in the tree. Not required
before writing a note — only useful to make an empty folder.

**Response `200`:** `{ "status": "created", "path": "projects/sub/" }`

```sh
curl -X POST "http://localhost:6767/api/dir?path=projects/sub"
```

### 6. Delete a directory

```
DELETE /api/dir?path=<dir-path>
```

Deletes the directory and **everything under it**: all notes within, and all
images/attachments belonging to those notes.

**Response `200`:** `{ "status": "deleted" }`

```sh
curl -X DELETE "http://localhost:6767/api/dir?path=projects"
```

### 7. Upload an image or file attachment

```
POST /api/blob          (multipart/form-data)
```

| form field | required | description                                                |
| ---------- | -------- | ---------------------------------------------------------- |
| `file`     | yes      | the file to upload                                         |
| `note`     | no       | path of the owning note (e.g. `projects/ideas.md`). The blob is namespaced under this note and deleted with it. If omitted, it goes under `_unfiled/`. |

Max upload size: 64 MiB.

**Response `200`:**

```json
{
  "key":  "projects/ideas/3d8f2223-…-diagram.png",
  "url":  "/api/blob?key=projects/ideas/3d8f2223-…-diagram.png",
  "name": "diagram.png",
  "size": 20481
}
```

Insert `url` into the note's markdown — image: `![diagram](«url»)`, file link:
`[diagram.png](«url»)` — then save the note with `PUT /api/note`.

```sh
curl -F "file=@diagram.png" -F "note=projects/ideas.md" \
  http://localhost:6767/api/blob
```

### 8. Fetch an image or file

```
GET /api/blob?key=<blob-key>
```

Streams the raw bytes with the stored `Content-Type`. Use the `key` (or `url`)
returned by the upload, or any `/api/blob?key=...` link found in a note's markdown.
`404` if the key does not exist.

```sh
curl "http://localhost:6767/api/blob?key=projects/ideas/3d8f2223-…-diagram.png" -o diagram.png
```

### 9. Content search

```
GET /api/search?q=<query>
```

Case-insensitive full-text search across the content of all `.md` notes. Returns
the first matching line per note.

| query | required | description            |
| ----- | -------- | ---------------------- |
| `q`   | yes      | search string (`400` if empty) |

**Response `200`** — array of matches:

| field     | type   | description                          |
| --------- | ------ | ------------------------------------ |
| `path`    | string | note key containing the match        |
| `snippet` | string | the matching line (trimmed, ≤240 chars) |
| `line`    | number | 1-based line number of the match     |

```json
[
  { "path": "projects/ideas.md", "snippet": "searchable CONTENT here", "line": 3 }
]
```

```sh
curl "http://localhost:6767/api/search?q=content"
```

---

## Typical agent workflows

**Read everything relevant to a topic**
1. `GET /api/search?q=<topic>` → list of `{path, snippet, line}`.
2. For each `path`, `GET /api/note?path=<path>` → full content.

**Browse the whole knowledge base**
1. `GET /api/tree` → all notes/dirs.
2. `GET /api/note?path=...` for the ones you need.

**Create a note with an image**
1. `POST /api/blob` with `file` + `note=<intended note path>` → get `url`.
2. `PUT /api/note?path=<note path>` with markdown that embeds `![](«url»)`.
   (You can create the note first or upload first — the `note` field just needs
   to match the note's final path so cleanup cascades correctly.)

**Update a note** — read it (`GET /api/note`), modify the markdown, write it back
(`PUT /api/note`) using the same `path`. PUT replaces the whole file, so include
the full intended content, not a diff.
