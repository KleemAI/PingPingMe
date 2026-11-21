/**
 * Chat text formatting (like WhatsApp), stickers and emoji — shared by the web app and the phone app
 * (same file in lib/chatFormat.ts and mobile/src/lib/chatFormat.ts).
 *
 *   *bold*   _italic_   ~strike~   `code`   ```monospace block```
 *   > quote      - bullet   * bullet      1. numbered
 *
 * Messages stay plain text, so they also read fine on WhatsApp / SMS and in older app versions.
 * A sticker is a message that starts with an invisible marker (U+2063) followed by its emoji and label.
 */

export type Span = { text: string; b?: boolean; i?: boolean; s?: boolean; code?: boolean };
export type Line = { kind: "text" | "quote" | "bullet" | "number" | "code"; n?: string; spans: Span[] };
export type Parsed = { sticker?: Sticker; jumbo?: boolean; lines: Line[] };
export type Sticker = { id: string; emoji: string; label?: string; color?: string };

export const STICKER_MARK = "⁣";

export const STICKERS: Sticker[] = [
  // big emoji
  { id: "thumbs", emoji: "👍" }, { id: "pray", emoji: "🙏" }, { id: "party", emoji: "🎉" }, { id: "heart", emoji: "❤️" },
  { id: "laugh", emoji: "😂" }, { id: "love", emoji: "😍" }, { id: "fire", emoji: "🔥" }, { id: "clap", emoji: "👏" },
  { id: "deal", emoji: "🤝" }, { id: "ok", emoji: "👌" }, { id: "hundred", emoji: "💯" }, { id: "wow", emoji: "😮" },
  { id: "sad", emoji: "😢" }, { id: "think", emoji: "🤔" }, { id: "cool", emoji: "😎" }, { id: "wave", emoji: "👋" },
  { id: "gift", emoji: "🎁" }, { id: "shop", emoji: "🛍️" }, { id: "box", emoji: "📦" }, { id: "truck", emoji: "🚚" },
  // word stickers
  { id: "thanks", emoji: "🙏", label: "Thank you!", color: "#fde68a" },
  { id: "welcome", emoji: "👋", label: "Welcome!", color: "#bfdbfe" },
  { id: "confirmed", emoji: "✅", label: "Order confirmed", color: "#bbf7d0" },
  { id: "shipped", emoji: "🚚", label: "On the way", color: "#c7d2fe" },
  { id: "delivered", emoji: "📦", label: "Delivered", color: "#a7f3d0" },
  { id: "paid", emoji: "💰", label: "Payment received", color: "#fef08a" },
  { id: "wait", emoji: "⏳", label: "Please wait", color: "#fed7aa" },
  { id: "checking", emoji: "🔎", label: "Checking…", color: "#e9d5ff" },
  { id: "deal-done", emoji: "🤝", label: "Deal!", color: "#fbcfe8" },
  { id: "morning", emoji: "☀️", label: "Good morning", color: "#fde68a" },
  { id: "night", emoji: "🌙", label: "Good night", color: "#c7d2fe" },
  { id: "diwali", emoji: "🪔", label: "Happy Diwali", color: "#fdba74" },
];

/** The message text that sends a sticker. */
export const stickerText = (s: Sticker) => `${STICKER_MARK}${s.emoji}${s.label ? ` ${s.label}` : ""}`;

export const EMOJI: { id: string; label: string; icon: string; list: string[] }[] = [
  { id: "smileys", label: "Smileys", icon: "😀", list: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😴 😷 🤒 🤕 🤢 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖".split(" ") },
  { id: "people", label: "Hands", icon: "👍", list: "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫶 👀 🧠 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 💁".split(" ") },
  { id: "hearts", label: "Hearts", icon: "❤️", list: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ⭐ 🌟 ✨ ⚡ 🔥 💯 ✅ ❌ ⚠️ ❗ ❓ 💬 💭 🔔 🎉 🎊 🎈 🎁 🏆 🥇".split(" ") },
  { id: "business", label: "Business", icon: "💼", list: "💼 📦 🚚 🛒 🛍️ 💰 💵 💳 🧾 📈 📉 📊 📅 ⏰ ⏳ 📞 📱 💻 🖨️ 📧 📩 📝 📌 📎 🔒 🔑 🏷️ 🏪 🏬 🏭 🔧 🔨 ⚙️ 🧰 💡 🔋 🔌 📷 🎧".split(" ") },
  { id: "food", label: "Food & India", icon: "🍛", list: "🍛 🍚 🍲 🫓 🥘 🍜 🍕 🍔 🍟 🌭 🥪 🍩 🍪 🍰 🎂 🍫 🍬 🍭 🍦 ☕ 🍵 🥤 🧃 🍎 🍌 🍇 🍉 🥭 🍓 🥥 🪔 🕉️ 🛕 🇮🇳 🏏 🪁 🌼 🌸 🌺 🌻".split(" ") },
  { id: "nature", label: "Travel & nature", icon: "🌍", list: "🌍 ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌈 ❄️ 🌙 ⭐ 🌊 🌳 🌴 🌵 🍀 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🦋 🚗 🛵 🚲 ✈️ 🚆 🚌 🏠 🏢 🏖️".split(" ") },
];

// built with new RegExp so an engine without Unicode property escapes just skips "big emoji" instead of crashing
const re = (src: string, flags: string) => { try { return new RegExp(src, flags); } catch { return null; } };
const PICTO = re("\\p{Extended_Pictographic}", "u");
const PICTO_ALL = re("\\p{Extended_Pictographic}", "gu");
const EMOJI_ONLY = re("^(?:\\p{Extended_Pictographic}|\\p{Emoji_Modifier}|\\p{Regional_Indicator}|\\u200d|\\ufe0f|\\u20e3|[#*0-9]|\\s)+$", "u");
/** 1–3 emoji and nothing else → shown big, like WhatsApp. */
export function isJumbo(text: string) {
  const t = text.trim();
  if (!t || t.length > 40 || !EMOJI_ONLY || !PICTO || !PICTO_ALL || !EMOJI_ONLY.test(t) || !PICTO.test(t)) return false;
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? [...new (Intl as unknown as { Segmenter: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: "grapheme" }).segment(t.replace(/\s+/g, ""))].length
    : t.replace(/\s+/g, "").match(PICTO_ALL)?.length ?? 0;
  return seg > 0 && seg <= 3;
}

const BOUNDARY = /[\s.,!?;:()[\]{}"'\-/\\]/;
const MARKS: Record<string, keyof Span> = { "*": "b", _: "i", "~": "s", "`": "code" };

/** *bold* _italic_ ~strike~ `code` — markers count only at word edges, as on WhatsApp. */
export function inline(str: string, style: Omit<Span, "text"> = {}): Span[] {
  const out: Span[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ text: buf, ...style }); buf = ""; } };
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const key = MARKS[ch];
    const prev = str[i - 1];
    const next = str[i + 1];
    if (key && !style.code && (prev === undefined || BOUNDARY.test(prev)) && next !== undefined && !/\s/.test(next) && next !== ch) {
      let j = i + 2;
      for (; j < str.length; j++) {
        if (str[j] === "\n") { j = str.length; break; }
        if (str[j] === ch && !/\s/.test(str[j - 1]) && (j + 1 === str.length || BOUNDARY.test(str[j + 1]))) break;
      }
      if (j < str.length) {
        flush();
        const inner = str.slice(i + 1, j);
        if (key === "code") out.push({ text: inner, ...style, code: true });
        else out.push(...inline(inner, { ...style, [key]: true }));
        i = j;
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}

/** Splits a message into formatted lines (quotes, lists, ```code blocks```). */
export function parse(text: string): Parsed {
  if (text.startsWith(STICKER_MARK)) {
    const body = text.slice(STICKER_MARK.length);
    const known = STICKERS.find((s) => stickerText(s) === text);
    if (known) return { sticker: known, lines: [] };
    const [emoji, ...rest] = body.split(" ");
    return { sticker: { id: "custom", emoji, label: rest.join(" ") || undefined, color: rest.length ? "#e5e7eb" : undefined }, lines: [] };
  }
  if (isJumbo(text)) return { jumbo: true, lines: [{ kind: "text", spans: [{ text: text.trim() }] }] };
  const lines: Line[] = [];
  const raw = text.split("\n");
  for (let k = 0; k < raw.length; k++) {
    const l = raw[k];
    const fence = l.match(/^```(.*)$/);
    if (fence) {
      const same = fence[1].match(/^(.*)```\s*$/); // ```one line```
      if (same) { lines.push({ kind: "code", spans: [{ text: same[1], code: true }] }); continue; }
      const block: string[] = fence[1] ? [fence[1]] : [];
      let end = k + 1;
      for (; end < raw.length && !/```\s*$/.test(raw[end]); end++) block.push(raw[end]);
      if (end < raw.length) {
        const last = raw[end].replace(/```\s*$/, "");
        if (last) block.push(last);
        for (const b of block) lines.push({ kind: "code", spans: [{ text: b, code: true }] });
        k = end;
        continue;
      }
    }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^>\s?(.*)$/))) lines.push({ kind: "quote", spans: inline(m[1]) });
    else if ((m = l.match(/^[-*•]\s+(.*)$/))) lines.push({ kind: "bullet", spans: inline(m[1]) });
    else if ((m = l.match(/^(\d{1,3})[.)]\s+(.*)$/))) lines.push({ kind: "number", n: m[1], spans: inline(m[2]) });
    else lines.push({ kind: "text", spans: inline(l) });
  }
  return { lines };
}

/** For previews (chat lists, notifications): no markers, stickers as their emoji + label. */
export function plain(text: string) {
  if (text.startsWith(STICKER_MARK)) return text.slice(STICKER_MARK.length);
  return parse(text).lines.map((l) => (l.kind === "bullet" ? "• " : l.kind === "number" ? `${l.n}. ` : "") + l.spans.map((s) => s.text).join("")).join(" ");
}

/** Wraps the selected text with a marker (or inserts an empty pair at the cursor). Returns the new text + cursor. */
export function wrapSelection(text: string, start: number, end: number, mark: string) {
  const sel = text.slice(start, end);
  const lead = sel.match(/^\s*/)![0];
  const trail = sel.match(/\s*$/)![0];
  const core = sel.slice(lead.length, sel.length - trail.length);
  const mid = mark === "```" ? `${mark}${core}${mark}` : `${mark}${core}${mark}`;
  const next = text.slice(0, start) + lead + mid + trail + text.slice(end);
  const cursor = core ? start + lead.length + mid.length : start + lead.length + mark.length;
  return { text: next, cursor };
}

// ------------------------------------------------------------------ long messages ("Read more")

/** Longest message, in characters (the server checks the same number). */
export const MAX_MESSAGE = 68_000;
/** Characters shown before the first "Read more"; each tap shows FOLD_STEP more (like WhatsApp). */
export const FOLD_FIRST = 700;
export const FOLD_STEP = 4000;
const FOLD_LINES = 16;

/**
 * The part of `text` to show when up to `limit` characters are visible.
 * Cuts at a line break or a space near the limit, and on the first fold also after FOLD_LINES lines.
 */
export function fold(text: string, limit: number): { text: string; more: boolean } {
  let cut = limit;
  if (limit === FOLD_FIRST) {
    let at = -1;
    for (let n = 0; n < FOLD_LINES; n++) { at = text.indexOf("\n", at + 1); if (at < 0) break; }
    if (at > 0 && at < cut) cut = at;
  }
  if (text.length <= cut) return { text, more: false };
  const near = Math.max(text.lastIndexOf("\n", cut), text.lastIndexOf(" ", cut));
  if (near > cut - 80 && near > 0) cut = near;
  return { text: text.slice(0, cut).trimEnd() + "…", more: true };
}
