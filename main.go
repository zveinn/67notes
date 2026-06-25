package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

//go:embed all:web/dist
var embeddedUI embed.FS

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	var (
		addr        = flag.String("addr", env("ADDR", ":6767"), "HTTP listen address")
		endpoint    = flag.String("minio", env("MINIO_ENDPOINT", "127.0.0.1:7778"), "MinIO endpoint host:port")
		accessKey   = flag.String("access-key", env("MINIO_ACCESS_KEY", "minioadmin"), "MinIO access key")
		secretKey   = flag.String("secret-key", env("MINIO_SECRET_KEY", "minioadmin"), "MinIO secret key")
		notesBucket = flag.String("notes-bucket", env("NOTES_BUCKET", "notes"), "bucket for .md notes")
		blobsBucket = flag.String("blobs-bucket", env("IMAGES_BUCKET", "notes-images"), "bucket for images/files")
		useSSL      = flag.Bool("ssl", env("MINIO_SSL", "") == "true", "use TLS for MinIO")
	)
	flag.Parse()

	ctx := context.Background()
	store, err := NewStore(ctx, *endpoint, *accessKey, *secretKey, *notesBucket, *blobsBucket, *useSSL)
	if err != nil {
		log.Fatalf("init storage: %v", err)
	}

	api := &apiServer{store: store}

	mux := http.NewServeMux()
	mux.Handle("/api/", api.routes())
	mux.Handle("/", spaHandler())

	srv := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("67notes listening on %s (minio=%s notes=%s images=%s)", *addr, *endpoint, *notesBucket, *blobsBucket)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// spaHandler serves the embedded React build, falling back to index.html so
// client-side routing works.
func spaHandler() http.Handler {
	dist, err := fs.Sub(embeddedUI, "web/dist")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}
	fileServer := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(dist, p); err != nil {
			// Unknown path -> serve index.html for SPA routing.
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			http.ServeFileFS(w, r2, dist, "index.html")
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}
