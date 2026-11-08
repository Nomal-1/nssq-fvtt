/**
 * 토큰 컨트롤(왼쪽 도구 막대)에 NSSQ 도구를 붙인다.
 * v13부터 getSceneControlButtons의 controls와 tools는 배열이 아니라 이름을 키로 쓰는 객체이고,
 * 토큰 컨트롤 이름은 "tokens", 클릭 처리는 onChange(event, active)다.
 */

/**
 * @param {Record<string, object>} controls getSceneControlButtons 훅의 인자
 * @param {{name: string, title: string, icon: string, toggle?: boolean, active?: boolean, onClick: (active?: boolean) => unknown}} tool
 */
export function addTokenTool(controls, { onClick, toggle = false, active = false, ...tool }) {
  const tokens = controls?.tokens;
  if (!tokens?.tools) return;
  const order = Math.max(0, ...Object.values(tokens.tools).map((t) => t.order ?? 0)) + 1;
  tokens.tools[tool.name] = {
    ...tool,
    order,
    visible: true,
    ...(toggle ? { toggle: true, active } : { button: true }),
    onChange: (_event, isActive) => onClick(isActive)
  };
}

/**
 * 사이드바 디렉터리(액터 탭 등) 머리에 버튼을 붙인다.
 * v13부터 render 훅의 html은 jQuery가 아니라 HTMLElement이고, 일부만 다시 그릴 때도 훅이 불리므로 이미 있으면 붙이지 않는다.
 * @param {HTMLElement} html render 훅의 인자
 * @param {{cls: string, icon: string, label: string, onClick: () => unknown}} button label은 HTML 이스케이프된 문자열
 */
export function addDirectoryButton(html, { cls, icon, label, onClick }) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actions = root?.querySelector(".directory-header .header-actions");
  if (!actions || actions.querySelector(`.${cls}`)) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.innerHTML = `<i class="${icon}"></i> ${label}`;
  btn.addEventListener("click", () => onClick());
  actions.append(btn);
}
