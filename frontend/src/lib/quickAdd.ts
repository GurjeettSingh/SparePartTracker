export type QuickAddModel = { id: number; name: string; manufacturer_id: number };
export type QuickAddSparePart = { id: number; name: string };

export function deriveKeywords(label: string): string[] {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const extra: string[] = [];
  for (const w of words) {
    if (w.endsWith("s") && w.length > 3) extra.push(w.slice(0, -1));
  }
  return Array.from(new Set([...words, ...extra]));
}

export function parseQuickAdd(input: string, models: QuickAddModel[], spareParts: QuickAddSparePart[]) {
  const raw = input.trim();
  if (!raw) return null;

  const tokens = raw.split(/\s+/).filter(Boolean);
  let qty = 1;
  const qtyIdx = [...tokens]
    .map((t, idx) => ({ t, idx }))
    .reverse()
    .find(({ t }) => /^\d+$/.test(t));
  if (qtyIdx) {
    const n = Number(qtyIdx.t);
    if (Number.isFinite(n) && n > 0) qty = n;
    tokens.splice(qtyIdx.idx, 1);
  }

  const haystack = tokens.join(" ").toLowerCase();
  if (!haystack) return null;

  const modelMatch = models
    .map((m) => ({ m, name: m.name.toLowerCase() }))
    .filter(({ name }) => haystack.includes(name))
    .sort((a, b) => b.name.length - a.name.length)[0]?.m;
  if (!modelMatch) return null;

  const modelNeedle = modelMatch.name.toLowerCase();
  const idx = haystack.indexOf(modelNeedle);
  const remainder = idx >= 0 ? (haystack.slice(0, idx) + " " + haystack.slice(idx + modelNeedle.length)).trim() : haystack;
  const remainderWords = remainder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const remainderSet = new Set(remainderWords);

  const partMatch = spareParts
    .map((p) => {
      const label = p.name.toLowerCase();
      const keywords = deriveKeywords(p.name);
      const labelHit = remainder.includes(label);
      const keywordHits = keywords.filter((k) => remainderSet.has(k)).length;
      const score = labelHit ? 1000 + label.length : keywordHits > 0 ? keywordHits * 10 + label.length : 0;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.p;

  if (!partMatch) return null;

  return {
    model: modelMatch,
    sparePart: partMatch,
    quantity: qty,
  };
}
