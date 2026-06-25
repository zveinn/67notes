package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sort"
	"strings"
	"sync"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Store wraps a MinIO client and the two buckets this app uses.
type Store struct {
	client     *minio.Client
	notes      string // bucket for .md notes
	blobs      string // bucket for images and file attachments
	searchPool int    // max concurrent object reads during content search
}

// NewStore creates a MinIO-backed store and ensures both buckets exist.
func NewStore(ctx context.Context, endpoint, accessKey, secretKey, notesBucket, blobsBucket string, useSSL bool) (*Store, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}

	s := &Store{
		client:     client,
		notes:      notesBucket,
		blobs:      blobsBucket,
		searchPool: 24,
	}

	for _, b := range []string{notesBucket, blobsBucket} {
		ok, err := client.BucketExists(ctx, b)
		if err != nil {
			return nil, err
		}
		if !ok {
			if err := client.MakeBucket(ctx, b, minio.MakeBucketOptions{}); err != nil {
				return nil, err
			}
		}
	}
	return s, nil
}

// ObjectInfo is a lightweight entry returned to the UI for tree building.
type ObjectInfo struct {
	Path         string `json:"path"`
	Size         int64  `json:"size"`
	LastModified string `json:"lastModified"`
	IsDir        bool   `json:"isDir"`
}

const dirPlaceholder = ".keep"

// ListNotes returns every object in the notes bucket (recursive). The UI uses
// this to build the directory tree on load. Directory placeholders (.keep) are
// surfaced as explicit empty directories so empty folders still appear.
func (s *Store) ListNotes(ctx context.Context) ([]ObjectInfo, error) {
	out := make([]ObjectInfo, 0, 256)
	seenDirs := map[string]bool{}

	objCh := s.client.ListObjects(ctx, s.notes, minio.ListObjectsOptions{
		Recursive: true,
	})
	for obj := range objCh {
		if obj.Err != nil {
			return nil, obj.Err
		}
		key := obj.Key

		// Register all parent directories so the tree is complete.
		for _, d := range parentDirs(key) {
			if !seenDirs[d] {
				seenDirs[d] = true
				out = append(out, ObjectInfo{Path: d, IsDir: true})
			}
		}

		// A placeholder marks an (otherwise empty) directory; don't list it as a file.
		if strings.HasSuffix(key, "/"+dirPlaceholder) || key == dirPlaceholder {
			continue
		}

		out = append(out, ObjectInfo{
			Path:         key,
			Size:         obj.Size,
			LastModified: obj.LastModified.UTC().Format("2006-01-02T15:04:05Z"),
			IsDir:        false,
		})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// parentDirs returns all ancestor directory prefixes (with trailing slash) of a key.
// "a/b/c.md" -> ["a/", "a/b/"].
func parentDirs(key string) []string {
	var dirs []string
	parts := strings.Split(key, "/")
	if len(parts) <= 1 {
		return dirs
	}
	prefix := ""
	for i := 0; i < len(parts)-1; i++ {
		prefix += parts[i] + "/"
		dirs = append(dirs, prefix)
	}
	return dirs
}

// GetNote fetches a note's raw bytes.
func (s *Store) GetNote(ctx context.Context, key string) ([]byte, error) {
	return s.getObject(ctx, s.notes, key)
}

// PutNote writes a note. contentType defaults to text/markdown.
func (s *Store) PutNote(ctx context.Context, key string, data []byte) error {
	_, err := s.client.PutObject(ctx, s.notes, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: "text/markdown; charset=utf-8"})
	return err
}

// DeleteNote removes a note.
func (s *Store) DeleteNote(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.notes, key, minio.RemoveObjectOptions{})
}

// CreateDir writes a zero-byte placeholder so an empty directory persists in S3.
func (s *Store) CreateDir(ctx context.Context, prefix string) error {
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	key := prefix + dirPlaceholder
	_, err := s.client.PutObject(ctx, s.notes, key, bytes.NewReader(nil), 0,
		minio.PutObjectOptions{ContentType: "application/octet-stream"})
	return err
}

// DeleteDir removes every object under a prefix.
func (s *Store) DeleteDir(ctx context.Context, prefix string) error {
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	objCh := s.client.ListObjects(ctx, s.notes, minio.ListObjectsOptions{Prefix: prefix, Recursive: true})
	errCh := s.client.RemoveObjects(ctx, s.notes, objCh, minio.RemoveObjectsOptions{})
	for e := range errCh {
		if e.Err != nil {
			return e.Err
		}
	}
	return nil
}

// PutBlob stores an image or file attachment in the blobs bucket.
func (s *Store) PutBlob(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := s.client.PutObject(ctx, s.blobs, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// DeleteBlobPrefix removes every blob under a prefix in the images bucket.
// Used to cascade-delete a note's (or folder's) images.
func (s *Store) DeleteBlobPrefix(ctx context.Context, prefix string) error {
	if prefix == "" {
		return nil
	}
	objCh := s.client.ListObjects(ctx, s.blobs, minio.ListObjectsOptions{Prefix: prefix, Recursive: true})
	errCh := s.client.RemoveObjects(ctx, s.blobs, objCh, minio.RemoveObjectsOptions{})
	for e := range errCh {
		if e.Err != nil {
			return e.Err
		}
	}
	return nil
}

// GetBlob streams a blob and reports its content type.
func (s *Store) GetBlob(ctx context.Context, key string) (io.ReadCloser, string, error) {
	obj, err := s.client.GetObject(ctx, s.blobs, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", err
	}
	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, "", err
	}
	return obj, info.ContentType, nil
}

func (s *Store) getObject(ctx context.Context, bucket, key string) ([]byte, error) {
	obj, err := s.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	return io.ReadAll(obj)
}

// SearchMatch is one content-search hit.
type SearchMatch struct {
	Path    string `json:"path"`
	Snippet string `json:"snippet"`
	Line    int    `json:"line"`
}

// Search performs a case-insensitive content search across all .md notes.
// It lists keys, then reads matching objects concurrently (bounded pool) for speed.
func (s *Store) Search(ctx context.Context, query string) ([]SearchMatch, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("empty query")
	}
	needle := strings.ToLower(query)

	// Collect candidate keys first.
	var keys []string
	objCh := s.client.ListObjects(ctx, s.notes, minio.ListObjectsOptions{Recursive: true})
	for obj := range objCh {
		if obj.Err != nil {
			return nil, obj.Err
		}
		if strings.HasSuffix(strings.ToLower(obj.Key), ".md") {
			keys = append(keys, obj.Key)
		}
	}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		matches []SearchMatch
		sem     = make(chan struct{}, s.searchPool)
	)
	for _, k := range keys {
		wg.Add(1)
		sem <- struct{}{}
		go func(key string) {
			defer wg.Done()
			defer func() { <-sem }()

			data, err := s.getObject(ctx, s.notes, key)
			if err != nil {
				return
			}
			if m, ok := findMatch(key, data, needle); ok {
				mu.Lock()
				matches = append(matches, m)
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()

	sort.Slice(matches, func(i, j int) bool { return matches[i].Path < matches[j].Path })
	return matches, nil
}

// findMatch returns the first matching line (case-insensitive) and a trimmed snippet.
func findMatch(key string, data []byte, needle string) (SearchMatch, bool) {
	lower := bytes.ToLower(data)
	idx := bytes.Index(lower, []byte(needle))
	if idx < 0 {
		return SearchMatch{}, false
	}
	// Determine line number and extract the surrounding line for the snippet.
	line := 1 + bytes.Count(data[:idx], []byte("\n"))
	start := bytes.LastIndexByte(data[:idx], '\n') + 1
	end := idx
	if nl := bytes.IndexByte(data[idx:], '\n'); nl >= 0 {
		end = idx + nl
	} else {
		end = len(data)
	}
	snippet := strings.TrimSpace(string(data[start:end]))
	if len(snippet) > 240 {
		snippet = snippet[:240] + "…"
	}
	return SearchMatch{Path: key, Snippet: snippet, Line: line}, true
}
