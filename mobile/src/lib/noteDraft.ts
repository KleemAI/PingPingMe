/**
 * Hand-over between the task screen and the full-screen note editor: the task screen puts the note here and opens
 * /task/note; the editor writes the result back and goes back; the task screen picks it up when it's shown again.
 */
type Draft = { html: string; readOnly: boolean; title: string; result?: string };
let draft: Draft = { html: "", readOnly: false, title: "" };

export const noteDraft = {
  open(d: Omit<Draft, "result">) { draft = { ...d }; },
  get: () => draft,
  finish(html: string) { draft = { ...draft, result: html }; },
  /** the edited note, once (undefined when nothing came back) */
  take() { const r = draft.result; draft = { ...draft, result: undefined }; return r; },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** An old plain-text note as editor HTML. */
export const plainToHtml = (text: string) => text ? text.split("\n").map((l) => `<div>${l ? esc(l) : "<br>"}</div>`).join("") : "";

/** Plain text of a formatted note, for the preview on the task screen. */
export function htmlToText(html: string) {
  return html
    .replace(/<div class="ck done">/g, "☑ ").replace(/<div class="ck">/g, "☐ ")
    .replace(/<li[^>]*>/g, "• ").replace(/<img[^>]*>/g, "\n📷 Photo\n")
    .replace(/<(br|\/p|\/div|\/h[1-3]|\/li|\/blockquote)[^>]*>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** The task's title: the first line of its note. */
export const titleOf = (html: string) => (htmlToText(html).split("\n").map((l) => l.replace(/^[☐☑•]\s*/, "").trim()).find((l) => l && l !== "📷 Photo") ?? "").slice(0, 200);

/** An old task (title + separate note) as one note whose first line is the title. */
export function noteWithTitle(title: string, html: string) {
  if (!title.trim() || titleOf(html) === title.trim().slice(0, 200)) return html;
  return `<div>${esc(title.trim())}</div>${html}`;
}
