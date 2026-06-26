import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";

const CONTEXT = 5; // lines of context shown on each side of a match

interface Line {
  n: number; // 1-based line number
  text: string;
  match: boolean;
}
interface Block {
  lines: Line[];
}
interface FileResult {
  path: string;
  count: number; // number of matching lines
  blocks: Block[];
}

// Build merged ±CONTEXT context blocks for one file's content.
function buildBlocks(content: string, q: string): { count: number; blocks: Block[] } {
  const lines = content.split("\n");
  const needle = q.toLowerCase();
  const hits: number[] = []; // 0-based indices of matching lines
  lines.forEach((ln, i) => {
    if (ln.toLowerCase().includes(needle)) hits.push(i);
  });
  if (hits.length === 0) return { count: 0, blocks: [] };

  // Each hit expands to a ±CONTEXT window; merge windows that overlap or touch
  // (so matches within CONTEXT lines collapse into a single block).
  const ranges: [number, number][] = [];
  for (const h of hits) {
    const start = Math.max(0, h - CONTEXT);
    const end = Math.min(lines.length - 1, h + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  const hitSet = new Set(hits);
  const blocks: Block[] = ranges.map(([s, e]) => ({
    lines: Array.from({ length: e - s + 1 }, (_, k) => {
      const i = s + k;
      return { n: i + 1, text: lines[i], match: hitSet.has(i) };
    }),
  }));
  return { count: hits.length, blocks };
}

export default function Search({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (path: string) => void;
}) {
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const matches = await api.search(q);
        const paths = [...new Set(matches.map((m) => m.path))];
        const files = await Promise.all(
          paths.map(async (path): Promise<FileResult | null> => {
            const note = await api.getNote(path);
            const { count, blocks } = buildBlocks(note.content, q);
            if (count === 0) return null;
            return { path, count, blocks };
          }),
        );
        if (cancelled) return;
        setResults(files.filter((f): f is FileResult => f !== null));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (!query.trim()) {
    return (
      <div className="empty">
        <div className="empty-card">
          <h2>Search your notes</h2>
          <p>Type a query in the bar above and press Enter.</p>
        </div>
      </div>
    );
  }

  const total = results?.reduce((n, r) => n + r.count, 0) ?? 0;

  return (
    <div className="searchpage">
      <div className="searchpage-head">
        {loading
          ? "Searching…"
          : `${total} match${total === 1 ? "" : "es"} in ${
              results?.length ?? 0
            } file${results?.length === 1 ? "" : "s"} for “${query.trim()}”`}
      </div>

      {error && <div className="error">{error}</div>}

      {!loading && results && results.length === 0 && !error && (
        <div className="searchpage-empty">No matches found.</div>
      )}

      <div className="search-files">
        {results?.map((r) => (
          <FileCard key={r.path} result={r} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function FileCard({
  result,
  onOpen,
}: {
  result: FileResult;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="search-file">
      <div className="search-file-head">
        <button
          className="search-file-open"
          onClick={() => onOpen(result.path)}
          title="Open note"
        >
          <span className="search-file-path">{result.path}</span>
        </button>
        <span className="search-file-count">{result.count}</span>
        <button
          className={`search-file-toggle${open ? " open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="chev">▸</span>
          {open ? "Hide content" : "Display content"}
        </button>
      </div>

      {open && (
        <div className="search-file-body">
          {result.blocks.map((b, bi) => (
            <div key={bi} className="search-block">
              {bi > 0 && <div className="search-gap" />}
              <div
                className="search-snippet markdown-body"
                onClick={(e) => {
                  // Let links inside the rendered markdown work; clicking
                  // anywhere else in the snippet opens the note.
                  if (!(e.target as HTMLElement).closest("a")) {
                    onOpen(result.path);
                  }
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {b.lines.map((ln) => ln.text).join("\n")}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
