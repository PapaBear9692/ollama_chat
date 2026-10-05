import { NextResponse } from "next/server";

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

export async function GET() {
  try {
    const [tagsRes, verRes] = await Promise.all([
      fetch(`${OLLAMA}/api/tags`, { cache: "no-store" }),
      fetch(`${OLLAMA}/api/version`, { cache: "no-store" }).catch(() => null),
    ]);
    if (!tagsRes.ok) {
      return NextResponse.json(
        { error: `Ollama returned ${tagsRes.status}` },
        { status: 502 }
      );
    }
    const data = await tagsRes.json();
    let version = "";
    if (verRes && verRes.ok) {
      try {
        version = (await verRes.json()).version || "";
      } catch {
        version = "";
      }
    }
    return NextResponse.json({ ...data, version });
  } catch {
    return NextResponse.json(
      { error: "Cannot reach Ollama — is it running?" },
      { status: 502 }
    );
  }
}
