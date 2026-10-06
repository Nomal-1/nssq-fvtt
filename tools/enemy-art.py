"""
에너미 일러스트: 세계수 HD 스프라이트(로컬 폴더)에서 에너미 이름에 맞는 그림을 골라
assets/enemies/<id>.webp (긴 변 400px)로 줄이고, 이름 → 경로 표를 src/generated/enemy-art.mjs 로 쓴다.
원본 폴더는 저장소 밖(로컬)에 있으므로 이 스크립트는 그림을 바꿀 때만 손으로 돌린다.

  python tools/enemy-art.py "<섹3한글화 폴더>"

고르는 순서: ① 같은 이름(EO1 → EO2 → EO3) ② 아래 LOOKALIKE(같은 이름이 없는 에너미에 비슷한 그림)
"""
import glob, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\jsj07\OneDrive\바탕 화면\섹3한글화"
OUT = os.path.join(ROOT, "assets", "enemies")
MAX = 400

# 같은 이름이 없는 에너미 → 비슷한 그림의 이름
LOOKALIKE = {
    "발칸어": "레드 피시",
    "사에나 버드": "샤인 버드",
    "배회하는 도약수": "참수하는 토끼",
    "맞서는 패왕수": "로드 사와로",
    "모든 것을 사냥하는 그림자": "모두 베는 그림자",
    "눈토끼": "EO3:79",
    "일렉 반딧불이": "빅 모스",
    "니치린소": "사악한 꽃잎",
    "오일 웜": "머드 웜",
    "재커로프": "버니 수어사이드",
    "난폭한 비비": "칼날발톱원숭이",
    "춤추는 무지개도마뱀": "목도리도마뱀",
    "무는 풀": "식인초",
    "거대아나콘다": "그린아나콘다",
    "산고래": "큰멧돼지",
    "마하 다람쥐": "호랑꼬리여우원숭이",
    "와일드 윙": "와이번",
    "워보어": "포레스트 오거",
    "워처": "이블 아이",
    "가드봇": "아이언 아머",
    "기라파 비틀": "비틀 로드",
    "타이탄 아룸": "거대한 요화",
    "드레드 히드라": "스킬라",
    "폭탄 칡": "물어뜯초",
}


def candidates():
    cand = {}

    def add(name, path):
        cand.setdefault(name.strip(), path)

    d = os.path.join(SRC, "EOHD_스프라이트", "몬스터")
    for f in sorted(os.listdir(d)):
        m = re.match(r"(.+?) \((en_\w+)\)\.png$", f)
        if m:
            for n in m.group(1).replace(" (추정)", "").split(", "):
                add(n, os.path.join(d, f))
    d = os.path.join(SRC, "EO2HD_스프라이트", "monster")
    for f in sorted(os.listdir(d)):
        m = re.match(r"e[bn]\d+_(.+?)(\(.+\))?\.png$", f)
        if m:
            add(m.group(1), os.path.join(d, f))
    # EO3: 파일 번호 = enemyname_N
    d = os.path.join(SRC, "EO3HD_이미지", "몬스터")
    for line in open(os.path.join(SRC, "EO3HD_한글텍스트", "text_label_after_full.tsv"), encoding="utf-8-sig"):
        c = line.rstrip("\n").split("\t")
        m = re.match(r"enemyname_(\d+)$", c[0])
        if m:
            p = os.path.join(d, "en%03d.png" % int(m.group(1)))
            if os.path.exists(p):
                add(c[-1], p)
                add("EO3:%d" % int(m.group(1)), p)
    return cand


def main():
    cand = candidates()
    enemies = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "enemies", "*.json"))):
        enemies += json.load(open(f, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "*.webp")):
        os.remove(f)
    art, missing = {}, []
    for e in enemies:
        src = cand.get(e["name"]) or cand.get(LOOKALIKE.get(e["name"], ""))
        if not src:
            missing.append(e["name"])
            continue
        im = Image.open(src).convert("RGBA")
        bbox = im.getbbox()  # 투명 여백을 잘라 토큰에 크게 보이게
        if bbox:
            im = im.crop(bbox)
        im.thumbnail((MAX, MAX), Image.LANCZOS)
        name = "%s.webp" % e["id"]
        im.save(os.path.join(OUT, name), "WEBP", quality=85, method=6)
        art[e["name"]] = "systems/nssq/assets/enemies/%s" % name
    with open(os.path.join(ROOT, "src", "generated", "enemy-art.mjs"), "w", encoding="utf-8", newline="\n") as f:
        f.write("// tools/enemy-art.py 가 만든다. 에너미 이름 → 일러스트 경로\n")
        f.write("export default " + json.dumps(art, ensure_ascii=False, indent=2) + ";\n")
    size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, "*.webp")))
    print("%d/%d 에너미, %.1f MB" % (len(art), len(enemies), size / 1e6))
    if missing:
        print("그림 없음:", ", ".join(missing))


if __name__ == "__main__":
    main()
