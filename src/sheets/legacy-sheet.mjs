/**
 * 옛 DocumentSheet(V1) 형식으로 쓴 시트를 Foundry 14의 ActorSheetV2·ItemSheetV2 위에서 돌리는 바탕(V1 시트는 16에서 사라진다).
 * src/legacy-app.mjs(창)와 같은 생각: 각 시트는 getData()·template·activateListeners(html)를 그대로 쓰고 바탕 클래스만 바꾼다.
 *
 * V1과 같게 맞춘 점
 * - getData(): { cssClass, editable, owner, limited, options, document, actor|item, data(_source), items, effects } 위에 시트가 덧붙인다
 * - template(get)로 그린 HTML을 매번 새 감싸개에 넣고 activateListeners(html: jQuery)를 부른다(위임 리스너가 쌓이지 않게)
 * - 입력을 바꾸면 바로 문서에 저장(form.submitOnChange). 템플릿 맨 바깥은 <form> 대신 <div>(시트 자체가 form이다)
 * - 탭: static legacyTabs = [{ navSelector, contentSelector, initial }]. 다시 그려도 보던 탭을 유지
 * - 그림: <img data-edit="img" data-action="editImage">(V2 기본 동작). 시트가 _onEditImage(event, target)로 바꿀 수 있다
 * - 설명: <prose-mirror name="system.description" toggled value="원문">강화된 HTML</prose-mirror>
 */
const { Tabs } = foundry.applications.ux;

export function LegacySheet(Base) {
  return class LegacySheetBase extends Base {
    static DEFAULT_OPTIONS = {
      form: { submitOnChange: true, closeOnSubmit: false },
      window: { resizable: true },
      actions: { editImage: LegacySheetBase.#onEditImage }
    };

    /** [{ navSelector, contentSelector, initial }] */
    static legacyTabs = [];

    constructor(options = {}) {
      super(options);
      this._legacyTabs = (this.constructor.legacyTabs ?? []).map((t) => new Tabs({ ...t, callback: () => {} }));
    }

    /** V1 DocumentSheet#getData의 기본 자료 */
    async getData() {
      const doc = this.document;
      const key = doc.documentName === "Actor" ? "actor" : doc.documentName === "Item" ? "item" : "document";
      return {
        cssClass: this.isEditable ? "editable" : "locked",
        editable: this.isEditable,
        owner: doc.isOwner,
        limited: doc.limited,
        options: this.options,
        document: doc,
        [key]: doc,
        data: doc._source,
        items: doc.items ? doc.items.contents : undefined,
        effects: doc.effects ? doc.effects.contents : undefined
      };
    }

    /** V1 activateListeners(하위 클래스가 super로 부른다) */
    activateListeners() {}

    async _renderHTML(_context, options) {
      const data = await this.getData(options);
      const html = await foundry.applications.handlebars.renderTemplate(this.template, data);
      const wrap = document.createElement("div");
      wrap.className = "nssq-legacy-content";
      wrap.style.display = "contents";
      wrap.innerHTML = html;
      return wrap;
    }

    _replaceHTML(result, content) {
      // 다시 그릴 때 탭 안의 스크롤 위치를 지킨다
      const scrolls = [...content.querySelectorAll(".tab[data-tab]")].map((e) => [e.dataset.tab, e.scrollTop]);
      content.replaceChildren(result);
      for (const [tab, top] of scrolls) { const e = content.querySelector(`.tab[data-tab="${tab}"]`); if (e) e.scrollTop = top; }
      for (const t of this._legacyTabs) t.bind(content);
      try {
        this.activateListeners($(result));
      } catch (err) {
        console.error(`nssq | ${this.constructor.name} activateListeners failed`, err);
      }
    }

    /** 그림 바꾸기(시트가 _onEditImage로 가로챌 수 있다) */
    static async #onEditImage(event, target) {
      if (await this._onEditImage?.(event, target)) return;
      const attr = target.dataset.edit || "img";
      const current = foundry.utils.getProperty(this.document._source, attr);
      const fp = new foundry.applications.apps.FilePicker.implementation({
        current, type: "image",
        callback: (path) => this.document.update({ [attr]: path }),
        position: { top: this.position.top + 40, left: this.position.left + 10 }
      });
      return fp.browse();
    }
  };
}
