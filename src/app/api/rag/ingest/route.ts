import { NextRequest, NextResponse } from "next/server";
import type { DocRecord } from "@/lib/rag-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

async function parsePdf(
  buf: Buffer
): Promise<{ text: string; page: number }[]> {
  // pdf-parse v2: class-based, per-page extraction (real page numbers)
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const pages: { text: string; page: number }[] = [];
    for (let i = 0; i < result.pages.length; i++) {
      const text = result.pages[i].text ?? "";
      if (text.trim()) pages.push({ text, page: i + 1 });
    }
    return pages;
  } finally {
    await parser.destroy();
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const name = file.name || "document";
    const lower = name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".txt")) {
      return NextResponse.json(
        { error: "Only .pdf and .txt files are supported" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // dynamic imports keep cold-start light and bundler-friendly
    const { chunkPages } = await import("@/lib/chunker");
    const store = await import("@/lib/rag-store");

    // dedupe: same content hash = already ingested
    const hash = store.fileHash(buf);
    const existing = await store.findDocByHash(hash);
    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        doc: existing,
      });
    }

    // ensure embedding model is available before heavy work
    try {
      await fetch(`${OLLAMA}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: store.EMBED_MODEL }),
      }).then((r) => {
        if (!r.ok)
          throw new Error(
            `Embedding model "${store.EMBED_MODEL}" is not installed. Run: ollama pull ${store.EMBED_MODEL}`
          );
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    let pages: { text: string; page: number }[];
    if (lower.endsWith(".pdf")) {
      pages = await parsePdf(buf);
    } else {
      pages = [{ text: buf.toString("utf-8"), page: 0 }];
    }

    if (!pages.some((p) => p.text.trim().length > 0)) {
      return NextResponse.json(
        {
          error:
            "No extractable text found — this PDF may be a scan (OCR fallback not yet enabled).",
        },
        { status: 422 }
      );
    }

    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "Document produced no chunks" },
        { status: 422 }
      );
    }

    const doc: DocRecord = {
      doc_id: crypto.randomUUID(),
      doc_name: name,
      hash,
      pages: pages.length,
      chunk_count: chunks.length,
      ingested_at: Date.now(),
    };

    await store.addChunks(doc, chunks);

    return NextResponse.json({ ok: true, doc });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ingest error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
