"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Msg = { role: "user" | "assistant" | "system"; content: string; thinking?: string };
type Chat = { id: string; title: string; updated: number; messages: Msg[] };
type ModelInfo = { name: string; size: number };
type ThinkLevel = "off" | "low" | "medium" | "high" | "max";

const THINK_LEVELS: { value: ThinkLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const COOKIE = "ollama_chats";
const MAX_COOKIE = 3800; // stay under the 4KB per-cookie browser limit

function readChats(): Chat[] {
  try {
    const m = document.cookie.match(/(?:^|;\s*)ollama_chats=([^;]+)/);
    if (!m) return [];
    const arr = JSON.parse(decodeURIComponent(m[1]));
    if (!Array.isArray(arr)) return [];
    return arr.map((c: any) => ({
      id: String(c.id),
      title: String(c.t ?? "Chat"),
      updated: Number(c.u ?? 0),
      messages: Array.isArray(c.m)
        ? c.m.map((x: any) => ({
            role: x.r,
            content: x.c,
            ...(x.k ? { thinking: x.k } : {}),
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

function writeChats(chats: Chat[]) {
  const enc = (l: Chat[]) =>
    encodeURIComponent(
      JSON.stringify(
        l.map((c) => ({
          id: c.id,
          t: c.title.slice(0, 60),
          u: c.updated,
          m: c.messages.map((x) => ({
            r: x.role,
            c: x.content.slice(0, 1500),
            ...(x.thinking ? { k: x.thinking.slice(0, 1500) } : {}),
          })),
        }))
      )
    );
  const list = [...chats].sort((a, b) => b.updated - a.updated);
  let s = enc(list);
  while (s.length > MAX_COOKIE && list.length > 1) {
    list.pop();
    s = enc(list);
  }
  while (s.length > MAX_COOKIE && list[0] && list[0].messages.length > 0) {
    list[0] = { ...list[0], messages: list[0].messages.slice(-2) };
    s = enc(list);
  }
  document.cookie = `${COOKIE}=${s}; path=/; max-age=31536000; SameSite=Lax`;
}

function uuid(): string {
  // crypto.randomUUID is unavailable in insecure contexts (http://lan-ip),
  // so fall back to a manual RFC4122 v4 generator.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function fmtSize(n?: number) {
  if (!n) return "";
  const g = n / 1e9;
  if (g >= 1) return g.toFixed(1) + " GB";
  return Math.round(n / 1e6) + " MB";
}

function relTime(t: number) {
  const d = Date.now() - t;
  if (d < 60e3) return "now";
  if (d < 3600e3) return Math.floor(d / 60e3) + "m ago";
  if (d < 86400e3) return Math.floor(d / 3600e3) + "h ago";
  return Math.floor(d / 86400e3) + "d ago";
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [modelInfos, setModelInfos] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ollamaVer, setOllamaVer] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [think, setThink] = useState<ThinkLevel>("off");
  const [thinkOpen, setThinkOpen] = useState(false);
  const [showThinking, setShowThinking] = useState<Record<number, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const thinkRef = useRef<HTMLDivElement>(null);

  // restore history from cookie + load models
  useEffect(() => {
    setChats(readChats());
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        const infos: ModelInfo[] = (d.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
        }));
        setModelInfos(infos);
        if (infos.length) setModel(infos[0].name);
        else setErr("No models found — run `ollama pull <model>`");
        if (d.version) setOllamaVer(d.version);
      })
      .catch(() => setErr("Failed to load models"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  // close model menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  // close thinking menu on outside click
  useEffect(() => {
    if (!thinkOpen) return;
    const h = (e: MouseEvent) => {
      if (thinkRef.current && !thinkRef.current.contains(e.target as Node))
        setThinkOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [thinkOpen]);

  function persist(baseChats: Chat[], id: string, msgs: Msg[]) {
    const list = baseChats.map((c) =>
      c.id === id ? { ...c, messages: msgs, updated: Date.now() } : c
    );
    setChats(list);
    writeChats(list);
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || busy || !model) return;
    setErr("");
    setInput("");
    setBusy(true);

    const id = activeId ?? uuid();
    const isNew = activeId === null;
    const baseChats: Chat[] = isNew
      ? [{ id, title: text.slice(0, 60), updated: Date.now(), messages: [] }, ...chats]
      : chats;
    if (isNew) {
      setActiveId(id);
      setChats(baseChats);
    }

    const next: Msg[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages([...next, { role: "assistant", content: "" }]);

    let assistant = "";
    let thinking = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: next, think }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line);
          if (obj.error) throw new Error(obj.error);
          if (obj.message?.thinking) thinking += obj.message.thinking;
          assistant += obj.message?.content ?? "";
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = {
              role: "assistant",
              content: assistant,
              ...(thinking ? { thinking } : {}),
            };
            return copy;
          });
        }
      }
    } catch (e: any) {
      setErr(e.message || "Request failed");
    } finally {
      const finalMsgs: Msg[] = assistant
        ? [...next, { role: "assistant", content: assistant, ...(thinking ? { thinking } : {}) }]
        : next;
      setMessages(finalMsgs);
      persist(baseChats, id, finalMsgs);
      setBusy(false);
    }
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setErr("");
    setDrawer(false);
    inputRef.current?.focus();
  }

  function loadChat(c: Chat) {
    setActiveId(c.id);
    setMessages(c.messages);
    setErr("");
    setDrawer(false);
  }

  function delChat(id: string) {
    const list = chats.filter((c) => c.id !== id);
    setChats(list);
    writeChats(list);
    if (activeId === id) newChat();
  }

  const isLast = (i: number) => i === messages.length - 1;
  const modelName = model.split(":")[0];

  return (
    <div className="shell">
      <div
        className={`backdrop ${drawer ? "show" : ""}`}
        onClick={() => setDrawer(false)}
      />

      <aside className={`sidebar ${drawer ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
        <div className="sb-head">
          <span className="sb-title">History</span>
          <div className="sb-head-actions">
            <button className="sb-new" onClick={newChat}>
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              New
            </button>
            <button
              className="sb-collapse"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          </div>
        </div>
        <div className="sb-list">
          {chats.length === 0 && (
            <p className="sb-empty">No conversations yet. Say hello to your local model.</p>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`sb-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => loadChat(c)}
            >
              <div className="sb-item-text">
                <span className="sb-item-title">{c.title}</span>
                <span className="sb-item-time">{relTime(c.updated)}</span>
              </div>
              <button
                className="sb-del"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  delChat(c.id);
                }}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="sb-foot">
          <div className="sb-foot-row">
            <span className="local-badge">
              <i className="dot" /> Running locally
            </span>
            <span className="sb-ver">{ollamaVer && `v${ollamaVer}`}</span>
          </div>
          <div className="sb-stats">
            <div className="stat">
              <span className="stat-num">{modelInfos.length}</span>
              <span className="stat-label">models</span>
            </div>
            <div className="stat">
              <span className="stat-num">{fmtSize(modelInfos.reduce((a, m) => a + (m.size || 0), 0)) || "—"}</span>
              <span className="stat-label">on disk</span>
            </div>
            <div className="stat">
              <span className="stat-num">{chats.length}</span>
              <span className="stat-label">chats</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              <button
                className={`expand-btn ${collapsed ? "show" : ""}`}
                onClick={() => setCollapsed(false)}
                title="Show history"
                aria-label="Show history"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M13 17l5-5-5-5M6 17l5-5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
              <button
                className="hamburger"
                onClick={() => setDrawer(true)}
                aria-label="Open chat history"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 3c1.5 3.5 1.5 6 0 9s-1.5 5.5 0 9M7 6c1 2 1 4 0 6s-1 4 0 6M17 6c-1 2-1 4 0 6s1 4 0 6M3.5 12h17"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"
                />
              </svg>
              <span className="brand-name">Ollama</span>
            </div>
            <span className="topbar-model">{busy ? "Thinking…" : modelName}</span>
          </div>
        </header>

        <div className="chat-area">
          {messages.length === 0 && !err && (
            <div className="welcome">
              <div className="welcome-spark" aria-hidden="true">
                <svg viewBox="0 0 100 100" fill="currentColor">
                  <path d="M50 0c2 14 8 22 22 26-14 4-20 12-22 26-2-14-8-22-22-26 14-4 20-12 22-26zM88 55c1 7 4 11 11 13-7 2-10 6-11 13-1-7-4-11-11-13 7-2 10-6 11-13zM15 60c1 6 3.5 9 9.5 11-6 2-8.5 5-9.5 11-1-6-3.5-9-9.5-11 6-2 8.5-5 9.5-11z" />
                </svg>
              </div>
              <h1 className="greeting">
                {["Evening", "Morning", "Afternoon"][
                  new Date().getHours() < 12 ? 1 : new Date().getHours() < 17 ? 2 : 0
                ]}
                , Master
              </h1>
              <p className="welcome-sub">
                {modelInfos.length > 0
                  ? `${modelInfos.length} model${modelInfos.length === 1 ? "" : "s"} available on this machine`
                  : "Looking for local models…"}
              </p>
            </div>
          )}

          <div className="thread">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="row-user">
                  <div className="bubble-user">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="row-assistant">
                  <div className="assistant-head">
                    <span className="assistant-name">{modelName}</span>
                    {m.thinking && (
                      <button
                        className={`think-toggle ${showThinking[i] ? "on" : ""}`}
                        onClick={() =>
                          setShowThinking((s) => ({ ...s, [i]: !s[i] }))
                        }
                      >
                        <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
                          <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.55 1.1 1.3 1.1 2.2h5c0-.9.4-1.65 1.1-2.2A6 6 0 0 0 12 3zM9.5 18h5M10.5 21h3"
                            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                        {busy && isLast(i) && !m.content ? "Thinking…" : "Thought process"}
                        <svg className={`chev ${showThinking[i] ? "flip" : ""}`} viewBox="0 0 10 6" width="7" aria-hidden="true">
                          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {m.thinking && showThinking[i] && (
                    <div className="thinking-panel">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.thinking}</ReactMarkdown>
                    </div>
                  )}
                  <div className="assistant-body">
                    {m.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content}
                      </ReactMarkdown>
                    ) : busy && isLast(i) ? (
                      <span className="thinking">
                        <i /><i /><i />
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            )}
            {err && <div className="error-toast">{err}</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="composer-wrap">
          <div className="composer-card">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="How can I help you today?"
              rows={1}
              autoFocus
            />
            <div className="composer-chin">
              <div className="chin-left">
                <div className="model-menu" ref={menuRef}>
                  <button
                    type="button"
                    className="model-pill"
                    onClick={() => { setMenuOpen((o) => !o); setThinkOpen(false); }}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
                    </svg>
                    <span className="mp-name">{modelName}</span>
                    <svg className={`chev ${menuOpen ? "flip" : ""}`} viewBox="0 0 10 6" width="9" aria-hidden="true">
                      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </button>
                  {menuOpen && (
                    <div className="model-pop" role="menu">
                      {modelInfos.map((mi) => (
                        <button
                          key={mi.name}
                          className={`model-opt ${mi.name === model ? "sel" : ""}`}
                          onClick={() => {
                            setModel(mi.name);
                            setMenuOpen(false);
                          }}
                        >
                          <span className="mo-check">
                            {mi.name === model ? "\u2713" : ""}
                          </span>
                          <span className="mo-name">{mi.name.split(":")[0]}</span>
                          <span className="mo-size">{fmtSize(mi.size)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="model-menu" ref={thinkRef}>
                  <button
                    type="button"
                    className={`model-pill think-pill ${think !== "off" ? "active" : ""}`}
                    onClick={() => { setThinkOpen((o) => !o); setMenuOpen(false); }}
                    title="Thinking effort"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <path
                        d="M12 3a6 6 0 0 0-3.6 10.8c.7.55 1.1 1.3 1.1 2.2h5c0-.9.4-1.65 1.1-2.2A6 6 0 0 0 12 3zM9.5 18h5M10.5 21h3"
                        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"
                      />
                    </svg>
                    <span className="mp-name">
                      {think === "off" ? "Thinking" : THINK_LEVELS.find((t) => t.value === think)?.label}
                    </span>
                    <svg className={`chev ${thinkOpen ? "flip" : ""}`} viewBox="0 0 10 6" width="9" aria-hidden="true">
                      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </button>
                  {thinkOpen && (
                    <div className="model-pop think-pop" role="menu">
                      <div className="pop-title">Thinking effort</div>
                      {THINK_LEVELS.map((t) => (
                        <button
                          key={t.value}
                          className={`model-opt ${t.value === think ? "sel" : ""}`}
                          onClick={() => {
                            setThink(t.value);
                            setThinkOpen(false);
                          }}
                        >
                          <span className="mo-check">{t.value === think ? "\u2713" : ""}</span>
                          <span className="mo-name">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button
                className="send-btn"
                onClick={() => send()}
                disabled={busy || !input.trim()}
                aria-label="Send message"
                title="Send"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M5 12h13M12 5.5 18.5 12 12 18.5"
                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"
                  />
                </svg>
              </button>
            </div>
          </div>
          <p className="disclaimer">
            Runs fully offline on your machine via Ollama
          </p>
        </div>
      </div>
    </div>
  );
}
