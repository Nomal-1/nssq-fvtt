/* global game, ui, document */
// Foundry 테스트 월드에 Playwright(Chromium)로 접속하는 개발 도구.
// 환경 변수: NSSQ_FOUNDRY_URL, NSSQ_FOUNDRY_USER/PASSWORD(GM), NSSQ_FOUNDRY_PLAYER/PLAYER_PASSWORD(플레이어)
// 비밀번호는 출력하지 않는다.
//
// CLI
//   node tools/dev/foundry-e2e.mjs info   [gm|player] [--shot 파일.png]
//   node tools/dev/foundry-e2e.mjs eval   [gm|player] (-e "JS" | 파일.js) [--shot 파일.png]
//   node tools/dev/foundry-e2e.mjs shot   [gm|player] 파일.png
// eval 코드는 async 함수 본문으로 월드 안에서 실행되고, return 값을 JSON으로 출력한다.
//
// 라이브러리
//   import { connect } from "./foundry-e2e.mjs";
//   const s = await connect("gm");           // { page, errors, run(fnOrCode, arg), shot(path), close() }
//   await s.run(() => game.user.name);
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* 전역 설치를 찾는다 */ }
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  return createRequire(root + "/")("playwright");
}

function credentials(role) {
  const env = process.env;
  const base = env.NSSQ_FOUNDRY_URL;
  const [user, pass] = role === "player"
    ? [env.NSSQ_FOUNDRY_PLAYER, env.NSSQ_FOUNDRY_PLAYER_PASSWORD]
    : [env.NSSQ_FOUNDRY_USER, env.NSSQ_FOUNDRY_PASSWORD];
  if (!base || !user) throw new Error(`환경 변수가 없다: NSSQ_FOUNDRY_URL / ${role === "player" ? "NSSQ_FOUNDRY_PLAYER" : "NSSQ_FOUNDRY_USER"}`);
  return { base: base.replace(/\/$/, ""), user, pass: pass ?? "" };
}

// 클라우드 컨테이너의 Chromium은 ws:// 업그레이드가 400으로 막힌다(curl로는 된다).
// socket.io 연결만 Node의 WebSocket으로 대신 맺어 중계한다.
async function relaySocket(page, base) {
  const sockets = new Set();
  await page.routeWebSocket(/\/socket\.io\//, route => {
    const session = new URL(route.url()).searchParams.get("session");
    const srv = new WebSocket(route.url(), { headers: { Origin: base, ...(session ? { Cookie: `session=${session}` } : {}) } });
    sockets.add(srv);
    srv.binaryType = "arraybuffer";
    const queue = [];
    srv.onopen = () => { for (const m of queue) srv.send(m); queue.length = 0; };
    srv.onmessage = e => { try { route.send(typeof e.data === "string" ? e.data : Buffer.from(e.data)); } catch { /* 페이지 닫힘 */ } };
    srv.onclose = e => { sockets.delete(srv); route.close({ code: e.code === 1005 ? 1000 : e.code, reason: e.reason }).catch(() => {}); };
    route.onMessage(m => (srv.readyState === 1 ? srv.send(m) : queue.push(m)));
    route.onClose(() => srv.close());
  });
  return sockets;
}

/** 로그인해서 game.ready까지 기다린 세션을 돌려준다. */
export async function connect(role = "gm", { viewport = { width: 1600, height: 1000 }, browser, user: asUser, password } = {}) {
  const { chromium } = await loadPlaywright();
  // user를 주면 그 계정으로(관전 계정 등). 비밀번호가 없으면 빈 칸
  const cred = credentials(role);
  const { base } = cred;
  const user = asUser ?? cred.user;
  const pass = asUser ? (password ?? "") : cred.pass;
  const ownBrowser = !browser;
  browser ??= await chromium.launch({ args: ["--no-proxy-server"] });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/WebGL|GroupMarkerNotSet|favicon/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  const sockets = await relaySocket(page, base);

  await page.goto(`${base}/join`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("select[name=userid]", { timeout: 60_000 });
  const options = await page.$$eval("select[name=userid] option", os => os.map(o => ({ v: o.value, t: o.textContent.trim() })));
  const target = options.find(o => o.t === user);
  if (!target) throw new Error(`접속 화면에 사용자 ${user}가 없다`);
  // 접속 화면은 소켓으로 사용자 목록(접속 중이면 비활성)을 늦게 갱신한다
  await page.waitForFunction((v) => {
    const o = document.querySelector(`select[name=userid] option[value="${v}"]`);
    return o && !o.disabled;
  }, target.v, { timeout: 20_000 }).catch(() => { throw new Error(`사용자 ${user}는 이미 접속 중이라 고를 수 없다`); });
  await page.selectOption("select[name=userid]", target.v);
  await page.fill("input[name=password]", pass);
  await Promise.all([
    page.waitForURL(/\/game/, { timeout: 60_000 }),
    page.click("button[name=join]"),
  ]);
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
  // 하드웨어 가속 경고 등 알림 닫기
  await page.evaluate(() => ui.notifications?.clear?.()).catch(() => {});

  return {
    page, errors, role, user,
    /** 함수 또는 async 함수 본문 문자열을 월드에서 실행 */
    run(fn, arg) {
      if (typeof fn === "function") return page.evaluate(fn, arg);
      return page.evaluate(([code, a]) => new (Object.getPrototypeOf(async function () {}).constructor)("arg", code)(a), [fn, arg]);
    },
    shot(path, opts = {}) { return page.screenshot({ path, ...opts }); },
    async close() {
      for (const s of sockets) s.close();
      await context.close().catch(() => {});
      if (ownBrowser) await browser.close().catch(() => {});
    },
  };
}

export const worldInfo = () => ({
  foundry: game.version,
  system: `${game.system.id} ${game.system.version}`,
  world: `${game.world.id} (${game.world.title})`,
  user: game.user.name, isGM: game.user.isGM,
  lang: game.i18n.lang,
  actors: game.actors.size, items: game.items.size, scenes: game.scenes.size, combats: game.combats.size,
  users: game.users.map(u => `${u.name}${u.isGM ? "[GM]" : ""}${u.active ? "*" : ""}`),
});

async function main() {
  const args = process.argv.slice(2);
  const take = flag => { const i = args.indexOf(flag); if (i < 0) return undefined; const [, v] = args.splice(i, 2); return v; };
  const shotPath = take("--shot");
  const code = take("-e");
  const [cmd = "info", role = "gm", file] = args;
  const s = await connect(role);
  let out;
  try {
    if (cmd === "info") out = await s.run(worldInfo);
    else if (cmd === "eval") out = await s.run(code ?? readFileSync(file, "utf8"));
    else if (cmd === "shot") await s.shot(file ?? "foundry.png");
    else throw new Error(`알 수 없는 명령: ${cmd}`);
    if (shotPath) await s.shot(shotPath);
    if (out !== undefined) console.log(JSON.stringify(out, null, 2));
    console.log(s.errors.length ? `콘솔 오류 ${s.errors.length}건:\n${s.errors.join("\n")}` : "콘솔 오류 없음");
  } finally {
    await s.close();
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e.message ?? e); process.exit(1); });
}
