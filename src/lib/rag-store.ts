// LanceDB-backed vector store for RAG chunks.
// Embedded DB: no server, data lives in <project>/.rag-store/lancedb/.

import * as path from "path";
import * as crypto from "crypto";
import * as fs from "fs";

// @lancedb/lancedb is CJS; dynamic import keeps Next.js bundler happy
type LanceDBModule = typeof import("@lancedb/lancedb");
let ldb: LanceDBModule | null = null;
async function getLance(): Promise<LanceDBModule> {
  if (!ldb) {
    ldb = (await import("@lancedb/lancedb")) as LanceDBModule;
  }
  return ldb;
}

const STORE_DIR = path.join(process.cwd(), ".rag-store", "lancedb");
const CHUNKS_TABLE = "chunks";
const DOCS_TABLE = "documents";

export const EMBED_MODEL = "nomic-embed-text";
export const EMBED_DIM = 768;

let dbPromise: Promise<Awaited<ReturnType<LanceDBModule["connect"]>>> | null =
  null;

async function getDb() {
  const lancedb = await getLance();
  if (!dbPromise) {
    dbPromise = lancedb.connect(STORE_DIR);
  }
  return dbPromise;
}

// ── embeddings via Ollama ─────────────────────────────────────────────

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

// nomic-embed-text task prefixes (recommended by the model card) +
// L2 normalization so LanceDB's default L2 distance behaves as cosine
function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return v.map((x) => x / n);
}

export async function embedTexts(
  texts: string[],
  task: "document" | "query" = "document"
): Promise<number[][]> {
  const prefix = task === "query" ? "search_query: " : "search_document: ";
  const out: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => prefix + t);
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(
        `Ollama embed failed (${res.status}). Is "${EMBED_MODEL}" pulled? ${t.slice(0, 200)}`
      );
    }
    const data = await res.json();
    // API returns embeddings in input order
    for (const e of data.embeddings) out.push(normalize(e));
  }
  return out;
}

// ── documents table ──────────────────────────────────────────────────

export type DocRecord = {
  doc_id: string;
  doc_name: string;
  hash: string;
  pages: number;
  chunk_count: number;
  ingested_at: number;
};

export async function listDocuments(): Promise<DocRecord[]> {
  const db = await getDb();
  const lancedb = await getLance();
  const tables = await db.tableNames();
  if (!tables.includes(DOCS_TABLE)) return [];
  const tbl = await db.openTable(DOCS_TABLE);
  const rows = await tbl.query().select([
    "doc_id",
    "doc_name",
    "hash",
    "pages",
    "chunk_count",
    "ingested_at",
  ]).toArray();
  return rows as unknown as DocRecord[];
}

export async function findDocByHash(
  hash: string
): Promise<DocRecord | undefined> {
  const docs = await listDocuments();
  return docs.find((d) => d.hash === hash);
}

// ── ingest ───────────────────────────────────────────────────────────

export async function addChunks(
  doc: DocRecord,
  chunks: { text: string; page: number; chunkIdx: number }[]
): Promise<void> {
  const db = await getDb();
  const vectors = await embedTexts(chunks.map((c) => c.text));

  const rows = chunks.map((c, i) => ({
    vector: vectors[i],
    text: c.text,
    doc_id: doc.doc_id,
    doc_name: doc.doc_name,
    page: c.page,
    chunk_idx: c.chunkIdx,
  }));

  const lancedb = await getLance();
  const tables = await db.tableNames();

  if (!tables.includes(CHUNKS_TABLE)) {
    await db.createTable(CHUNKS_TABLE, rows);
  } else {
    const tbl = await db.openTable(CHUNKS_TABLE);
    await tbl.add(rows);
  }

  if (!tables.includes(DOCS_TABLE)) {
    await db.createTable(DOCS_TABLE, [doc]);
  } else {
    const tbl = await db.openTable(DOCS_TABLE);
    await tbl.add([doc]);
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = await getDb();
  const tables = await db.tableNames();
  if (tables.includes(CHUNKS_TABLE)) {
    const tbl = await db.openTable(CHUNKS_TABLE);
    await tbl.delete(`doc_id = '${docId}'`);
  }
  if (tables.includes(DOCS_TABLE)) {
    const tbl = await db.openTable(DOCS_TABLE);
    await tbl.delete(`doc_id = '${docId}'`);
  }
}

// ── search ───────────────────────────────────────────────────────────

export type Retrieved = {
  text: string;
  docName: string;
  page: number;
  score: number;
};

export async function searchChunks(
  query: string,
  topK = 8,
  minScore = 0.75
): Promise<Retrieved[]> {
  const db = await getDb();
  const tables = await db.tableNames();
  if (!tables.includes(CHUNKS_TABLE)) return [];

  const [qv] = await embedTexts([query], "query");

  const tbl = await db.openTable(CHUNKS_TABLE);
  const rows = await tbl
    .search(qv)
    .limit(topK * 2) // fetch extra, filter by score, then trim
    .toArray();

  const hits = (rows as unknown as {
    text: string;
    doc_name: string;
    page: number;
    _distance: number;
  }[])
    .map((r) => ({
      text: r.text,
      docName: r.doc_name,
      page: r.page,
      // unit vectors: L2 distance d relates to cosine similarity as 1 - d²/2
      score: 1 - (r._distance * r._distance) / 2,
    }))
    .filter((r) => r.score >= minScore)
    .slice(0, topK);

  return hits;
}

export async function chunkCount(): Promise<number> {
  const db = await getDb();
  const tables = await db.tableNames();
  if (!tables.includes(CHUNKS_TABLE)) return 0;
  const tbl = await db.openTable(CHUNKS_TABLE);
  return await tbl.countRows();
}

export function fileHash(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function storeExists(): boolean {
  return fs.existsSync(STORE_DIR);
}
