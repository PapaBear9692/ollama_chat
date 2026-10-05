import { NextRequest } from "next/server";

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

export async function POST(req: NextRequest) {
  const body = await req.json();
  // { model, messages: [{role, content}] }

  const ollamaRes = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      stream: true,
    }),
  });

  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text().catch(() => "");
    return new Response(text || `Ollama error ${ollamaRes.status}`, {
      status: 502,
    });
  }

  // Pass the NDJSON stream through unchanged.
  return new Response(ollamaRes.body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
