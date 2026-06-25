package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/minio/minio-go/v7"
)

const maxUpload = 64 << 20 // 64 MiB per uploaded file

type apiServer struct {
	store *Store
}

func (a *apiServer) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tree", a.handleTree)
	mux.HandleFunc("GET /api/note", a.handleGetNote)
	mux.HandleFunc("PUT /api/note", a.handlePutNote)
	mux.HandleFunc("DELETE /api/note", a.handleDeleteNote)
	mux.HandleFunc("POST /api/dir", a.handleCreateDir)
	mux.HandleFunc("DELETE /api/dir", a.handleDeleteDir)
	mux.HandleFunc("POST /api/blob", a.handleUploadBlob)
	mux.HandleFunc("GET /api/blob", a.handleGetBlob)
	mux.HandleFunc("GET /api/search", a.handleSearch)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// cleanKey validates and normalizes an object key from a query param, rejecting
// path traversal and absolute paths.
func cleanKey(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("missing path")
	}
	if strings.HasPrefix(raw, "/") {
		raw = strings.TrimPrefix(raw, "/")
	}
	cleaned := path.Clean(raw)
	if cleaned == "." || strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "../") {
		return "", errors.New("invalid path")
	}
	return cleaned, nil
}

func isNotFound(err error) bool {
	resp := minio.ToErrorResponse(err)
	return resp.Code == "NoSuchKey" || resp.Code == "NoSuchBucket" || resp.StatusCode == http.StatusNotFound
}

func (a *apiServer) handleTree(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.ListNotes(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (a *apiServer) handleGetNote(w http.ResponseWriter, r *http.Request) {
	key, err := cleanKey(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := a.store.GetNote(r.Context(), key)
	if err != nil {
		if isNotFound(err) {
			writeErr(w, http.StatusNotFound, "note not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": key, "content": string(data)})
}

func (a *apiServer) handlePutNote(w http.ResponseWriter, r *http.Request) {
	key, err := cleanKey(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if !strings.HasSuffix(strings.ToLower(key), ".md") {
		key += ".md"
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxUpload))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read body: "+err.Error())
		return
	}
	if err := a.store.PutNote(r.Context(), key, body); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": key, "size": len(body)})
}

func (a *apiServer) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	key, err := cleanKey(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.store.DeleteNote(r.Context(), key); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Cascade: remove every image/file uploaded for this note.
	if err := a.store.DeleteBlobPrefix(r.Context(), noteImagePrefix(key)); err != nil {
		writeErr(w, http.StatusInternalServerError, "note deleted but cleaning images failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *apiServer) handleCreateDir(w http.ResponseWriter, r *http.Request) {
	key, err := cleanKey(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.store.CreateDir(r.Context(), key); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "created", "path": key + "/"})
}

func (a *apiServer) handleDeleteDir(w http.ResponseWriter, r *http.Request) {
	key, err := cleanKey(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.store.DeleteDir(r.Context(), key); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Cascade: images for notes under this folder live under the same prefix.
	prefix := key
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	if err := a.store.DeleteBlobPrefix(r.Context(), prefix); err != nil {
		writeErr(w, http.StatusInternalServerError, "folder deleted but cleaning images failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *apiServer) handleUploadBlob(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		writeErr(w, http.StatusBadRequest, "parse form: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing file field: "+err.Error())
		return
	}
	defer file.Close()

	// Namespace every blob under the owning note's prefix so it is unique to that
	// note and can be cascade-deleted with it. A UUID guarantees uniqueness even
	// for repeated uploads of the same filename within one note.
	prefix := "_unfiled/"
	if note := strings.TrimSpace(r.FormValue("note")); note != "" {
		key, err := cleanKey(note)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid note: "+err.Error())
			return
		}
		prefix = noteImagePrefix(key)
	}
	key := prefix + newUUID() + "-" + sanitizeName(header.Filename)

	contentType := header.Header.Get("Content-Type")
	if err := a.store.PutBlob(r.Context(), key, file, header.Size, contentType); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"key":  key,
		"url":  "/api/blob?key=" + key,
		"name": header.Filename,
		"size": header.Size,
	})
}

func (a *apiServer) handleGetBlob(w http.ResponseWriter, r *http.Request) {
	key, err := cleanKey(r.URL.Query().Get("key"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	rc, contentType, err := a.store.GetBlob(r.Context(), key)
	if err != nil {
		if isNotFound(err) {
			writeErr(w, http.StatusNotFound, "blob not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rc.Close()
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = io.Copy(w, rc)
}

func (a *apiServer) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	matches, err := a.store.Search(r.Context(), q)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, matches)
}

// noteImagePrefix maps a note key to the prefix under which its blobs live in
// the images bucket: "projects/welcome.md" -> "projects/welcome/". Deleting the
// note (or its parent folder) removes everything under this prefix.
func noteImagePrefix(noteKey string) string {
	if len(noteKey) >= 3 && strings.EqualFold(noteKey[len(noteKey)-3:], ".md") {
		noteKey = noteKey[:len(noteKey)-3]
	}
	return noteKey + "/"
}

// newUUID returns a random RFC-4122 v4 UUID string.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// sanitizeName strips path components and unsafe characters from an upload name.
func sanitizeName(name string) string {
	name = path.Base(name)
	name = strings.ReplaceAll(name, " ", "_")
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		out = "file"
	}
	return out
}
