/**
 * 지금 어둠인가(어둠 속 전투·탐색 중 시력 판정, 01 #165).
 * 필드 지도 진행 중이면 지금 에어리어의 밝기 설정(사용자 요청: light "dark" 항상 어둠 / "bright" 항상 밝음)이 먼저,
 * 정하지 않았으면(또는 랜덤 던전·지도 밖) 시간대가 밤일 때
 */
export function areaLight() {
  const s = game.settings.get("nssq", "fieldMapState") ?? {};
  if (!s.active) return null;
  const area = (game.settings.get("nssq", "fieldMaps") ?? {})[s.mapId]?.areas?.find((a) => a.id === s.current);
  return ["dark", "bright"].includes(area?.light) ? area.light : null;
}

export function isDarkNow() {
  const light = areaLight();
  if (light) return light === "dark";
  return game.settings.get("nssq", "timeOfDay") === "night";
}
