/**
 * The page inside the note editor's WebView: the editable note AND its toolbar / Formatting / colour panels.
 * The buttons live in the page (not in the app) so tapping them never takes the cursor or the selection away from the
 * note — on Android that is what made Bold & co. do nothing. Taps act on `touchend` with preventDefault (no focus change).
 * App ↔ page: window.cmd({ type, … }) / ReactNativeWebView.postMessage(JSON): "ready" | "change" { html, text } |
 * "state" | "focus" | "blur" | "photo" | "link" (the last two ask the app to open its own sheet).
 * Photos are stored as <img data-file="id">; the page fills in their address (with the sign-in token) only for display.
 */
export type EditorTheme = { bg: string; text: string; muted: string; accent: string; accentSoft: string; accentStrong: string; border: string; card2: string };

const ICON: Record<string, string> = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  ul: '<circle cx="5" cy="7" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17" r="1.3" fill="currentColor"/><path d="M9 7h11M9 12h11M9 17h11"/>',
  ol: '<path d="M9 7h11M9 12h11M9 17h11"/><text x="2.5" y="9" font-size="6" fill="currentColor" stroke="none">1</text><text x="2.5" y="14.5" font-size="6" fill="currentColor" stroke="none">2</text><text x="2.5" y="20" font-size="6" fill="currentColor" stroke="none">3</text>',
  left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0,-6)"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12h2" transform="translate(0,-6)"/>',
  clear: '<path d="M6 5h12M12 5l-3 14"/><path d="M15 15l5 5M20 15l-5 5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  kb: '<rect x="3" y="5" width="18" height="10" rx="2"/><path d="M7 9h1M11 9h1M15 9h1M8 12h8M9 19l3 2 3-2"/>',
};
const svg = (n: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

const COLORS = ["#cccccc", "#9e9e9e", "#6b6b6b", "#3d3d3d", "#000000", "#7c4dff", "#e040fb", "#ff3355", "#f07850", "#f5c400", "#4cd97b", "#4dd8e0", "#03a9f4", "#2f6fff"];
const HIGHLIGHTS = ["#fff59d", "#ffcc80", "#ef9a9a", "#f48fb1", "#ce93d8", "#90caf9", "#80deea", "#a5d6a7", "#e6ee9c", "#bcaaa4"];

export function noteEditorHtml(t: EditorTheme, opts: { editable: boolean; placeholder: string; html: string; fileBase: string }) {
  const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const b = (act: string, inner: string, label: string, extra = "") => `<span class="tb" data-act="${act}" role="button" aria-label="${label}"${extra}>${inner}</span>`;
  const cell = (act: string, inner: string, label: string) => `<span class="cell" data-act="${act}" role="button" aria-label="${label}">${inner}</span>`;
  const swatches = (kind: string, list: string[]) => list.map((c) => `<span class="sw" data-act="${kind}:${c}" role="button" aria-label="${c}" style="background:${c}${c === "#000000" ? `;border:1px solid ${t.muted}` : ""}"></span>`).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;padding:0;background:${t.bg};color:${t.text};font-family:sans-serif;font-size:17px;line-height:1.5;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
  #ed{min-height:calc(100vh - 60px);box-sizing:border-box;padding:14px 16px ${opts.editable ? "140px" : "40px"};outline:none;word-wrap:break-word;overflow-wrap:anywhere;caret-color:${t.accent}}
  #ed:empty:before{content:attr(data-ph);color:${t.muted}}
  h1{font-size:1.6em;margin:.4em 0}h2{font-size:1.35em;margin:.4em 0}h3{font-size:1.15em;margin:.4em 0}
  p{margin:.2em 0}ul,ol{padding-left:1.4em;margin:.2em 0}
  blockquote{border-left:3px solid ${t.accent};margin:.4em 0;padding:.1em .8em;color:${t.muted}}
  a{color:${t.accent}}
  img{max-width:100%;border-radius:10px;display:block;margin:8px 0;background:${t.card2};min-height:40px}
  img.sel{outline:3px solid ${t.accent}}
  hr{border:0;border-top:1px solid ${t.border};margin:12px 0}
  .ck{position:relative;padding-left:32px;min-height:1.5em}
  .ck:before{content:"";position:absolute;left:2px;top:.22em;width:18px;height:18px;border:2px solid ${t.muted};border-radius:5px;box-sizing:border-box}
  .ck.done{color:${t.muted};text-decoration:line-through}
  .ck.done:before{background:${t.accent};border-color:${t.accent}}
  .ck.done:after{content:"";position:absolute;left:8px;top:.32em;width:5px;height:10px;border:solid #fff;border-width:0 2.5px 2.5px 0;transform:rotate(45deg)}
  /* toolbar + panels (in the page, so the note keeps the cursor) */
  #bar{position:fixed;left:0;right:0;bottom:0;background:${t.bg};border-top:1px solid ${t.border};z-index:5;user-select:none;-webkit-user-select:none}
  #tools{display:flex;align-items:center;gap:2px;overflow-x:auto;padding:4px 6px;scrollbar-width:none}
  #tools::-webkit-scrollbar{display:none}
  .tb{flex:0 0 auto;min-width:40px;height:40px;padding:0 7px;box-sizing:border-box;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:3px;font-weight:600;font-size:17px;color:${t.text}}
  .tb.on,.cell.on,.chip.on{background:${t.accentSoft};color:${t.accentStrong}}
  .tb.off{opacity:.35}
  .sep{flex:0 0 1px;height:26px;background:${t.border};margin:0 4px}
  #panel{display:none;padding:12px 14px 16px;max-height:52vh;overflow-y:auto;border-top-left-radius:16px;border-top-right-radius:16px}
  #panel.open{display:block}
  .ph{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:600;letter-spacing:.5px;margin-bottom:10px}
  .row{display:flex;gap:6px;margin-bottom:8px}
  .chips{display:flex;gap:6px;overflow-x:auto;margin-bottom:8px;scrollbar-width:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{flex:0 0 auto;padding:0 14px;height:40px;line-height:40px;border-radius:8px;background:${t.card2};font-size:15px}
  .cell{flex:1;height:46px;border-radius:8px;background:${t.card2};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600}
  .size{flex:2;display:flex;align-items:center;justify-content:space-between;background:${t.card2};border-radius:8px;height:46px}
  .size span.v{background:${t.bg};border-radius:6px;padding:4px 14px}
  .size .cell{background:none;flex:0 0 52px}
  .sws{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;padding-top:6px}
  .sw{width:40px;height:40px;border-radius:50%;display:inline-block;box-sizing:border-box}
  .auto{height:46px;border-radius:8px;border:2px solid ${t.accent};background:${t.card2};display:flex;align-items:center;justify-content:center;gap:8px;font-size:16px;margin-bottom:4px}
  .pane{display:none}.pane.open{display:block}
</style></head><body>
<div id="ed" contenteditable="${opts.editable ? "true" : "false"}" data-ph="${opts.placeholder.replace(/"/g, "&quot;")}"></div>
${opts.editable ? `<div id="bar">
  <div id="panel">
    <div class="pane" id="p-format">
      <div class="ph"><span>FORMATTING</span>${b("close", svg("close"), "Close")}</div>
      <div class="chips">
        <span class="chip" data-act="block:p" role="button">Normal</span><span class="chip" data-act="block:h1" role="button"><b>Title</b></span>
        <span class="chip" data-act="block:h2" role="button"><b>Heading</b></span><span class="chip" data-act="block:h3" role="button"><b>Subheading</b></span>
        <span class="chip" data-act="block:blockquote" role="button">Quote</span>
      </div>
      <div class="row">
        <div class="size">${cell("smaller", "−", "Smaller")}<span class="v" id="sizev">17</span>${cell("bigger", "+", "Bigger")}</div>
        ${cell("pane:color", `<span style="border-bottom:4px solid #ff3355;line-height:1">A</span>`, "Text colour")}
        ${cell("pane:highlight", `<span style="background:#fff59d;color:#222;padding:0 5px;border-radius:3px">A</span>`, "Highlight")}
      </div>
      <div class="chips">
        <span class="chip" data-act="font:sans-serif" role="button">Sans Serif</span><span class="chip" data-act="font:serif" role="button" style="font-family:serif">Serif</span>
        <span class="chip" data-act="font:monospace" role="button" style="font-family:monospace">Monospace</span><span class="chip" data-act="font:cursive" role="button" style="font-family:cursive">Handwriting</span>
      </div>
      <div class="row">${cell("bold", "<b>B</b>", "Bold")}${cell("italic", "<i>I</i>", "Italic")}${cell("underline", "<u>U</u>", "Underline")}${cell("justifyLeft", svg("left"), "Align left")}${cell("justifyCenter", svg("center"), "Align centre")}${cell("justifyRight", svg("right"), "Align right")}</div>
      <div class="row">${cell("strikeThrough", "<s>S</s>", "Strikethrough")}${cell("superscript", "x²", "Superscript")}${cell("subscript", "x₂", "Subscript")}${cell("link", svg("link"), "Link")}${cell("check", svg("check"), "Checklist")}${cell("clear", svg("clear"), "Clear formatting")}</div>
    </div>
    <div class="pane" id="p-color">
      <div class="ph"><span>FONT COLOR</span>${b("close", svg("close"), "Close")}</div>
      <div class="auto" data-act="color:" role="button">◐ Auto</div>
      <div class="sws">${swatches("color", COLORS)}</div>
    </div>
    <div class="pane" id="p-highlight">
      <div class="ph"><span>HIGHLIGHT</span>${b("close", svg("close"), "Close")}</div>
      <div class="auto" data-act="highlight:" role="button">⊘ None</div>
      <div class="sws">${swatches("highlight", HIGHLIGHTS)}</div>
    </div>
  </div>
  <div id="tools">
    ${b("photo", svg("camera"), "Add photo")}${b("check", svg("check"), "Checklist")}<span class="sep"></span>
    ${b("pane:format", "Aa", "Formatting")}
    ${b("bold", "<b>B</b>", "Bold")}${b("italic", '<i style="font-family:serif">I</i>', "Italic")}${b("underline", "<u>U</u>", "Underline")}
    ${b("insertUnorderedList", svg("ul"), "Bulleted list")}${b("insertOrderedList", svg("ol"), "Numbered list")}
    ${b("pane:color", `<span style="border-bottom:4px solid #ff3355;line-height:1">A</span>`, "Text colour")}${b("pane:highlight", `<span style="background:#fff59d;color:#222;padding:0 5px;border-radius:3px">A</span>`, "Highlight")}
    ${b("link", svg("link"), "Link")}<span class="sep"></span>${b("undo", svg("undo"), "Undo")}${b("redo", svg("redo"), "Redo")}${b("hidekb", svg("kb"), "Hide keyboard")}
  </div>
</div>` : ""}
<script>
(function(){
  var ed = document.getElementById('ed');
  var fileBase = ${js(opts.fileBase)};
  var saved = null, run, lastState = {};
  var post = function(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var BLOCKS = {P:1,DIV:1,H1:1,H2:1,H3:1,BLOCKQUOTE:1,LI:1};
  var ACTIVE = {bold:'bold', italic:'italic', underline:'underline', strikeThrough:'strike', superscript:'sup', subscript:'sub', insertUnorderedList:'ul', insertOrderedList:'ol', check:'check', justifyLeft:'alignleft', justifyCenter:'aligncenter', justifyRight:'alignright'};

  function paint(st){
    lastState = st;
    var bar = document.getElementById('bar'); if (!bar) return;
    bar.querySelectorAll('[data-act]').forEach(function(el){
      var a = el.getAttribute('data-act'), key = ACTIVE[a], on = false;
      if (key === 'alignleft') on = st.align === 'left'; else if (key === 'aligncenter') on = st.align === 'center'; else if (key === 'alignright') on = st.align === 'right';
      else if (key) on = !!st[key];
      else if (a.indexOf('block:') === 0) on = st.block === a.slice(6);
      else if (a.indexOf('font:') === 0) on = st.font === a.slice(5);
      el.classList.toggle('on', on);
      if (a === 'undo') el.classList.toggle('off', !st.canUndo);
      if (a === 'redo') el.classList.toggle('off', !st.canRedo);
    });
    var v = document.getElementById('sizev'); if (v) v.textContent = st.size || 17;
  }

  function fixImages(root){ (root||ed).querySelectorAll('img[data-file]').forEach(function(i){ if(fileBase) i.src = fileBase.replace('{id}', i.getAttribute('data-file')); }); }
  function cleanHtml(){
    var c = ed.cloneNode(true);
    c.querySelectorAll('img').forEach(function(i){ i.removeAttribute('src'); i.classList.remove('sel'); if(!i.className) i.removeAttribute('class'); });
    // font size=7 placeholders that never got converted
    c.querySelectorAll('font[size="7"]').forEach(function(f){ f.removeAttribute('size'); });
    c.querySelectorAll('b,strong,i,em,u,strike,s,del,sup,sub,span').forEach(function(n){ if (!n.textContent.replace(/\u200B/g, '') && !n.querySelector('img')) n.parentNode.removeChild(n); });
    var h = c.innerHTML.replace(/\u200B/g, '');
    return /^\\s*(<br>|<div><br><\\/div>)?\\s*$/.test(h) ? '' : h;
  }
  function text(){ return ed.innerText.replace(/\u200B/g, '').replace(/\\n{3,}/g,'\\n\\n').trim(); }
  var tm = null;
  function changed(){ clearTimeout(tm); tm = setTimeout(function(){ post({type:'change', html: cleanHtml(), text: text()}); }, 120); }

  function sel(){ return window.getSelection(); }
  function save(){ var s = sel(); if (s.rangeCount && ed.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); }
  function restore(){
    var s = sel();
    // still typing here: the live cursor is the right one (the saved copy can lag behind)
    if (document.activeElement === ed && s.rangeCount && ed.contains(s.anchorNode)) return;
    ed.focus(); if (saved){ s.removeAllRanges(); s.addRange(saved); }
  }
  function blockOf(node){
    while (node && node !== ed){ if (node.nodeType === 1 && BLOCKS[node.nodeName] && node.parentNode === ed) return node; if (node.nodeType===1 && node.nodeName==='LI') return node; node = node.parentNode; }
    return null;
  }
  function topBlock(node){ while (node && node.parentNode !== ed) node = node.parentNode; return node && node !== ed ? node : null; }
  function selectedBlocks(){
    var s = sel(); if (!s.rangeCount) return [];
    var r = s.getRangeAt(0), out = [];
    var a = topBlock(r.startContainer), b = topBlock(r.endContainer);
    if (!a){ document.execCommand('formatBlock', false, 'div'); a = topBlock(sel().getRangeAt(0).startContainer); b = a; }
    for (var n = a; n; n = n.nextSibling){ if (n.nodeType === 1) out.push(n); if (n === b) break; }
    return out;
  }

  function state(){
    var s = sel(); if (!s.rangeCount || !ed.contains(s.anchorNode)) return;
    var el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode;
    var cs = getComputedStyle(el);
    var b = topBlock(s.anchorNode);
    var q = function(c){ try { return document.queryCommandState(c); } catch(e){ return false; } };
    var en = function(c){ try { return document.queryCommandEnabled(c); } catch(e){ return false; } };
    var st = ({type:'state',
      bold:q('bold'), italic:q('italic'), underline:q('underline'), strike:q('strikeThrough'), sup:q('superscript'), sub:q('subscript'),
      ul:q('insertUnorderedList'), ol:q('insertOrderedList'), check: !!(b && b.classList && b.classList.contains('ck')),
      block: b ? (b.nodeName === 'DIV' || b.nodeName === 'P' ? 'p' : b.nodeName.toLowerCase()) : 'p',
      align: cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : 'left',
      size: Math.round(parseFloat(cs.fontSize)) || 17,
      font: /mono/i.test(cs.fontFamily) ? 'monospace' : /cursive/i.test(cs.fontFamily) ? 'cursive' : /^serif|, ?serif|georgia/i.test(cs.fontFamily) && !/sans/i.test(cs.fontFamily) ? 'serif' : 'sans-serif',
      canUndo: en('undo'), canRedo: en('redo')
    });
    post(st); paint(st);
  }

  // Bold / italic / … with just a cursor (nothing selected): on phones the keyboard's word suggestions throw away the
  // browser's "next letters are bold" flag, so put the cursor inside a real <b> (holding an invisible character) instead.
  var INLINE = {bold:'B', italic:'I', underline:'U', strikeThrough:'STRIKE', superscript:'SUP', subscript:'SUB'};
  var SAME = {B:['B','STRONG'], I:['I','EM'], U:['U'], STRIKE:['STRIKE','S','DEL'], SUP:['SUP'], SUB:['SUB']};
  function caretIn(node, offset){ var r = document.createRange(); r.setStart(node, offset); r.collapse(true); var s = sel(); s.removeAllRanges(); s.addRange(r); }
  function toggleInline(cmd){
    var s = sel();
    if (!s.rangeCount || !s.isCollapsed){ document.execCommand(cmd, false, null); return; }
    var tag = INLINE[cmd], r = s.getRangeAt(0);
    var anc = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    while (anc && anc !== ed && SAME[tag].indexOf(anc.nodeName) < 0) anc = anc.parentNode;
    if (!anc || anc === ed){
      var el = document.createElement(tag.toLowerCase()); var z = document.createTextNode('\u200B'); el.appendChild(z);
      r.insertNode(el); caretIn(z, 1); return;
    }
    if (anc.textContent === '\u200B'){ var t0 = document.createTextNode('\u200B'); anc.parentNode.replaceChild(t0, anc); caretIn(t0, 1); return; }
    // split the bold part at the cursor and continue in plain text between the two halves
    // formatting inside the bold part (italic, colour…) carries on
    var inner = [];
    for (var n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode; n && n !== anc; n = n.parentNode) inner.unshift(n.cloneNode(false));
    var rest = document.createRange(); rest.setStart(r.startContainer, r.startOffset); rest.setEnd(anc, anc.childNodes.length);
    var frag = rest.extractContents();
    var z2 = document.createTextNode('\u200B');
    var wrap = z2;
    for (var k = inner.length - 1; k >= 0; k--){ inner[k].appendChild(wrap); wrap = inner[k]; }
    anc.parentNode.insertBefore(wrap, anc.nextSibling);
    if (frag.textContent.replace(/\u200B/g, '')){ var clone = anc.cloneNode(false); clone.appendChild(frag); wrap.parentNode.insertBefore(clone, wrap.nextSibling); }
    caretIn(z2, 1);
  }

  function withCss(fn){ document.execCommand('styleWithCSS', false, true); fn(); document.execCommand('styleWithCSS', false, false); }
  function setSize(px){
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    var made = [];
    ed.querySelectorAll('font[size="7"]').forEach(function(f){ var sp = document.createElement('span'); sp.style.fontSize = px + 'px'; while (f.firstChild) sp.appendChild(f.firstChild); f.parentNode.replaceChild(sp, f); made.push(sp); });
    ed.querySelectorAll('span[style*="font-size: xxx-large"],span[style*="font-size: -webkit-xxx-large"]').forEach(function(s){ s.style.fontSize = px + 'px'; made.push(s); });
    // keep the same text selected, so the next button works on it too
    if (made.length){ var r = document.createRange(); r.setStartBefore(made[0].firstChild || made[0]); r.setEndAfter(made[made.length-1].lastChild || made[made.length-1]); var s2 = sel(); s2.removeAllRanges(); s2.addRange(r); }
  }
  function clearProp(prop){
    var s = sel(); if (!s.rangeCount) return;
    var r = s.getRangeAt(0);
    ed.querySelectorAll('span,font').forEach(function(n){
      if (!r.intersectsNode(n)) return;
      n.style.removeProperty(prop);
      if (prop === 'color') n.removeAttribute('color');
      if (n.nodeName === 'SPAN' && !n.getAttribute('style')) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.parentNode.removeChild(n); }
    });
  }
  function toggleCheck(){
    var blocks = selectedBlocks();
    var allOn = blocks.length && blocks.every(function(b){ return b.classList.contains('ck'); });
    blocks.forEach(function(b){
      if (b.nodeName === 'UL' || b.nodeName === 'OL') return;
      if (allOn){ b.classList.remove('ck','done'); if (!b.className) b.removeAttribute('class'); return; }
      var d = b;
      if (b.nodeName !== 'DIV'){ d = document.createElement('div'); while (b.firstChild) d.appendChild(b.firstChild); b.parentNode.replaceChild(d, b); }
      d.classList.add('ck');
    });
  }

  window.cmd = run = function(m){
    if (m.type === 'set'){
      fileBase = m.fileBase || fileBase;
      ed.innerHTML = m.html || '';
      fixImages();
      return;
    }
    if (m.type === 'blur'){ ed.blur(); return; }
    if (m.type === 'focus'){ restore(); return; }
    // commands from a panel keep the keyboard closed: put the selection back without focusing
    if (m.keep){ if (saved){ var ss = sel(); ss.removeAllRanges(); ss.addRange(saved); } } else restore();
    switch (m.type){
      case 'exec': if (INLINE[m.cmd]) toggleInline(m.cmd); else document.execCommand(m.cmd, false, m.value == null ? null : m.value); break;
      case 'block': document.execCommand('formatBlock', false, m.value === 'p' ? 'div' : m.value); break;
      case 'size': setSize(m.value); break;
      case 'font': withCss(function(){ document.execCommand('fontName', false, m.value); }); break;
      case 'color': if (m.value) withCss(function(){ document.execCommand('foreColor', false, m.value); }); else clearProp('color'); break;
      case 'highlight': if (m.value) withCss(function(){ document.execCommand('hiliteColor', false, m.value); }); else clearProp('background-color'); break;
      case 'check': toggleCheck(); break;
      case 'link':
        if (sel().isCollapsed) document.execCommand('insertHTML', false, '<a href="' + m.value.replace(/"/g,'&quot;') + '">' + (m.text || m.value).replace(/</g,'&lt;') + '</a>&nbsp;');
        else document.execCommand('createLink', false, m.value);
        break;
      case 'image':
        document.execCommand('insertHTML', false, '<img data-file="' + m.id + '"><div><br></div>');
        fixImages();
        break;
      case 'replace': document.execCommand('selectAll'); document.execCommand('insertHTML', false, m.html); fixImages(); break;
      case 'clear': document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'div'); break;
    }
    save(); changed(); state();
  };

  ed.addEventListener('input', function(){ changed(); state(); });
  document.addEventListener('selectionchange', function(){ save(); state(); });
  ed.addEventListener('focus', function(){ post({type:'focus'}); });
  ed.addEventListener('blur', function(){ post({type:'blur'}); });
  ed.addEventListener('keydown', function(e){
    if (e.key !== 'Enter') return;
    var b = topBlock(sel().anchorNode);
    if (b && b.classList && b.classList.contains('ck')){
      if (!b.textContent.trim()){ e.preventDefault(); b.classList.remove('ck','done'); if (!b.className) b.removeAttribute('class'); changed(); state(); return; }
      setTimeout(function(){ var n = topBlock(sel().anchorNode); if (n && n !== b && n.classList) n.classList.remove('done'); changed(); }, 0);
    }
  });
  // tick a checklist item by tapping its box (works when reading too)
  ed.addEventListener('click', function(e){
    ed.querySelectorAll('img.sel').forEach(function(i){ i.classList.remove('sel'); });
    var t = e.target;
    if (t.nodeName === 'IMG'){ t.classList.add('sel'); return; }
    var b = t.nodeType === 1 && t.classList && t.classList.contains('ck') ? t : null;
    if (b && e.clientX - b.getBoundingClientRect().left < 30){ e.preventDefault(); b.classList.toggle('done'); changed(); post({type:'tick'}); }
  });
  document.execCommand('defaultParagraphSeparator', false, 'div');

  // ---- toolbar & panels: act on touchend (preventDefault = the note keeps focus, cursor and selection)
  function pane(name){
    var panel = document.getElementById('panel');
    document.querySelectorAll('.pane').forEach(function(p){ p.classList.toggle('open', p.id === 'p-' + name); });
    panel.classList.toggle('open', !!name);
  }
  function act(a){
    var i = a.indexOf(':'), kind = i < 0 ? a : a.slice(0, i), val = i < 0 ? null : a.slice(i + 1);
    if (kind === 'pane'){ pane(val); return; }
    if (kind === 'close'){ pane(null); return; }
    if (kind === 'photo' || kind === 'link'){ save(); post({type: kind}); return; }
    if (kind === 'hidekb'){ pane(null); ed.blur(); return; }
    if (kind === 'smaller' || kind === 'bigger'){ var sz = (lastState.size || 17) + (kind === 'bigger' ? 1 : -1); run({type:'size', value: Math.max(10, Math.min(40, sz))}); return; }
    if (kind === 'block' || kind === 'font' || kind === 'color' || kind === 'highlight'){ run({type: kind, value: val}); return; }
    if (kind === 'check' || kind === 'clear'){ run({type: kind}); return; }
    run({type:'exec', cmd: kind});
  }
  var bar = document.getElementById('bar');
  if (bar){
    var start = null;
    bar.addEventListener('touchstart', function(e){ var t = e.touches[0]; start = {x: t.clientX, y: t.clientY}; }, {passive: true});
    bar.addEventListener('touchend', function(e){
      var t = e.changedTouches[0], el = e.target.closest ? e.target.closest('[data-act]') : null;
      var moved = start && (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10);
      e.preventDefault(); // no mouse events → no focus change
      if (el && !moved) act(el.getAttribute('data-act'));
    });
    bar.addEventListener('mousedown', function(e){ e.preventDefault(); });
    bar.addEventListener('click', function(e){ var el = e.target.closest('[data-act]'); if (el) act(el.getAttribute('data-act')); });
  }

  document.execCommand('defaultParagraphSeparator', false, 'div');
  ed.innerHTML = ${js(opts.html)};
  fixImages();
  post({type:'ready'});
})();
</script></body></html>`;
}
