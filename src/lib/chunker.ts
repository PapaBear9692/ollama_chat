// Port of SQBot's SentenceSplitter settings (512 chars / 50 overlap),
// implemented as a dependency-free sentence-aware chunker.

export type Chunk = { text: string; page: number; chunkIdx: number };

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 50;

// Split text into sentences (naive but effective for docs: handles
// abbreviations poorly, but chunk boundaries land on sentence ends ~95% of
// the time, which is what matters for retrieval quality).
function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?。！？]+[.!?。！？]+[\])'"”’]*\s*|\S+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  // Anything the regex missed (no punctuation at all) comes through whole
  if (out.length === 0 && text.trim()) out.push(text.trim());
  return out;
}

export function chunkPages(
  pages: { text: string; page: number }[]
): Chunk[] {
  const chunks: Chunk[] = [];

  for (const { text, page } of pages) {
    const clean = text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (!clean) continue;

    const sentences = splitSentences(clean);
    let buf = "";

    const flush = () => {
      const t = buf.trim();
      if (t.length > 0) chunks.push({ text: t, page, chunkIdx: chunks.length });
      buf = "";
    };

    for (const s of sentences) {
      // A single sentence longer than the budget gets hard-split
      if (s.length > CHUNK_SIZE) {
        flush();
        for (let i = 0; i < s.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
          chunks.push({
            text: s.slice(i, i + CHUNK_SIZE).trim(),
            page,
            chunkIdx: chunks.length,
          });
        }
        continue;
      }
      if (buf.length + s.length + 1 > CHUNK_SIZE) {
        flush();
        // overlap: keep the tail of the previous buffer
        if (chunks.length > 0) {
          const prev = chunks[chunks.length - 1].text;
          if (prev.length > CHUNK_OVERLAP) {
            buf = prev.slice(-CHUNK_OVERLAP) + " ";
          }
        }
      }
      buf += (buf && !buf.endsWith(" ") ? " " : "") + s;
    }
    flush();
  }

  return chunks;
}
