/** system.nssq 소켓: { action, payload } 를 등록된 핸들러로 보낸다 */
const CHANNEL = "system.nssq";
const handlers = new Map();

export function onSocket(action, fn) {
  handlers.set(action, fn);
}

/** 다른 클라이언트에 보낸다. local=true면 자기 자신도 처리(소켓은 보낸 쪽에 돌아오지 않는다) */
export function emit(action, payload, { local = false } = {}) {
  game.socket.emit(CHANNEL, { action, payload });
  if (local) handlers.get(action)?.(payload);
}

export function registerSocket() {
  game.socket.on(CHANNEL, (data) => handlers.get(data?.action)?.(data.payload));
}
