// 변환기 공용 유틸: Notion 마크다운 표 파싱, 키·ID 생성, 문자열 정리
import crypto from "node:crypto";

/** Notion 이스케이프(\[ \] \~ \> 등) 제거 */
export function unescape(s) {
  return String(s ?? "").replace(/\\([[\]~>*_`#|()-])/g, "$1").trim();
}

/** <td> 안의 단순 마크업 제거 */
function cellText(s) {
  return unescape(
    s.replace(/<br\s*\/?>/g, "\n")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  );
}

/**
 * 마크다운 문자열 안의 <table>을 모두 찾아 { heading, header, rows } 배열로 돌려준다.
 * heading은 표 바로 앞의 가장 가까운 '#' 제목.
 */
export function parseTables(md) {
  const tables = [];
  const re = /<table[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(md))) {
    const before = md.slice(0, m.index);
    const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
    const heading = headings.length ? headings.at(-1)[1].trim() : "";
    const rows = [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => cellText(c[1]))
    );
    tables.push({ heading, header: rows[0] ?? [], rows: rows.slice(1) });
  }
  return tables;
}

/** 첫 줄의 notion 주석에서 페이지 ID */
export function notionId(md) {
  return md.match(/<!-- notion: ([0-9a-f]+)/)?.[1] ?? null;
}

/** 불변 키: NFKC → 공백·기호 제거 (02 §3) */
export function normalizeKey(s) {
  return String(s).normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 컴펜디움 _id = sha1(type:scope:key)의 base62 앞 16자 */
export function makeId(type, scope, key) {
  let n = BigInt("0x" + crypto.createHash("sha1").update(`${type}:${scope}:${key}`).digest("hex"));
  let out = "";
  while (n > 0n) {
    out = B62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(16, "0").slice(0, 16);
}

/** 원문 식 표기를 수식 평가기용 문자열로: (R의 제곱)×100 → (R*R)*100 */
export function formula(s) {
  const t = String(s).trim();
  if (t === "-" || t === "") return null;
  return t.replace(/R의 제곱/g, "R*R").replace(/Lv/g, "LV").replace(/×/g, "*").replace(/÷/g, "/").replace(/^\+/, "");
}

/** 해설 텍스트를 시트용 HTML 문단으로 */
export function toHTML(text) {
  if (!text) return "";
  return text.split(/\n+/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("");
}
