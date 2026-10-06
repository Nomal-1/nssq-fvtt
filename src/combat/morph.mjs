/**
 * 전투 화면을 매번 통째로 바꾸지 않고, 바뀐 부분만 고친다(깜빡임·애니메이션 재생 방지).
 * - data-key가 있는 요소는 같은 키끼리 이어 쓴다(상반신·카드가 다시 만들어지지 않는다)
 * - flip: 다시 그리기 전후의 위치를 비교해, 자리를 옮긴 요소(열 이동·순서 변경)를 미끄러지듯 옮긴다
 */

function syncAttrs(from, to) {
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
}

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute("data-key") : null);

function morphChildren(from, to) {
  const oldKids = [...from.childNodes];
  const keyed = new Map(oldKids.filter(keyOf).map((n) => [keyOf(n), n]));
  const used = new Set();
  const result = [];
  let i = 0;
  for (const nn of [...to.childNodes]) {
    let match = null;
    const k = keyOf(nn);
    if (k) {
      const o = keyed.get(k);
      if (o && o.tagName === nn.tagName && !used.has(o)) match = o;
    } else {
      while (i < oldKids.length) {
        const o = oldKids[i++];
        if (keyOf(o) || used.has(o)) continue;
        if (o.nodeType === nn.nodeType && (o.nodeType !== 1 || o.tagName === nn.tagName)) {
          match = o;
          break;
        }
      }
    }
    if (match) {
      used.add(match);
      if (match.nodeType === 1) morphElement(match, nn);
      else if (match.nodeValue !== nn.nodeValue) match.nodeValue = nn.nodeValue;
      result.push(match);
    } else result.push(nn);
  }
  for (const o of oldKids) if (!used.has(o)) o.remove();
  result.forEach((n, idx) => {
    if (from.childNodes[idx] !== n) from.insertBefore(n, from.childNodes[idx] ?? null);
  });
}

function morphElement(from, to) {
  syncAttrs(from, to);
  morphChildren(from, to);
}

/** root의 내용을 html로 바꾼다(바뀐 곳만) */
export function morph(root, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  morphChildren(root, tpl.content);
}

/** 키 있는 요소들의 지금 위치 */
export function snapshot(root) {
  const out = new Map();
  for (const el of root.querySelectorAll("[data-flip]")) out.set(el.getAttribute("data-key"), el.getBoundingClientRect());
  return out;
}

/** 위치가 바뀐 요소를 이전 자리에서 새 자리로 미끄러지게 */
export function flip(root, before, { duration = 450 } = {}) {
  for (const el of root.querySelectorAll("[data-flip]")) {
    const old = before.get(el.getAttribute("data-key"));
    if (!old) continue;
    const now = el.getBoundingClientRect();
    if (!now.width || !now.height) continue;
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    const sx = old.width / now.width;
    const sy = old.height / now.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    el.animate([
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: "top left", transform: "none" }
    ], { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}
