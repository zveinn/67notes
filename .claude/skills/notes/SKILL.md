---
name: notes
description: Read, search, create, and update the user's markdown notes stored in the 67notes server (a Go + MinIO notes app). Use whenever the user asks to look something up in their notes, find/recall a note, jot down or save a note, append to or edit a note, organize folders, or attach an image/file to a note. Talks to the 67notes HTTP API with curl.
allowed-tools: Bash, Read
---

# 67notes

You can browse and edit the user's personal markdown knowledge base through the
67notes HTTP API. The server stores notes as `.md` files (and images/files) in
MinIO; you only ever talk to its HTTP API with `curl`.

## Base URL

Resolve the server base URL as `${NOTES_URL:-http://localhost:6767}`. Always use
this form in commands so the user can override the port:

```bash
BASE="${NOTES_URL:-http://localhost:6767}"
```

If requests fail to connect, tell the user the server isn't reachable and ask
them to start it (`./67notes`, default `:6767`) or set `NOTES_URL` (e.g.
`export NOTES_URL=http://localhost:6767` if they run it on another port).

## How to use this skill

1. **Discover before acting.** To find notes, use `GET /api/search?q=` (full-text,
   case-insensitive) or `GET /api/tree` (full list). Then read specific notes with
   `GET /api/note?path=`.
2. **Read the full API contract** in [reference.md](reference.md) for every
   endpoint's exact inputs/outputs, status codes, and JSON shapes. Consult it
   whenever you're unsure of a field or response.
3. **Editing replaces the whole file.** `PUT /api/note` overwrites the note
   entirely — to append or edit, first `GET` the current content, modify the full
   text, then `PUT` it back to the same `path`.
4. **Confirm destructive actions.** Before `DELETE /api/note` or `DELETE /api/dir`,
   confirm with the user — deleting a note also deletes its attached images, and
   deleting a folder removes every note and image under it.
5. **Report paths back.** When you create/update a note, tell the user the
   canonical `path` returned by the API.

## Quick recipes

Search, then read the top hit:
```bash
BASE="${NOTES_URL:-http://localhost:6767}"
curl -s "$BASE/api/search?q=kubernetes"          # -> [{path, snippet, line}, ...]
curl -s "$BASE/api/note?path=ops/k8s.md"          # -> {path, content}
```

List everything (for browsing / building a tree):
```bash
curl -s "$BASE/api/tree"                          # -> [{path,size,lastModified,isDir}, ...]
```

Create or overwrite a note (body IS the markdown):
```bash
curl -s -X PUT "$BASE/api/note?path=ideas/today.md" \
  -H "Content-Type: text/markdown" \
  --data-binary $'# Today\n\n- first idea\n'
```

Append to a note safely (read, then write the combined content):
```bash
cur=$(curl -s "$BASE/api/note?path=ideas/today.md" | python3 -c 'import sys,json;print(json.load(sys.stdin)["content"])')
printf '%s\n- another idea\n' "$cur" | curl -s -X PUT "$BASE/api/note?path=ideas/today.md" \
  -H "Content-Type: text/markdown" --data-binary @-
```

Attach an image to a note (upload, then embed the returned `url`):
```bash
curl -s -F "file=@diagram.png" -F "note=ideas/today.md" "$BASE/api/blob"
# -> {"key":..., "url":"/api/blob?key=...", "name":"diagram.png", "size":...}
# then PUT the note with markdown containing  ![diagram](<url>)
```

Delete (confirm with the user first):
```bash
curl -s -X DELETE "$BASE/api/note?path=ideas/today.md"   # also removes its images
curl -s -X DELETE "$BASE/api/dir?path=ideas"             # removes the whole folder
```

## Endpoint summary

| Method | Path                  | Purpose                              |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/api/tree`           | List all notes + directories         |
| GET    | `/api/note?path=`     | Read a note's content                |
| PUT    | `/api/note?path=`     | Create/overwrite a note (body = md)  |
| DELETE | `/api/note?path=`     | Delete a note (+ its images)         |
| POST   | `/api/dir?path=`      | Create an empty directory            |
| DELETE | `/api/dir?path=`      | Delete a directory and its contents  |
| POST   | `/api/blob`           | Upload image/file (`file`, `note`)   |
| GET    | `/api/blob?key=`      | Fetch an image/file                  |
| GET    | `/api/search?q=`      | Case-insensitive content search      |

See [reference.md](reference.md) for the full details.
