import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";

type ViewMode = "edit" | "split" | "preview";

interface Props {
  path: string;
  content: string;
  dirty: boolean;
  saving: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
}

export default function Editor({
  path,
  content,
  dirty,
  saving,
  onChange,
  onSave,
  onCancel,
  onUndo,
  onRedo,
  onDelete,
}: Props) {
  const [view, setView] = useState<ViewMode>("preview");
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Insert text at the current cursor position (or replace selection).
  const insertAtCursor = useCallback(
    (snippet: string) => {
      const el = textareaRef.current;
      if (!el) {
        onChange(content + snippet);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = content.slice(0, start) + snippet + content.slice(end);
      onChange(next);
      // Restore caret after React re-renders.
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [content, onChange],
  );

  const uploadAndInsert = useCallback(
    async (file: File, asImage: boolean) => {
      setUploading(true);
      try {
        const res = await api.upload(file, path);
        const label = res.name || file.name;
        const md = asImage
          ? `![${label}](${res.url})`
          : `[${label}](${res.url})`;
        insertAtCursor(md + "\n");
      } catch (e) {
        alert("Upload failed: " + (e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [insertAtCursor, path],
  );

  // Keyboard shortcuts: Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, redo (Shift+Z / Y).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (dirty && !saving) onSave();
      } else if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, saving, onSave, onUndo, onRedo]);

  // Paste images directly from clipboard.
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const file = Array.from(e.clipboardData.items)
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void uploadAndInsert(file, true);
      }
    },
    [uploadAndInsert],
  );

  // Support Tab indentation in the textarea.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      insertAtCursor("  ");
    }
  };

  const wrapSelection = (before: string, after = before) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const next =
      content.slice(0, start) + before + selected + after + content.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };

  return (
    <div className="editor">
      <div className="toolbar">
        <span className="path" title={path}>
          {path}
          {dirty ? <span className="dot"> ●</span> : ""}
        </span>
        <div className="spacer" />

        {view !== "preview" && (
          <>
            <button title="Bold" onClick={() => wrapSelection("**")}>
              <b>B</b>
            </button>
            <button title="Italic" onClick={() => wrapSelection("*")}>
              <i>I</i>
            </button>
            <button title="Inline code" onClick={() => wrapSelection("`")}>
              {"<>"}
            </button>
            <button title="Heading" onClick={() => insertAtCursor("\n## ")}>
              H
            </button>
            <button title="Link" onClick={() => insertAtCursor("[text](url)")}>
              🔗
            </button>

            <div className="sep" />

            <label className="filebtn" title="Insert image">
              🖼️
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadAndInsert(f, true);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="filebtn" title="Attach file">
              📎
              <input
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadAndInsert(f, false);
                  e.target.value = "";
                }}
              />
            </label>
          </>
        )}

        <div className="spacer" />

        <div className="viewtoggle">
          {(["edit", "split", "preview"] as ViewMode[]).map((m) => (
            <button
              key={m}
              className={view === m ? "active" : ""}
              onClick={() => setView(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="sep" />

        {dirty && (
          <button className="cancel" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button
          className="primary"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="danger" title="Delete note" onClick={onDelete}>
          🗑
        </button>
      </div>

      {uploading && <div className="uploading">Uploading…</div>}

      <div className={`panes ${view}`}>
        {view !== "preview" && (
          <textarea
            ref={textareaRef}
            className="source"
            value={content}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="# Start writing…"
          />
        )}
        {view !== "edit" && (
          <div className="preview markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
