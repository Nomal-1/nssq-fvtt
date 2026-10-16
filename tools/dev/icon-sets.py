"""
Foundry 코어 아이콘 목록(서버에서 FilePicker로 뽑은 icons.txt)에서 분류별 후보를 골라 tools/lib/icon-sets.json을 만든다.
사용: python3 tools/dev/icon-sets.py <icons.txt>
경로는 서버에 실제로 있는 것만 들어간다(v12.331 코어 icons/).
"""
import json, re, sys
paths = [l.strip() for l in open(sys.argv[1]) if l.strip().endswith((".webp", ".svg"))]
P = {
  # 무기 종류
  "w.주먹": r"equipment/hand/gauntlet-", "w.단검": r"weapons/daggers/dagger-", "w.검": r"weapons/swords/(sword-broad|sword-guard|shortsword)",
  "w.세검": r"weapons/swords/(rapier|sword-thin|scimitar|sabre|sword-narrow)", "w.창": r"weapons/polearms/spear-", "w.도끼": r"weapons/axes/axe-",
  "w.지팡이": r"weapons/staves/staff-", "w.망치": r"weapons/hammers/hammer-", "w.채찍": r"(weapons/misc/whip|melee/strike-chain-whip)",
  "w.도": r"(sword-katana|weapons/swords/.*(katana|wakizashi))", "w.포검": r"weapons/swords/greatsword-", "w.농기구": r"(sickle|pitchfork|scythe|farming)",
  "w.활": r"weapons/bows/bow-", "w.쇠뇌": r"weapons/crossbows/crossbow-", "w.총": r"weapons/guns/",
  # 방어구
  "a.중갑": r"equipment/chest/breastplate-", "a.경갑": r"equipment/chest/(vest|shirt-collared|breastplate-leather|coat)", "a.옷": r"equipment/chest/(robe|shirt|tunic)",
  "a.방패": r"equipment/shield/",
  # 장신구
  "x.장갑": r"equipment/hand/glove", "x.머리": r"equipment/head/(hat|circlet|crown|headband|bandana)", "x.벨트": r"equipment/waist/belt",
  "x.신발": r"equipment/feet/(boots|shoe)", "x.부적": r"equipment/neck/(amulet|pendant)", "x.책": r"sundries/books/book-", "x.고글": r"equipment/head/(goggles|glasses)",
  "x.오브": r"(orb|crystal-ball|sphere)", "x.반지": r"equipment/finger/ring-", "x.귀걸이": r"equipment/neck/(earring|.*ear)|equipment/head/earring", "x.팔찌": r"equipment/wrist/(bracer|bracelet)",
  "x.목걸이": r"equipment/neck/necklace",
  # 소모품·도구
  "i.빨간약": r"consumables/potions/.*red", "i.파란약": r"consumables/potions/.*blue", "i.금약": r"consumables/potions/.*(gold|yellow)", "i.초록약": r"consumables/potions/.*green",
  "i.주황약": r"consumables/potions/.*orange", "i.보라약": r"consumables/potions/.*purple", "i.병": r"consumables/potions/(bottle|vial|flask)",
  "i.고기": r"consumables/meat/", "i.생선": r"consumables/(meat|food)/.*fish", "i.알": r"(consumables/food/.*egg|eggs)", "i.곡류": r"(grain|wheat|bread)",
  "i.채소": r"consumables/(food|vegetable).*(carrot|cabbage|onion|vegetable|leek|potato)", "i.과일": r"consumables/(fruit|food)/.*(apple|pear|fruit|grape|berries)",
  "i.가방": r"containers/bags/(pack|backpack)", "i.텐트": r"(tent|camp)", "i.냄비": r"(pot-cooking|cooking|cauldron|tools/cooking)", "i.로프": r"rope", "i.물통": r"(waterskin|canteen|flask-leather)",
  "i.자루": r"containers/bags/(sack|bag)", "i.천": r"commodities/cloth/", "i.칼": r"(knife|tools/hand/knife)", "i.공구망치": r"tools/hand/hammer", "i.못": r"(nail|spike|wedge)",
  "i.거울": r"mirror", "i.횃불": r"(torch)", "i.부싯돌": r"(tinder|flint)", "i.랜턴": r"lantern", "i.실": r"(thread|yarn|spool)",
  # 소재
  "m.이빨": r"commodities/bones/.*(tooth|fang)", "m.가죽": r"commodities/leather/", "m.모피": r"commodities/(leather|fur)/.*fur", "m.뿔": r"commodities/(bones|biological)/.*horn",
  "m.발톱": r"commodities/(bones|biological)/.*claw", "m.뼈": r"commodities/bones/bone", "m.깃털": r"commodities/materials/feather|feather", "m.껍질": r"(husk|bark|commodities/biological/.*skin)",
  "m.가시": r"(thorn|spike|quill)", "m.칼날": r"(commodities/metal/.*blade|weapons/.*blade-broken|shard)", "m.실": r"(thread|silk|spool|yarn)", "m.비늘": r"scale",
  "m.등딱지": r"(shell|carapace)", "m.결정": r"(crystal)", "m.목재": r"commodities/wood/", "m.덩굴": r"(vine|ivy|root)", "m.가지": r"(branch|twig|stick)",
  "m.석재": r"commodities/stone/", "m.금속": r"commodities/metal/(ingot|bar)", "m.보석": r"commodities/gems/gem-", "m.풀": r"(herb|leaf|plant|grass)", "m.꽃": r"(flower|blossom|rose)",
  "m.열매": r"(berries|berry|fruit)",
  # 스킬
  "s.melee": r"skills/melee/", "s.ranged": r"skills/ranged/", "s.fire": r"magic/fire/", "s.ice": r"magic/water/.*(ice|frost|snow|crystal|freeze)|magic/water/",
  "s.volt": r"magic/lightning/", "s.heal": r"magic/life/", "s.curse": r"magic/(unholy|death)/", "s.song": r"(instruments|music)", "s.dance": r"skills/movement/",
  "s.command": r"(skills/social/|flags)", "s.defense": r"(equipment/shield/|skills/melee/shield|magic/defensive)", "s.ninja": r"(magic/air/.*smoke|shuriken|ninja|skills/ranged/.*throw)",
  "s.summon": r"creatures/(mammals|abilities)/", "s.formation": r"(flags|skills/social/)", "s.passive": r"(magic/control/|magic/perception/|magic/defensive/|magic/symbols/|skills/wounds/|magic/time/)", "s.toxin": r"skills/toxins/",
  "s.buff": r"magic/(holy|light)/", "s.gather": r"skills/trades/", "s.rune": r"magic/symbols/",
}
out = {}
for k, pat in P.items():
    rx = re.compile(pat, re.I)
    hits = [p for p in paths if rx.search(p)]
    out[k] = hits[:: max(1, len(hits) // 40)][:40]  # 폴더가 고루 섞이게 간격을 두고 고른다
    if not hits: print("EMPTY", k)
json.dump(out, open("tools/lib/icon-sets.json", "w"), ensure_ascii=False, indent=0)
print({k: len(v) for k, v in out.items()})
