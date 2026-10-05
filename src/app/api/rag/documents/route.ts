import { NextRequest, NextResponse } from "next/server";
import { listDocuments, deleteDocument, chunkCount } from "@/lib/rag-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const docs = await listDocuments();
    const total = await chunkCount();
    return NextResponse.json({ docs, totalChunks: total });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { docId } = await req.json();
    if (!docId || typeof docId !== "string") {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    await deleteDocument(docId);
    const docs = await listDocuments();
    const total = await chunkCount();
    return NextResponse.json({ ok: true, docs, totalChunks: total });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
