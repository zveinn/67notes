.PHONY: all web build run dev clean

BINARY := 67notes

# Build the React UI then the Go binary (UI embedded into the binary).
all: build

web:
	cd web && npm install && npm run build

build: web
	go build -o $(BINARY) .

# Run the built binary (defaults: ADDR=:6767, MinIO at 127.0.0.1:7778).
run: build
	./$(BINARY)

# Frontend dev server with hot reload; proxies /api to the Go backend on :6767.
# Run `make build && ./67notes` in another terminal alongside this.
dev:
	cd web && npm run dev

clean:
	rm -f $(BINARY)
	rm -rf web/dist web/node_modules
