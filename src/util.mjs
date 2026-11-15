/**
 * 공용 도우미(Foundry를 쓰지 않는 순수 JS, 엔진에서도 쓸 수 있다)
 */

/** HTML 특수 문자를 바꾼다(채팅 카드·창에 사용자 문자열을 넣을 때) */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/*
 * 한국어 조사 고르기. 번역문에는 이름 자리 뒤에 「을(를)」「이(가)」「은(는)」「와(과)」「(으)로」처럼 둘 다 적어 두고,
 * 글자를 채운 뒤 앞 글자의 받침에 맞춰 하나만 남긴다(괄호·따옴표 같은 닫는 기호는 건너뛰고 본다).
 * 숫자는 읽는 소리(영·일·삼·육·칠·팔은 받침 있음, 일·칠·팔은 ㄹ), 영문은 대략(l·m·n 끝은 받침)으로 본다.
 */
const JOSA = {
  "을(를)": ["을", "를"],
  "이(가)": ["이", "가"],
  "은(는)": ["은", "는"],
  "와(과)": ["과", "와"],
  "(으)로": ["으로", "로"]
};
const JOSA_RE = /([가-힣A-Za-z0-9])([》」』）)\]"'】]*)(을\(를\)|이\(가\)|은\(는\)|와\(과\)|\(으\)로)/g;

function finalSound(c) {
  const code = c.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) {
    const jong = code % 28;
    return { batchim: jong !== 0, rieul: jong === 8 };
  }
  if (/[0-9]/.test(c)) return { batchim: "013678".includes(c), rieul: "178".includes(c) };
  const l = c.toLowerCase();
  return { batchim: "lmn".includes(l), rieul: l === "l" };
}

export function resolveJosa(text) {
  if (typeof text !== "string" || !text.includes("(")) return text;
  return text.replace(JOSA_RE, (all, ch, closers, form) => {
    const { batchim, rieul } = finalSound(ch);
    const [withB, withoutB] = JOSA[form];
    const pick = form === "(으)로" ? (batchim && !rieul ? withB : withoutB) : batchim ? withB : withoutB;
    return ch + closers + pick;
  });
}
