import { NextRequest } from "next/server";

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

export async function POST(req: NextRequest) {
  const body = await req.json();
  // { model, messages: [{role, content}], think?: "off"|"low"|"medium"|"high"|"max" }

  const payload: Record<string, unknown> = {
    model: body.model,
    messages: body.messages,
    stream: true,
  };

  // Ollama "think" param: boolean or effort string. Thinking-capable models
  // (e.g. qwen3.5) default to thinking ON when the param is omitted, so "off"
  // must send an explicit false.
  if (body.think && body.think !== "off") {
    payload.think = body.think;
  } else if (body.think === "off") {
    payload.think = false;
  }

  const ollamaRes = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text().catch(() => "");
    return new Response(text || `Ollama error ${ollamaRes.status}`, {
      status: 502,
    });
  }

  // Pass the NDJSON stream through unchanged (includes message.thinking
  // chunks when a thinking model runs with think enabled).
  return new Response(ollamaRes.body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
