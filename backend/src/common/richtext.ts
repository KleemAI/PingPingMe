/**
 * Formatted notes (to-do notes written in the app's editor) are stored as a small, safe subset of HTML.
 * sanitizeNoteHtml() rebuilds the HTML from an allowlist — tags, attributes and CSS properties not listed are dropped,
 * script/style content is removed, links keep only http(s)/mailto/tel, and images point only at our own files
 * (<img data-file="fl_…">; the app fills in the address when it shows the note).
 */
const TAGS = new Set(["p", "div", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "span", "font",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "a", "img", "hr"]);
const VOID = new Set(["br", "img", "hr"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "title", "head"]);
const CSS = new Set(["color", "background-color", "font-size", "font-family", "text-align", "text-decoration", "font-weight", "font-style"]);
const FONT_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "slab", "roboto slab", "georgia", "courier new", "arial"]);
export const MAX_NOTE_HTML = 100_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\u00a0/g, "&nbsp;");
/** decode the few entities an attribute value may carry, so checks see the real text */
const decode = (s: string) => s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) % 0x110000))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) % 0x110000))
  .replace(/&nbsp;/g, "\u00a0").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function cleanStyle(style: string) {
  const out: string[] = [];
  for (const decl of decode(style).split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().toLowerCase();
    if (!CSS.has(prop) || !value || value.length > 60) continue;
    if (/[\\(]|url|expression|javascript|@|<|>/.test(value) && !/^rgba?\(\s*[\d.\s,%]+\)$/.test(value)) continue;
    if ((prop === "color" || prop === "background-color") && !/^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z]+)$/.test(value)) continue;
    if (prop === "font-size" && !/^(\d{1,2}(\.\d)?(px|pt|em|rem)|small|medium|large|x-large|xx-large|x-small)$/.test(value)) continue;
    if (prop === "font-family" && !value.split(",").every((f) => FONT_FAMILIES.has(f.trim().replace(/["']/g, "")))) continue;
    if (prop === "text-align" && !["left", "center", "right", "justify", "start", "end"].includes(value)) continue;
    if (prop === "text-decoration" && !/^(none|underline|line-through|underline line-through|line-through underline)$/.test(value)) continue;
    if (prop === "font-weight" && !/^(normal|bold|[1-9]00)$/.test(value)) continue;
    if (prop === "font-style" && !/^(normal|italic)$/.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

function cleanAttrs(tag: string, raw: string) {
  const attrs: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = decode(m[2] ?? m[3] ?? m[4] ?? "");
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === "style") { const s = cleanStyle(value); if (s) attrs.push(`style="${esc(s)}"`); }
    else if (name === "href" && tag === "a") {
      const v = value.trim();
      if (/^(https?:\/\/|mailto:|tel:)/i.test(v) && v.length <= 2000) attrs.push(`href="${esc(v)}"`);
    }
    else if (name === "data-file" && tag === "img") { if (/^[A-Za-z0-9_-]{4,60}$/.test(value)) attrs.push(`data-file="${value}"`); }
    else if (name === "class" && (tag === "div" || tag === "li" || tag === "ul")) {
      const cls = value.split(/\s+/).filter((c) => c === "ck" || c === "done" || c === "cklist");
      if (cls.length) attrs.push(`class="${cls.join(" ")}"`);
    }
    else if (name === "color" && tag === "font") { if (/^#?[0-9a-z]{3,20}$/i.test(value)) attrs.push(`color="${esc(value)}"`); }
    else if (name === "size" && tag === "font") { if (/^[1-7]$/.test(value)) attrs.push(`size="${value}"`); }
    else if (name === "face" && tag === "font") { if (value.split(",").every((f) => FONT_FAMILIES.has(f.trim().toLowerCase()))) attrs.push(`face="${esc(value)}"`); }
    else if (name === "align" && ["p", "div", "h1", "h2", "h3"].includes(tag)) { if (/^(left|center|right|justify)$/i.test(value)) attrs.push(`align="${value.toLowerCase()}"`); }
  }
  if (tag === "a" && attrs.some((a) => a.startsWith("href="))) attrs.push('rel="noopener noreferrer nofollow"', 'target="_blank"');
  return attrs.length ? " " + attrs.join(" ") : "";
}

export function sanitizeNoteHtml(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) return "";
  const html = input.slice(0, MAX_NOTE_HTML * 2).replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, "");
  let out = "";
  const stack: string[] = [];
  let dropping: string | null = null;
  const tokens = html.split(/(<[^>]*>?)/);
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok[0] !== "<" || tok.length < 2 || !/^<\/?[a-zA-Z!]/.test(tok)) {
      if (!dropping) out += esc(decode(tok));
      continue;
    }
    const m = /^<(\/)?([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)\/?>?$/.exec(tok);
    if (!m) continue;
    const closing = !!m[1];
    const tag = m[2].toLowerCase();
    if (dropping) { if (closing && tag === dropping) dropping = null; continue; }
    if (DROP_WITH_CONTENT.has(tag)) { if (!closing && !/\/>$/.test(tok)) dropping = tag; continue; }
    if (!TAGS.has(tag)) continue;
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at < 0) continue;
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }
    const attrs = cleanAttrs(tag, m[3]);
    if (tag === "img" && !attrs.includes("data-file=")) continue;
    if (tag === "a" && !attrs.includes("href=")) { out += "<span>"; stack.push("span"); continue; }
    out += `<${tag}${attrs}>`;
    if (!VOID.has(tag)) stack.push(tag);
    if (stack.length > 60) break;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out.length > MAX_NOTE_HTML ? "" : out;
}

/** Plain text of a formatted note (for the list preview, search and reminders). Checklist items get ☐ / ☑. */
export function noteText(html: string): string {
  return decode(html
    .replace(/<div class="ck done">/g, "☑ ").replace(/<div class="ck">/g, "☐ ")
    .replace(/<li[^>]*>/g, "• ").replace(/<img[^>]*>/g, "\n📷\n")
    .replace(/<(br|\/p|\/div|\/h[1-3]|\/li|\/blockquote)[^>]*>/g, "\n")
    .replace(/<[^>]*>/g, ""))
    .replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** File ids of the photos in a note. */
export const noteFiles = (html: string) => [...html.matchAll(/data-file="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
