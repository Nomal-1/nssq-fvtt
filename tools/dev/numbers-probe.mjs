// 효과 종류별 「숫자 반영」 점검(강화·약화·상태 이상·상시 보정·대기 자세 → 전투 프로필 → 실제 공격·스킬·회복·부여·종료 페이즈).
// 기대값은 01 §3.8~3.10. 테스트 월드에서 [e2e] 캐릭터·에너미로 돌리고 정리한다. 결과: build/numbers-probe.json
// 실행: node tools/dev/numbers-probe.mjs
/* global window, ui, Dialog -- page.evaluate 안(브라우저)에서 쓴다 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { connect } from "./foundry-e2e.mjs";
const s = await connect("gm");
const code = readFileSync(new URL("./numbers-probe.js", import.meta.url), "utf8");
let done = false;
const p = s.run(code).then((r) => { done = true; return r; }).catch((e) => { done = true; return { err: String(e) }; });
const t0 = Date.now();
while (!done && Date.now() - t0 < 420000) {
  await new Promise((r) => setTimeout(r, 10000));
  if (done) break;
  const st = await s.page.evaluate(() => ({ p: window.__probe, n: window.__probeRows?.length, last: window.__probeRows?.at(-1)?.cas, dlg: Object.values(ui.windows).filter((w) => w instanceof Dialog).map((w) => w.title) })).catch((e) => String(e));
  appendFileSync("build/numbers-progress.txt", Math.round((Date.now() - t0) / 1000) + "s " + JSON.stringify(st) + "\n");
}
const r = done ? await p : { err: "timeout" };
console.log(r.err ?? `${r.okCount}/${r.total}`); for (const f of r.fail ?? []) console.log("X", f.cat, f.cas, f.exp, f.act);
writeFileSync("build/numbers-probe.json", JSON.stringify(r, null, 1));
console.log("errors", JSON.stringify(s.errors));
await s.close(); process.exit(0);
