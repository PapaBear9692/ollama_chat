import { NextRequest } from "next/server";
import { buildRagSystemPrompt, buildRagUserMessage, DEFAULT_DOMAIN } from "@/lib/rag-prompt";
import { searchChunks } from "@/lib/rag-store";

export const runtime = "nodejs";
export const maxDuration = 120;

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

export async function POST(req: NextRequest) {
  const body = await req.json();
  // { model, messages, think?, rag?: { enabled: true } }
  // The last user message is the question; prior messages give conversation
  // context but retrieval uses only the latest question.

  const lastUser = [...body.messages].reverse().find((m: any) => m.role === "user");
  const question: string = (lastUser?.content ?? "").trim();
  if (!question) {
    return new Response("No question provided", { status: 400 });
  }

  // 1. Retrieve
  let hits;
  try {
    hits = await searchChunks(question, 8, 0.75);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }

  // 2. No relevant context -> fall back to a normal (ungrounded) chat turn.
  // Grounding applies when documents match; otherwise the assistant answers
  // from general knowledge like a regular chat.
  if (hits.length === 0) {
    const payload: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
      stream: true,
    };
    if (body.think && body.think !== "off") {
      payload.think = body.think;
    } else if (body.think === "off") {
      payload.think = false;
    }
    const fallbackRes = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!fallbackRes.ok || !fallbackRes.body) {
      const text = await fallbackRes.text().catch(() => "");
      return new Response(text || `Ollama error ${fallbackRes.status}`, {
        status: 502,
      });
    }
    return new Response(fallbackRes.body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 3. Build the grounded message list
  const system = buildRagSystemPrompt(DEFAULT_DOMAIN);
  const ragUser = buildRagUserMessage(
    hits.map((h) => ({ text: h.text, docName: h.docName, page: h.page })),
    question
  );

  // Keep prior conversation for continuity, but replace the raw question
  // with the context-injected version.
  // NOTE: SQBot semantics — RAG queries are standalone. Prior assistant
  // replies pollute small-model prompts (they mimic previous output), so
  // only the system prompt + context-injected question are sent.
  const messages = [
    { role: "system", content: system },
    { role: "user", content: ragUser },
  ];

  // 4. Stream from Ollama, prepending a sources record the UI can read
  const payload: Record<string, unknown> = {
    model: body.model,
    messages,
    stream: true,
  };
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

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sources = hits.map((h) => ({
    docName: h.docName,
    page: h.page,
    score: Math.round(h.score * 100) / 100,
  }));
  let sourcesSent = false;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!sourcesSent) {
            // first data chunk: prepend sources so the UI can render chips
            controller.enqueue(
              encoder.encode(JSON.stringify({ sources }) + "\n")
            );
            sourcesSent = true;
          }
          controller.enqueue(encoder.encode(chunk));
        }
        if (!sourcesSent) {
          controller.enqueue(encoder.encode(JSON.stringify({ sources }) + "\n"));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
