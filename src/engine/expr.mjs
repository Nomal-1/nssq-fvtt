/**
 * 수식 평가기 (03 §1). eval·Function을 쓰지 않는 재귀 하강 파서.
 * - 연산자 + - * /, 괄호, 단항 ±, 함수 floor min max abs
 * - 나눗셈은 항상 버림(01 공통 원칙)
 * - 변수: SL, R, LV(Lv) 등 이름(대소문자 무시), @self.x.y 같은 경로
 */

const FUNCS = {
  floor: (a) => Math.floor(a),
  abs: (a) => Math.abs(a),
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a)
};

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)|([-+*/(),]))/y;
  let m;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new SyntaxError(`수식 오류: '${src}' 의 ${pos}번째 글자`);
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: "path", v: m[2].slice(1) });
    else if (m[3] !== undefined) tokens.push({ t: "id", v: m[3] });
    else tokens.push({ t: "op", v: m[4] });
  }
  return tokens;
}

/** 파싱 결과(AST)를 캐시한다 */
const cache = new Map();

export function parse(src) {
  const key = String(src);
  if (cache.has(key)) return cache.get(key);
  const tokens = tokenize(key);
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => {
    const t = tokens[i];
    if (!t || (v !== undefined && t.v !== v)) throw new SyntaxError(`수식 오류: '${key}' 에서 '${v ?? "값"}' 이 필요`);
    i++;
    return t;
  };
  const expr = () => {
    let node = term();
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) node = { op: take().v, a: node, b: term() };
    return node;
  };
  const term = () => {
    let node = unary();
    while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) node = { op: take().v, a: node, b: unary() };
    return node;
  };
  const unary = () => {
    if (peek()?.t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = take().v;
      const a = unary();
      return op === "-" ? { op: "neg", a } : a;
    }
    return primary();
  };
  const primary = () => {
    const t = take();
    if (t.t === "num") return { num: t.v };
    if (t.t === "path") return { path: t.v };
    if (t.t === "op" && t.v === "(") {
      const e = expr();
      take(")");
      return e;
    }
    if (t.t === "id") {
      const name = t.v.toLowerCase();
      if (peek()?.v === "(" && FUNCS[name]) {
        take("(");
        const args = [];
        if (peek()?.v !== ")") {
          args.push(expr());
          while (peek()?.v === ",") { take(","); args.push(expr()); }
        }
        take(")");
        return { fn: name, args };
      }
      return { id: t.v.toUpperCase() };
    }
    throw new SyntaxError(`수식 오류: '${key}' 의 '${t.v}'`);
  };
  const ast = expr();
  if (i < tokens.length) throw new SyntaxError(`수식 오류: '${key}' 끝에 남은 '${tokens[i].v}'`);
  cache.set(key, ast);
  return ast;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * @param {string|number|null} src 수식. 숫자면 그대로, null/빈 문자열이면 0
 * @param {object} [vars] { SL, R, LV, …, self, target, owner, roll } — 이름 변수는 대문자 키
 */
export function evaluate(src, vars = {}) {
  if (src === null || src === undefined || src === "") return 0;
  if (typeof src === "number") return src;
  const upper = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toUpperCase(), v]));
  const run = (n) => {
    if ("num" in n) return n.num;
    if ("id" in n) {
      const v = upper[n.id];
      if (typeof v !== "number") throw new ReferenceError(`수식 변수 '${n.id}' 가 없다`);
      return v;
    }
    if ("path" in n) {
      const v = getPath(vars, n.path);
      if (typeof v !== "number") throw new ReferenceError(`수식 경로 '@${n.path}' 가 없다`);
      return v;
    }
    if ("fn" in n) return FUNCS[n.fn](...n.args.map(run));
    if (n.op === "neg") return -run(n.a);
    const a = run(n.a);
    const b = run(n.b);
    switch (n.op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return Math.floor(a / b);
    }
    throw new Error(`알 수 없는 연산 ${n.op}`);
  };
  return run(parse(src));
}
