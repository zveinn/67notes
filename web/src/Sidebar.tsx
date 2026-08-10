import { useCallback, useState } from "react";
import type { TreeNode } from "./tree";

const FOLD_KEY = "sidebarFold";

/** path → open; missing keys default to open (true). */
function readFold(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLD_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return {};
}

interface Props {
  tree: TreeNode;
  activePath: string;
  onOpen: (path: string) => void;
  onNewNote: (dirPrefix: string) => void;
  onNewFolder: (dirPrefix: string) => void;
  onDeleteDir: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
}

export default function Sidebar(props: Props) {
  const { tree, activePath, onNewNote, onNewFolder } = props;
  const [fold, setFold] = useState<Record<string, boolean>>(readFold);

  const isOpen = useCallback(
    (path: string) => fold[path] !== false,
    [fold],
  );

  const toggleFold = useCallback((path: string) => {
    setFold((prev) => {
      const nextOpen = prev[path] === false;
      const next = { ...prev, [path]: nextOpen };
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">
          <span className="brand-mark">67</span>notes
        </span>
        <div className="actions">
          <button title="New note" onClick={() => onNewNote("")}>
            ＋
          </button>
          <button title="New folder" onClick={() => onNewFolder("")}>
            📁
          </button>
        </div>
      </div>

      <div className="tree-scroll">
        <ul className="tree">
          {tree.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={0}
              activePath={activePath}
              isOpen={isOpen}
              onToggleFold={toggleFold}
              onOpen={props.onOpen}
              onNewNote={props.onNewNote}
              onNewFolder={props.onNewFolder}
              onDeleteDir={props.onDeleteDir}
              onRenameFile={props.onRenameFile}
              onDeleteFile={props.onDeleteFile}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
}

function TreeItem({
  node,
  depth,
  activePath,
  isOpen,
  onToggleFold,
  onOpen,
  onNewNote,
  onNewFolder,
  onDeleteDir,
  onRenameFile,
  onDeleteFile,
}: {
  node: TreeNode;
  depth: number;
  activePath: string;
  isOpen: (path: string) => boolean;
  onToggleFold: (path: string) => void;
} & Pick<
  Props,
  | "onOpen"
  | "onNewNote"
  | "onNewFolder"
  | "onDeleteDir"
  | "onRenameFile"
  | "onDeleteFile"
>) {
  const open = isOpen(node.path);
  const pad = { paddingLeft: 6 + depth * 12 };

  if (node.isDir) {
    return (
      <li>
        <div className="row dir" style={pad}>
          <button className="twisty" onClick={() => onToggleFold(node.path)}>
            {open ? "▾" : "▸"}
          </button>
          <span className="label" onClick={() => onToggleFold(node.path)}>
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
                isOpen={isOpen}
                onToggleFold={onToggleFold}
                onOpen={onOpen}
                onNewNote={onNewNote}
                onNewFolder={onNewFolder}
                onDeleteDir={onDeleteDir}
                onRenameFile={onRenameFile}
                onDeleteFile={onDeleteFile}
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
        <span className="row-actions">
          <button
            title="Rename note"
            onClick={(e) => {
              e.stopPropagation();
              onRenameFile(node.path);
            }}
          >
            ✎
          </button>
          <button
            title="Delete note"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFile(node.path);
            }}
          >
            🗑
          </button>
        </span>
      </div>
    </li>
  );
}
