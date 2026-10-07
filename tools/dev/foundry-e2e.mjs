/* global game, ui, document, Setup, foundry */
// Foundry 테스트 월드에 Playwright(Chromium)로 접속하는 개발 도구.
// 환경 변수: NSSQ_FOUNDRY_URL, NSSQ_FOUNDRY_USER/PASSWORD(GM), NSSQ_FOUNDRY_PLAYER/PLAYER_PASSWORD(플레이어)
// 비밀번호는 출력하지 않는다.
//
// CLI
//   node tools/dev/foundry-e2e.mjs info   [gm|player] [--shot 파일.png]
//   node tools/dev/foundry-e2e.mjs eval   [gm|player] (-e "JS" | 파일.js) [--shot 파일.png]
//   node tools/dev/foundry-e2e.mjs shot   [gm|player] 파일.png
//   node tools/dev/foundry-e2e.mjs update [월드id=nssqtest] [--backup]   서버의 NSSQ 시스템을 최신 릴리스로 올리고 월드를 다시 켠다
//     (NSSQ_FOUNDRY_ADMIN_PASSWORD 필요. 켜진 월드가 다르면 끄지 않고 멈춘다. 접속자는 모두 튕긴다)
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

async function serverStatus(base) {
  const res = await fetch(`${base}/api/status`);
  return res.json();   // { active, version, world?, system?, systemVersion?, users? }
}

async function waitStatus(base, pred, timeout = 180_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const st = await serverStatus(base).catch(() => null);
    if (st && pred(st)) return st;
    if (Date.now() > end) throw new Error(`서버 상태 대기 시간 초과: ${JSON.stringify(st)}`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

/** 관리자 비밀번호로 월드를 끄고 NSSQ 시스템을 업데이트한 뒤 world를 다시 켠다. */
export async function updateSystem({ world = "nssqtest", backup = false, log = console.log } = {}) {
  const { chromium } = await loadPlaywright();
  const { base } = credentials("gm");
  const admin = process.env.NSSQ_FOUNDRY_ADMIN_PASSWORD;
  if (!admin) throw new Error("환경 변수가 없다: NSSQ_FOUNDRY_ADMIN_PASSWORD");

  const before = await serverStatus(base);
  if (before.active && before.world !== world) {
    throw new Error(`켜진 월드가 ${before.world}라 끄지 않는다(${world}만 업데이트 대상). 사용자에게 알릴 것`);
  }
  log(`업데이트 전: ${before.active ? `${before.world} 켜짐, ${before.system} ${before.systemVersion}, 접속 ${before.users}명` : "켜진 월드 없음"}`);

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const page = await browser.newPage();
  await relaySocket(page, base);
  try {
    // 1. 월드 끄기: 접속 화면의 「셋업으로 돌아가기」
    if (before.active) {
      await page.goto(`${base}/join`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.fill("#join-game-setup input[name=adminPassword]", admin);
      await Promise.all([page.waitForURL(/\/(setup|auth)/, { timeout: 120_000 }), page.click("#join-game-setup button[type=submit]")]);
      await waitStatus(base, st => !st.active);
      log(`${world} 종료`);
    }
    // 2. 셋업 화면(필요하면 관리자 인증)
    const openSetup = async () => {
      await page.goto(`${base}/setup`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (/\/auth/.test(page.url())) {
        await page.fill("input[name=adminPassword]", admin);
        await Promise.all([page.waitForURL(/\/setup/, { timeout: 60_000 }), page.click("form button[type=submit]")]);
      }
      await page.waitForFunction(() => globalThis.game?.constructor?.name === "Setup" && globalThis.ui?.setupPackages, null, { timeout: 60_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
    };
    // 3. 시스템 업데이트. 설치가 끝나면 셋업 화면이 새로고침될 수 있어 한 번 다시 확인한다
    const install = () => page.evaluate(async () => {
      const installed = game.systems.get("nssq")?.version;
      const check = await Setup.checkPackage({ type: "system", id: "nssq" });
      const remote = check?.remote;
      if (!remote) return { installed, error: `매니페스트 확인 실패: ${JSON.stringify(check).slice(0, 300)}` };
      if (!foundry.utils.isNewerVersion(remote.version, installed)) return { installed, remote: remote.version, now: installed, skipped: true };
      const pkg = await Setup.installPackage({ type: "system", id: "nssq", manifest: remote.manifest });
      return { installed, remote: remote.version, now: pkg.version };
    });
    await openSetup();
    let result;
    try {
      result = await install();
    } catch (e) {
      if (!/context was destroyed|navigation/i.test(e.message)) throw e;
      await openSetup();
      result = await install();
    }
    if (result.error) throw new Error(result.error);
    log(result.skipped ? `이미 최신: ${result.installed}` : `시스템 ${result.installed} → ${result.now}`);

    // 4. 월드 다시 켜기
    await openSetup();
    const launch = `[data-package-id="${world}"] [data-action=worldLaunch]`;
    await page.waitForSelector(launch, { state: "attached", timeout: 60_000 });
    await page.evaluate(sel => document.querySelector(sel).click(), launch);
    // 시스템 버전이 바뀌면 「월드 데이터 마이그레이션」 확인 창이 뜬다(백업 체크 상자 포함)
    const migrate = await page.waitForSelector(".app.dialog button[data-button=yes]", { timeout: 10_000 }).catch(() => null);
    if (migrate) {
      await page.evaluate(b => { const c = document.querySelector("#create-backup input"); if (c) c.checked = b; }, backup);
      await migrate.click();
      log(`마이그레이션 확인 창 진행(백업 ${backup ? "만듦" : "안 만듦"})`);
    }
    const after = await waitStatus(base, st => st.active && st.world === world);
    log(`${world} 켜짐: ${after.system} ${after.systemVersion}`);
    return { before: before.systemVersion ?? null, ...result, after: after.systemVersion };
  } finally {
    await browser.close().catch(() => {});
  }
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
  const backup = args.includes("--backup") && !!args.splice(args.indexOf("--backup"), 1);
  const code = take("-e");
  const [cmd = "info", role = "gm", file] = args;
  if (cmd === "update") {
    await updateSystem({ world: args[1] ?? "nssqtest", backup });
    // GM 접속으로 실제 로드된 버전 확인
    const s = await connect("gm");
    console.log(`GM 접속: ${await s.run(() => `${game.world.id} / ${game.system.id} ${game.system.version}`)}`);
    console.log(s.errors.length ? `콘솔 오류 ${s.errors.length}건:\n${s.errors.join("\n")}` : "콘솔 오류 없음");
    await s.close();
    process.exit(0);
  }
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
