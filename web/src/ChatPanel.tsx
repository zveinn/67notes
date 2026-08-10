import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "./api";

type Role = "user" | "assistant";
interface Message {
  role: Role;
  text: string;
}

export default function ChatPanel({
  onClose,
  onResize,
}: {
  onClose: () => void;
  onResize: (px: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the transcript pinned to the newest content as it streams in.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setError(null);
    setInput("");
    // Each turn is one-shot: only `msg` is sent to the backend. The transcript
    // below is purely visual history, not conversation memory.
    setMessages((m) => [...m, { role: "user", text: msg }, { role: "assistant", text: "" }]);
    setSending(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await api.chat(
        msg,
        (delta) =>
          setMessages((m) => {
            const next = m.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + delta };
            return next;
          }),
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setSending(false);
      abort.current = null;
    }
  };

  const stop = () => abort.current?.abort();

  // Drag the panel's left border to resize. Width grows as the pointer moves
  // left, so it's measured from the right edge of the window.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => onResize(window.innerWidth - ev.clientX);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.classList.add("col-resizing");
  };

  const waiting =
    sending &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant" &&
    messages[messages.length - 1].text === "";

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <aside className="chat-panel">
      <div
        className="chat-resize"
        onMouseDown={startDrag}
        title="Drag to resize"
      />
      <div className="chat-head">
        <div className="chat-title">
          <span className="chat-dot" /> Ask Claude
        </div>
        <div className="actions">
          {messages.length > 0 && (
            <button title="Clear" onClick={() => setMessages([])}>
              ⌫
            </button>
          )}
          <button title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="chat-scroll" ref={scroller}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask anything about your notes. Claude can search, read and edit them
            for you.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === "assistant" ? (
              m.text ? (
                <div className="markdown-body">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              ) : (
                <span className="chat-typing" aria-label="Thinking…">
                  <i></i>
                  <i></i>
                  <i></i>
                </span>
              )
            ) : (
              m.text
            )}
          </div>
        ))}
        {error && <div className="chat-error">{error}</div>}
      </div>

      {waiting && (
        <div className="chat-status">
          <span className="chat-spinner" /> Claude is thinking…
        </div>
      )}

      <div className="chat-input">
        <textarea
          rows={2}
          placeholder="Ask Claude…  (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {sending ? (
          <button className="chat-send stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="chat-send" onClick={() => void send()} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>
    </aside>
  );
}
