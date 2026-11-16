/**
 * 옛 Application(V1) 형식으로 쓴 창을 그대로 ApplicationV2 위에서 돌리는 공통 바탕 클래스(V1은 16에서 사라진다).
 * 각 창은 `extends foundry.appv1.api.Application` → `extends LegacyApp`으로만 바꾸고, 아래 V1 방식을 그대로 쓴다.
 *
 * - static get defaultOptions(): { id, classes, title, template, width, height, resizable, scrollY, tabs } (super.defaultOptions와 합친다)
 * - getData() → 템플릿 자료, 또는 _renderInner(data) → HTML(jQuery·문자열·요소)을 돌려준다
 * - activateListeners(html): html은 이번에 그린 내용을 감싼 jQuery. 다시 그릴 때마다 새 내용에 다시 붙는다
 * - get title(), close(options), render()/render(true), setPosition, rendered는 V2의 것을 그대로 쓴다
 * 다른 점: this.element는 V2처럼 HTMLElement다(V1의 this.element[0] 자리). 렌더 훅은 V2 형식(render{클래스명}(app, element)).
 */
const { ApplicationV2 } = foundry.applications.api;

export class LegacyApp extends ApplicationV2 {
  static get defaultOptions() {
    return { id: "", classes: [], title: "", template: null, width: 400, height: "auto", resizable: false, scrollY: [], tabs: [] };
  }

  constructor(options = {}) {
    const o = foundry.utils.mergeObject(new.target.defaultOptions, options, { inplace: false });
    const config = {
      classes: o.classes ?? [],
      window: { title: o.title ?? "", resizable: !!o.resizable },
      position: { width: o.width ?? 400, height: o.height ?? "auto" }
    };
    if (o.id) config.id = o.id;
    if (o.left !== undefined && o.left !== null) config.position.left = o.left;
    if (o.top !== undefined && o.top !== null) config.position.top = o.top;
    super(config);
    /** V1 형식으로 합친 옵션(this.options는 V2 설정이라 따로 둔다) */
    this.legacyOptions = o;
    this._legacyTabs = (o.tabs ?? []).map((t) => new foundry.applications.ux.Tabs({ ...t, callback: (...args) => this._onChangeTab?.(...args) }));
  }

  /** V1의 기본 동작: template을 getData() 자료로 그린다 */
  async _renderInner(data) {
    if (!this.legacyOptions.template) return "";
    return foundry.applications.handlebars.renderTemplate(this.legacyOptions.template, data ?? {});
  }

  /** V1 Application#activateListeners(하위 클래스가 super로 부른다) */
  activateListeners() {}

  async _renderHTML(_context, options) {
    const data = typeof this.getData === "function" ? await this.getData(options) : {};
    const html = await this._renderInner(data, options);
    // 다시 그릴 때마다 새 감싸개에 넣어, activateListeners가 붙인 위임 리스너가 쌓이지 않게 한다(레이아웃에는 영향 없음)
    const wrap = document.createElement("div");
    wrap.className = "nssq-legacy-content";
    wrap.style.display = "contents";
    if (html?.jquery) wrap.append(...html.toArray());
    else if (html instanceof Node) wrap.append(html);
    else wrap.innerHTML = String(html ?? "");
    return wrap;
  }

  _replaceHTML(result, content) {
    const scrollSel = this.legacyOptions.scrollY ?? [];
    const scrolls = scrollSel.map((sel) => [...content.querySelectorAll(sel)].map((e) => e.scrollTop));
    content.replaceChildren(result);
    scrollSel.forEach((sel, i) => [...content.querySelectorAll(sel)].forEach((e, j) => { if (scrolls[i]?.[j] !== undefined) e.scrollTop = scrolls[i][j]; }));
    for (const t of this._legacyTabs) t.bind(content);
    try {
      this.activateListeners($(result));
    } catch (err) {
      console.error(`nssq | ${this.constructor.name} activateListeners failed`, err);
    }
  }

  /** V1 이름 */
  bringToTop() {
    return this.bringToFront?.();
  }
}
