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
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingNote(false);
      }
    },
    [dirty],
  );

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
              onChange={setContent}
              onSave={saveNote}
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
