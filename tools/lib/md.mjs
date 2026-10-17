// 마크다운 → 저널 페이지 HTML(작은 변환기, 의존성 없음).
// 대상: data/raw(Notion 내보내기: 제목·목록·인용·HTML 표·callout)와 data/journals의 글.
// 지원: # 제목, 문단, - / 1. 목록(탭·공백 들여쓰기 중첩), > 인용, --- 구분선, | 표 |, **굵게**, *기울임*, `코드`, [글](주소),
//       원문 HTML(<table> 등)은 그대로. 지우는 것: <!-- 주석 -->, ![](이미지 생략), <database>, <empty-block/>
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 한 줄 안의 꾸밈. 이미 HTML 태그가 섞인 줄은 태그를 건드리지 않는다 */
function inline(s) {
  const parts = s.split(/(<[^>]+>)/);
  return parts.map((p) => {
    if (p.startsWith("<") && p.endsWith(">")) return p;
    let t = esc(p);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => `<a href="${url.replace(/"/g, "%22")}">${txt}</a>`);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    return t;
  }).join("");
}

const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const depthOf = (ws) => ws.replace(/\t/g, "  ").length >> 1;

/**
 * @param {string} md
 * @param {{ dropTitle?: boolean }} [opts] 첫 # 제목을 뺀다(페이지 이름과 같을 때)
 * @returns {string}
 */
export function mdToHtml(md, { dropTitle = false } = {}) {
  let text = md.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<database[^>]*>[\s\S]*?<\/database>/g, "").replace(/<empty-block\/>/g, "")
    .replace(/<callout[^>]*>/g, "<blockquote class=\"nssq-callout\">").replace(/<\/callout>/g, "</blockquote>")
    // Notion 표 꼬리표·열 너비는 Foundry 저널에서 쓸모가 없다
    .replace(/<table header-row="true">/g, "<table class=\"nssq-table head\">").replace(/<colgroup>[\s\S]*?<\/colgroup>/g, "");
  const lines = text.split("\n");
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  let titleDropped = !dropTitle;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();
    if (!trim) { flush(); continue; }
    // 원문 HTML 블록(표·인용 상자): 닫는 태그까지 그대로
    const block = trim.match(/^<(table|blockquote|details|ul|ol)\b/);
    if (block) {
      flush();
      const tag = block[1];
      const buf = [];
      let depth = 0;
      for (; i < lines.length; i++) {
        const l = lines[i];
        depth += (l.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length - (l.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
        if (l.trim()) buf.push(inline(l.trim()));
        if (depth <= 0) break;
      }
      let html = buf.join(tag === "blockquote" ? "<br>" : "").replace(/<br><\/blockquote>/, "</blockquote>").replace(/(<blockquote[^>]*>)<br>/, "$1");
      // 머리 줄이 있는 표: 첫 줄을 th로
      if (tag === "table" && html.startsWith('<table class="nssq-table head">')) html = html.replace(/<tr>([\s\S]*?)<\/tr>/, (_, row) => `<tr>${row.replace(/<td>/g, "<th>").replace(/<\/td>/g, "</th>")}</tr>`);
      out.push(html);
      continue;
    }
    const h = trim.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      if (!titleDropped && h[1].length === 1) { titleDropped = true; continue; }
      const lv = Math.min(6, h[1].length);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trim)) { flush(); out.push("<hr>"); continue; }
    if (trim.startsWith(">")) {
      flush();
      const buf = [];
      for (; i < lines.length && lines[i].trim().startsWith(">"); i++) buf.push(inline(lines[i].trim().replace(/^>\s?/, "")));
      i--;
      out.push(`<blockquote>${buf.join("<br>")}</blockquote>`);
      continue;
    }
    // 마크다운 표
    if (trim.startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(trim);
      i += 2;
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table class="nssq-table head"><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (LIST.test(line)) {
      flush();
      // 연속한 목록 줄을 들여쓰기 깊이로 중첩
      const stack = [];
      let html = "";
      for (; i < lines.length; i++) {
        const m = lines[i].match(LIST);
        if (!m) {
          // 목록 항목에 이어진 들여쓴 줄
          if (lines[i].trim() && /^\s+/.test(lines[i]) && stack.length) { html += ` ${inline(lines[i].trim())}`; continue; }
          break;
        }
        const d = depthOf(m[1]);
        const type = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length > d + 1) html += `</li></${stack.pop()}>`;
        if (stack.length === d + 1) html += "</li>";
        while (stack.length < d + 1) { html += `<${type}>`; stack.push(type); }
        html += `<li>${inline(m[3])}`;
      }
      while (stack.length) html += `</li></${stack.pop()}>`;
      i--;
      out.push(html);
      continue;
    }
    para.push(trim);
  }
  flush();
  return out.join("\n");
}

/**
 * 「# 제목」마다 페이지로 나눈다(앞의 글은 첫 페이지에)
 * @returns {{ name: string, html: string }[]}
 */
export function splitPages(md) {
  const pages = [];
  let cur = null;
  for (const line of md.replace(/\r/g, "").split("\n")) {
    const h = line.match(/^#\s+(.*)$/);
    if (h) { cur = { name: h[1].trim(), body: [] }; pages.push(cur); continue; }
    if (!cur) { cur = { name: "", body: [] }; pages.push(cur); }
    cur.body.push(line);
  }
  return pages.filter((p) => p.name || p.body.join("").trim()).map((p) => ({ name: p.name, html: mdToHtml(p.body.join("\n")) }));
}
