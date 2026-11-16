/**
 * 옛 Dialog(V1) 형식을 그대로 받아 Foundry 14의 DialogV2로 띄우는 공통 도우미(V1 Dialog는 16에서 사라진다).
 * 호출부는 `foundry.appv1.api.Dialog.prompt(` → `Dialog.prompt(`, `new foundry.appv1.api.Dialog(` → `new Dialog(` 정도만 바뀐다.
 *
 * V1과 같게 맞춘 점
 * - 버튼 callback(html, event)의 html은 창 전체를 감싼 jQuery — html[0].querySelector·html.find가 그대로 된다
 * - wait: 누른 버튼 callback의 결과(없으면 버튼 이름)로 끝난다. 버튼 없이 닫으면 close()의 결과, 그것도 없으면 오류(reject)
 * - prompt: rejectClose 기본 true(닫으면 오류), false면 null. confirm: yes()/no() 결과 또는 true/false, 닫으면 null(rejectClose면 오류)
 * - close(html)는 버튼으로 닫혀도 불린다. render(html)는 처음 그려질 때 한 번
 * - 내용의 <form>…</form>은 벗긴다(DialogV2가 자기 form 안에 넣으므로 겹치면 버튼이 밖으로 밀린다)
 */
const { DialogV2 } = foundry.applications.api;

const stripForm = (content) => String(content ?? "").replace(/<\/?form\b[^>]*>/gi, "");
const iconClass = (icon) => (icon ? String(icon).match(/class="([^"]+)"/)?.[1] ?? String(icon) : undefined);

export class Dialog extends DialogV2 {
  #v1;
  #renderedOnce = false;
  /** 버튼을 눌러 끝났는지(닫기만 했는지 구분) */
  answered = false;

  constructor(data = {}, options = {}) {
    const entries = Object.entries(data.buttons ?? {});
    const buttons = entries.map(([action, b]) => ({
      action,
      label: b.label ?? action,
      icon: iconClass(b.icon),
      default: action === data.default || (!data.default && entries.length === 1),
      callback: (event, button, dialog) => {
        dialog.answered = true;
        try {
          const result = b.callback?.($(dialog.element), event);
          if (result instanceof Promise) result.catch((err) => console.error("nssq | dialog button failed", err));
          dialog.lastResult = result;
        } catch (err) {
          console.error("nssq | dialog button failed", err);
        }
        return action;
      }
    }));
    if (!buttons.length) buttons.push({ action: "ok", label: game.i18n.localize("OK"), default: true });
    const config = {
      window: { title: data.title ?? "", resizable: !!options.resizable },
      content: stripForm(data.content),
      buttons,
      position: { width: options.width ?? data.width ?? 400 },
      rejectClose: false
    };
    if (options.height) config.position.height = options.height;
    if (options.left !== undefined) config.position.left = options.left;
    if (options.top !== undefined) config.position.top = options.top;
    if (options.id) config.id = options.id;
    if (options.classes) config.classes = options.classes;
    super(config);
    this.#v1 = data;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this.#renderedOnce) return;
    this.#renderedOnce = true;
    try {
      this.#v1.render?.($(this.element));
    } catch (err) {
      console.error("nssq | dialog render callback failed", err);
    }
  }

  _onClose(options) {
    super._onClose(options);
    try {
      this.closeResult = this.#v1.close?.($(this.element));
    } catch (err) {
      console.error("nssq | dialog close callback failed", err);
    }
  }

  /** V1 Dialog.wait */
  static wait(data = {}, options = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const buttons = Object.fromEntries(
        Object.entries(data.buttons ?? {}).map(([id, b]) => [
          id,
          {
            ...b,
            callback: (html, event) => {
              settled = true;
              let result;
              try {
                result = b.callback instanceof Function ? b.callback(html, event) : undefined;
              } catch (err) {
                reject(err);
                return;
              }
              Promise.resolve(result).then((r) => resolve(r === undefined ? id : r), reject);
            }
          }
        ])
      );
      const close = (html) => {
        let result;
        try {
          result = data.close instanceof Function ? data.close(html) : undefined;
        } catch (err) {
          console.error("nssq | dialog close callback failed", err);
        }
        if (settled) return;
        settled = true;
        if (result !== undefined) resolve(result);
        else reject(new Error("The Dialog was closed without a choice being made."));
      };
      new Dialog({ ...data, buttons, close }, options).render({ force: true });
    });
  }

  /** V1 Dialog.prompt */
  static prompt({ title, content, label, callback, render, rejectClose = true, options = {} } = {}) {
    return Dialog.wait(
      {
        title, content, render, default: "ok",
        close: () => (rejectClose ? undefined : null),
        buttons: { ok: { icon: '<i class="fas fa-check"></i>', label: label ?? game.i18n.localize("Confirm"), callback } }
      },
      options
    );
  }

  /** V1 Dialog.confirm */
  static confirm({ title, content, yes, no, render, defaultYes = true, rejectClose = false, options = {} } = {}) {
    return Dialog.wait(
      {
        title, content, render, default: defaultYes ? "yes" : "no",
        close: () => (rejectClose ? undefined : null),
        buttons: {
          yes: { icon: '<i class="fas fa-check"></i>', label: game.i18n.localize("Yes"), callback: (html) => (yes ? yes(html) : true) },
          no: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("No"), callback: (html) => (no ? no(html) : false) }
        }
      },
      options
    );
  }
}
