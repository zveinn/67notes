import { useState } from "react";
import type { SearchMatch } from "./api";
import type { TreeNode } from "./tree";

interface Props {
  tree: TreeNode;
  activePath: string;
  onOpen: (path: string) => void;
  onNewNote: (dirPrefix: string) => void;
  onNewFolder: (dirPrefix: string) => void;
  onDeleteDir: (path: string) => void;
  onSearch: (q: string) => void;
  searchResults: SearchMatch[] | null;
  searching: boolean;
  onClearSearch: () => void;
}

export default function Sidebar(props: Props) {
  const {
    tree,
    activePath,
    onOpen,
    onNewNote,
    onNewFolder,
    onSearch,
    searchResults,
    searching,
    onClearSearch,
  } = props;
  const [query, setQuery] = useState("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onSearch(q);
    else onClearSearch();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">67notes</span>
        <div className="actions">
          <button title="New note" onClick={() => onNewNote("")}>
            ＋
          </button>
          <button title="New folder" onClick={() => onNewFolder("")}>
            📁
          </button>
        </div>
      </div>

      <form className="search" onSubmit={submitSearch}>
        <input
          type="search"
          placeholder="Search content…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value === "") onClearSearch();
          }}
        />
      </form>

      <div className="tree-scroll">
        {searchResults !== null ? (
          <SearchResults
            results={searchResults}
            searching={searching}
            onOpen={onOpen}
            onClear={() => {
              setQuery("");
              onClearSearch();
            }}
          />
        ) : (
          <ul className="tree">
            {tree.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={0}
                activePath={activePath}
                onOpen={props.onOpen}
                onNewNote={props.onNewNote}
                onNewFolder={props.onNewFolder}
                onDeleteDir={props.onDeleteDir}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function SearchResults({
  results,
  searching,
  onOpen,
  onClear,
}: {
  results: SearchMatch[];
  searching: boolean;
  onOpen: (path: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="search-results">
      <div className="search-head">
        <span>
          {searching ? "Searching…" : `${results.length} result(s)`}
        </span>
        <button onClick={onClear}>clear</button>
      </div>
      {results.map((r) => (
        <button key={r.path} className="result" onClick={() => onOpen(r.path)}>
          <div className="result-path">{r.path}</div>
          <div className="result-snippet">
            <span className="lineno">L{r.line}</span> {r.snippet}
          </div>
        </button>
      ))}
    </div>
  );
}

function TreeItem({
  node,
  depth,
  activePath,
  onOpen,
  onNewNote,
  onNewFolder,
  onDeleteDir,
}: {
  node: TreeNode;
  depth: number;
  activePath: string;
} & Pick<Props, "onOpen" | "onNewNote" | "onNewFolder" | "onDeleteDir">) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: 6 + depth * 12 };

  if (node.isDir) {
    return (
      <li>
        <div className="row dir" style={pad}>
          <button className="twisty" onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"}
          </button>
          <span className="label" onClick={() => setOpen((o) => !o)}>
            {node.name}
          </span>
          <span className="row-actions">
            <button
              title="New note here"
              onClick={() => onNewNote(node.path)}
            >
              ＋
            </button>
            <button
              title="New subfolder"
              onClick={() => onNewFolder(node.path)}
            >
              📁
            </button>
            <button
              title="Delete folder"
              onClick={() => onDeleteDir(node.path)}
            >
              🗑
            </button>
          </span>
        </div>
        {open && (
          <ul>
            {node.children.map((c) => (
              <TreeItem
                key={c.path}
                node={c}
                depth={depth + 1}
                activePath={activePath}
                onOpen={onOpen}
                onNewNote={onNewNote}
                onNewFolder={onNewFolder}
                onDeleteDir={onDeleteDir}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <div
        className={`row file ${activePath === node.path ? "active" : ""}`}
        style={pad}
        onClick={() => onOpen(node.path)}
        title={node.path}
      >
        <span className="label">{node.name}</span>
      </div>
    </li>
  );
}
