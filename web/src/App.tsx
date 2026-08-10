import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { buildTree, type TreeNode } from "./tree";
import Sidebar from "./Sidebar";
import Editor from "./Editor";
import Search from "./Search";
import ChatPanel from "./ChatPanel";

type Theme = "light" | "dark";

function readRoute() {
  return {
    path: window.location.pathname,
    query: new URLSearchParams(window.location.search).get("q") ?? "",
  };
}

export default function App() {
  const [tree, setTree] = useState<TreeNode>({
    name: "",
    path: "",
    isDir: true,
    children: [],
  });
  const [activePath, setActivePath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingNote, setLoadingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Undo/redo history for the active note. Rapid edits are coalesced into one
  // entry so Ctrl+Z steps back by word-chunks, not single keystrokes.
  const history = useRef<{ past: string[]; future: string[]; ts: number }>({
    past: [],
    future: [],
    ts: 0,
  });
  const resetHistory = () => {
    history.current = { past: [], future: [], ts: 0 };
  };

  // Minimal client-side routing: "/" (home) and "/search?q=…".
  const [route, setRoute] = useState(readRoute);
  const [searchInput, setSearchInput] = useState(route.query);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setRoute(readRoute());
  }, []);

  // Keep the search box in sync when the URL query changes (e.g. back button).
  useEffect(() => {
    setSearchInput(route.query);
  }, [route.query]);

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "dark",
  );

  const [chatOpen, setChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(
    () => Number(localStorage.getItem("chatWidth")) || 380,
  );

  // Clamp + persist the panel width as the user drags its left border.
  const resizeChat = useCallback((px: number) => {
    const w = Math.max(280, Math.min(720, px));
    setChatWidth(w);
    localStorage.setItem("chatWidth", String(w));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const dirty = content !== savedContent;

  const refreshTree = useCallback(async () => {
    try {
      const items = await api.tree();
      setTree(buildTree(items));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const openNote = useCallback(
    async (path: string) => {
      if (dirty && !confirm("Discard unsaved changes?")) return;
      setLoadingNote(true);
      setError(null);
      try {
        const note = await api.getNote(path);
        setActivePath(path);
        localStorage.setItem("activePath", path);
        setContent(note.content);
        setSavedContent(note.content);
        resetHistory();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingNote(false);
      }
    },
    [dirty],
  );

  // setContent wrapper that records history for undo/redo.
  const handleChange = useCallback(
    (next: string) => {
      const h = history.current;
      const now = Date.now();
      if (h.past.length === 0 || now - h.ts > 350) {
        h.past.push(content);
        if (h.past.length > 300) h.past.shift();
      }
      h.ts = now;
      h.future = [];
      setContent(next);
    },
    [content],
  );

  const undo = useCallback(() => {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(content);
    h.ts = 0; // next edit starts a fresh history entry
    setContent(h.past.pop() as string);
  }, [content]);

  const redo = useCallback(() => {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(content);
    h.ts = 0;
    setContent(h.future.pop() as string);
  }, [content]);

  const cancelEdit = useCallback(() => {
    if (content === savedContent) return;
    if (!confirm("Discard unsaved changes?")) return;
    setContent(savedContent);
    resetHistory();
  }, [content, savedContent]);

  // Re-open the note we were last viewing across browser refreshes.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const last = localStorage.getItem("activePath");
    if (last) void openNote(last);
  }, [openNote]);

  const saveNote = useCallback(async () => {
    if (!activePath) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveNote(activePath, content);
      setSavedContent(content);
      await refreshTree();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [activePath, content, refreshTree]);

  const newNote = useCallback(
    async (dirPrefix: string) => {
      const name = prompt("New note name (e.g. ideas.md):");
      if (!name) return;
      let path = dirPrefix + name.trim();
      if (!path.toLowerCase().endsWith(".md")) path += ".md";
      try {
        await api.saveNote(path, `# ${name.replace(/\.md$/i, "")}\n\n`);
        await refreshTree();
        await openNote(path.endsWith(".md") ? path : path + ".md");
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refreshTree, openNote],
  );

  const newFolder = useCallback(
    async (dirPrefix: string) => {
      const name = prompt("New folder name:");
      if (!name) return;
      try {
        await api.createDir(dirPrefix + name.trim());
        await refreshTree();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refreshTree],
  );

  const deleteNote = useCallback(async () => {
    if (!activePath) return;
    if (!confirm(`Delete ${activePath}?`)) return;
    try {
      await api.deleteNote(activePath);
      setActivePath("");
      localStorage.removeItem("activePath");
      setContent("");
      setSavedContent("");
      await refreshTree();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [activePath, refreshTree]);

  const deleteFile = useCallback(
    async (path: string) => {
      if (!confirm(`Delete ${path}?`)) return;
      try {
        await api.deleteNote(path);
        if (activePath === path) {
          setActivePath("");
          localStorage.removeItem("activePath");
          setContent("");
          setSavedContent("");
        }
        await refreshTree();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activePath, refreshTree],
  );

  const renameNote = useCallback(
    async (path: string) => {
      const base = path.split("/").pop() ?? path;
      const input = prompt("Rename note (renaming drops attached images):", base);
      if (!input) return;
      const name = input.trim();
      if (!name || name === base) return;
      const dir = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/") + 1)
        : "";
      let dest = dir + name;
      if (!dest.toLowerCase().endsWith(".md")) dest += ".md";
      try {
        const note = await api.getNote(path);
        await api.saveNote(dest, note.content);
        await api.deleteNote(path);
        await refreshTree();
        if (activePath === path) await openNote(dest);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activePath, refreshTree, openNote],
  );

  const deleteDir = useCallback(
    async (path: string) => {
      if (!confirm(`Delete folder ${path} and everything in it?`)) return;
      try {
        await api.deleteDir(path);
        if (activePath.startsWith(path)) {
          setActivePath("");
          localStorage.removeItem("activePath");
          setContent("");
          setSavedContent("");
        }
        await refreshTree();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activePath, refreshTree],
  );

  const submitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = searchInput.trim();
      if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
      else navigate("/");
    },
    [searchInput, navigate],
  );

  const openFromSearch = useCallback(
    (path: string) => {
      navigate("/");
      void openNote(path);
    },
    [navigate, openNote],
  );

  return (
    <div
      className={chatOpen ? "app chat-open" : "app"}
      style={{ "--chat-w": `${chatWidth}px` } as React.CSSProperties}
    >
      <Sidebar
        tree={tree}
        activePath={activePath}
        onOpen={openFromSearch}
        onNewNote={newNote}
        onNewFolder={newFolder}
        onDeleteDir={deleteDir}
        onRenameFile={renameNote}
        onDeleteFile={deleteFile}
      />

      <main className="main">
        <div className="topbar">
          <form className="topsearch" onSubmit={submitSearch}>
            <div className="search-field">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                placeholder="Search notes…  (Enter)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </form>
          <div className="grow">
            {error && <span className="error">{error}</span>}
          </div>
          <button
            className={chatOpen ? "theme-toggle active" : "theme-toggle"}
            title="Ask Claude"
            onClick={() => setChatOpen((v) => !v)}
          >
            ?
          </button>
          <button
            className="theme-toggle"
            title="Toggle theme"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>

        {route.path === "/search" ? (
          <Search query={route.query} onOpen={openFromSearch} />
        ) : activePath ? (
          loadingNote ? (
            <div className="empty">Loading…</div>
          ) : (
            <Editor
              path={activePath}
              content={content}
              dirty={dirty}
              saving={saving}
              onChange={handleChange}
              onSave={saveNote}
              onCancel={cancelEdit}
              onUndo={undo}
              onRedo={redo}
              onDelete={deleteNote}
            />
          )
        ) : (
          <div className="empty">
            <div className="empty-card">
              <div className="empty-mark">67</div>
              <h2>Your notes, beautifully kept</h2>
              <p>Select a note from the sidebar, or create a new one to start writing.</p>
            </div>
          </div>
        )}
      </main>

      {chatOpen && (
        <ChatPanel onClose={() => setChatOpen(false)} onResize={resizeChat} />
      )}
    </div>
  );
}
