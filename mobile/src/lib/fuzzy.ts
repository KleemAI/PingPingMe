/**
 * Fuzzy matching for search: forgiving of small typos ("rixt" → Rixit, "nsha" → Nisha), word order and accents.
 * fuzzyScore(query, text) → 0 (no match) … 1 (exact / starts with). Same file in backend/src/common, lib/ and mobile/src/lib/ (no \\p{…} regex: Hermes).
 */
export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s"'`!#$%^&*()[\]{}<>,;:?/\\|~=_-]+/g, " ").trim();

/** Optimal-string-alignment distance (Levenshtein + swapped neighbours), stops early above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

const subsequence = (q: string, w: string) => { let i = 0; for (const ch of w) if (ch === q[i]) i++; return i === q.length; };

/** How well one query word matches one word of the text. */
function wordScore(q: string, w: string) {
  if (w === q) return 1;
  if (w.startsWith(q)) return 0.95;
  if (w.includes(q)) return 0.85;
  const allowed = q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2;
  if (allowed) {
    // a typo in a whole word, or in the part typed so far
    const d = Math.min(editDistance(q, w, allowed), editDistance(q, w.slice(0, q.length), allowed));
    if (d <= allowed) return 0.8 - 0.1 * d;
  }
  if (q.length >= 3 && subsequence(q, w) && q.length >= w.length * 0.6) return 0.6;
  return 0;
}

export function fuzzyScore(query: string, text: string | null | undefined): number {
  const q = normalize(query);
  const t = normalize(text ?? "");
  if (!q) return 1;
  if (!t) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 0.9;
  const words = t.split(" ");
  let total = 1;
  for (const part of q.split(" ")) {
    const best = Math.max(...words.map((w) => wordScore(part, w)));
    if (!best) return 0;
    total = Math.min(total, best);
  }
  return total;
}

/** Best score of a query against several fields (e.g. name, company, email). */
export const fuzzyBest = (query: string, ...fields: (string | null | undefined)[]) => Math.max(0, ...fields.map((f) => fuzzyScore(query, f)));
