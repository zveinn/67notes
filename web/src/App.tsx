import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SearchMatch } from "./api";
import { buildTree, type TreeNode } from "./tree";
import Sidebar from "./Sidebar";
import Editor from "./Editor";

type Theme = "light" | "dark";

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

  const [searchResults, setSearchResults] = useState<SearchMatch[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "dark",
  );

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

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await api.search(q);
      setSearchResults(res);
    } catch (e) {
      setError((e as Error).message);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const openFromSearch = useCallback(
    (path: string) => {
      void openNote(path);
    },
    [openNote],
  );

  return (
    <div className="app">
      <Sidebar
        tree={tree}
        activePath={activePath}
        onOpen={openFromSearch}
        onNewNote={newNote}
        onNewFolder={newFolder}
        onDeleteDir={deleteDir}
        onRenameFile={renameNote}
        onDeleteFile={deleteFile}
        onSearch={runSearch}
        searchResults={searchResults}
        searching={searching}
        onClearSearch={() => setSearchResults(null)}
      />

      <main className="main">
        <div className="topbar">
          <div className="grow">
            {error && <span className="error">{error}</span>}
          </div>
          <button
            className="theme-toggle"
            title="Toggle theme"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>

        {activePath ? (
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
    </div>
  );
}
