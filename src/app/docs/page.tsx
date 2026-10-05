"use client";

import { useEffect, useRef, useState } from "react";

type DocRecord = {
  doc_id: string;
  doc_name: string;
  hash: string;
  pages: number;
  chunk_count: number;
  ingested_at: number;
};

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${hh}:${mm} ${ampm}`;
}

function fmtSize(n?: number) {
  if (!n) return "";
  const g = n / 1e9;
  if (g >= 1) return g.toFixed(1) + " GB";
  return Math.round(n / 1e6) + " MB";
}

export default function DocsPage() {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/rag/documents");
      const d = await res.json();
      if (Array.isArray(d.docs)) setDocs(d.docs);
      if (typeof d.totalChunks === "number") setTotalChunks(d.totalChunks);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function uploadFile(file: File) {
    if (uploading) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".txt")) {
      setMsg("Only .pdf and .txt files are supported.");
      return;
    }
    setUploading(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/rag/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      if (data.duplicate) {
        setMsg(`"${data.doc.doc_name}" is already indexed.`);
      } else {
        setMsg(`Indexed "${data.doc.doc_name}" — ${data.doc.chunk_count} chunks.`);
      }
      await refresh();
    } catch (e: any) {
      setMsg(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Its content will no longer ground chat answers.`)) return;
    try {
      const res = await fetch("/api/rag/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: id }),
      });
      const data = await res.json();
      if (Array.isArray(data.docs)) setDocs(data.docs);
      if (typeof data.totalChunks === "number") setTotalChunks(data.totalChunks);
      setMsg(`Deleted "${name}".`);
    } catch {
      setMsg("Delete failed");
    }
  }

  return (
    <div
      className="docs-page"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) uploadFile(f);
      }}
    >
      <header className="docs-header">
        <a className="docs-back" href="/">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M19 12H5m0 0l6-6m-6 6l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          Chat
        </a>
        <h1 className="docs-title">Documents</h1>
        <span className="docs-count">
          {docs.length} doc{docs.length === 1 ? "" : "s"} · {totalChunks} chunks
        </span>
      </header>

      <div
        className={`drop-zone ${dragOver ? "drag" : ""}`}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {uploading ? (
          <>
            <span className="spinner" />
            <p className="dz-text">Indexing… embedding chunks locally</p>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path d="M12 16V6m0 0l-4 4m4-4l4 4M5 18h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <p className="dz-text">Drop a PDF or TXT here, or click to browse</p>
            <p className="dz-sub">Files are chunked and embedded on this machine only</p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {msg && <p className="docs-msg">{msg}</p>}

      <div className="docs-list">
        {docs.length === 0 && !uploading && (
          <p className="docs-empty">No documents yet. Upload one above — chat answers will then be grounded in your files automatically.</p>
        )}
        {docs.map((d) => (
          <div key={d.doc_id} className="doc-row">
            <div className="doc-icon">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <div className="doc-row-info">
              <span className="doc-name">{d.doc_name}</span>
              <span className="doc-meta">
                {fmtDate(d.ingested_at)} · {d.chunk_count} chunks{d.pages > 1 ? ` · ${d.pages} pages` : ""}
              </span>
            </div>
            <button className="docs-del" onClick={() => deleteDoc(d.doc_id, d.doc_name)} title="Delete document">
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
