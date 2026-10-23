// 효과 종류별 「숫자 반영」 점검. 기대값은 01 §3.8~3.10 표에서
const S='nssq', wait=(ms)=>new Promise(r=>setTimeout(r,ms)), t0=Date.now();
if (game.combats.size) return {skip:'전투 중'};
window.__probe=[]; const rows=window.__probeRows=[]; const row=(cat,cas,exp,act)=>rows.push({cat,cas,exp:JSON.stringify(exp),act:JSON.stringify(act),ok:JSON.stringify(exp)===JSON.stringify(act)});
const aa0=game.settings.get(S,'autoApply'); clearInterval(window.__pclick); window.__pclick=setInterval(()=>{ for (const w of Object.values(ui.windows)) if (w instanceof Dialog && w.rendered && !w.__c) { w.__c=1; (window.__probeDlg??=[]).push(w.title+' | '+w.element.find('.dialog-content').text().replace(/\s+/g,' ').trim().slice(0,160)+' | '+[...w.element.find('.dialog-button')].map(b=>b.textContent.trim()).join('/')); (w.element.find('[data-button=roll]')[0]??w.element.find('.dialog-button.default')[0]??w.element.find('.dialog-button')[0])?.click(); } },300); const rnd0=CONFIG.Dice.randomUniform;
const P=await import('/systems/nssq/src/combat/profile.mjs');
const B=await import('/systems/nssq/src/apps/battle.mjs');
const A=await import('/systems/nssq/src/combat/attack.mjs');
const SU=await import('/systems/nssq/src/combat/skill-use.mjs');
const LIB=await import('/systems/nssq/src/apps/enemy-library.mjs');
let pc, en0, preset, combat; const out={};
try {
  await game.settings.set(S,'autoApply','off');
  const src=game.actors.getName('1렙임페'); const d=src.toObject(); delete d._id; d.name='[e2e]수치PC'; d.flags.nssq={...(d.flags.nssq??{}),benched:false}; d.system.npc=true; d.prototypeToken.name='[e2e]수치PC';
  pc=await Actor.create(d);
  const encDoc=(await game.packs.get('nssq.enemies').getDocuments()).find(e=>e.name==='오일 웜');
  const ed=game.actors.fromCompendium(encDoc); ed.name='[e2e]수치적'; ed.prototypeToken.name='[e2e]수치적'; en0=await Actor.create(ed);
  preset=await B.createPresetScene('[e2e]수치',{},{});
  const td=await en0.getTokenDocument({x:500,y:300,actorLink:false}); await preset.createEmbeddedDocuments('Token',[td.toObject()]);
  combat=await B.startBattle({presetId:preset.id,members:[pc.id]}); await wait(1500);
  for (const w of Object.values(ui.windows)) if (w instanceof Dialog) w.close();
  const cP=combat.combatants.find(c=>c.actor?.id===pc.id); const cE=combat.combatants.find(c=>c.actor?.type==='enemy'); const en=cE.actor;
  await en.update({'system.identified':true}); await wait(300);
  const prof=(a,c)=>P.combatProfile(a,c);
  const K=['physHit','elemHit','evasion','physAtk','elemAtk','defense','speed','suppAtk','suppDef','hpMax'];
  const diff=(a,b)=>{const o={}; for(const k of K) if(b[k]!==a[k]) o[k]=b[k]-a[k]; for(const [k,v] of Object.entries(b.resist??{})) if((a.resist?.[k]??0)!==v) o['resist.'+k]=v-(a.resist?.[k]??0); return o;};
  const withState=async(actor,c,upd,fn)=>{const before=prof(actor,c); const keep={buffs:actor.system.buffs, conditions:actor.system.conditions}; await actor.update(upd); await wait(250); const after=prof(actor,c); const r=fn(before,after); await actor.update({'system.buffs':keep.buffs??[],'system.conditions':keep.conditions??[]}); await wait(200); return r;};
  window.__probe.push('A');
  const EXP={atkUp:{physAtk:2,elemAtk:2},physAtkUp:{physAtk:2},elemAtkUp:{elemAtk:2},defenseUp:{defense:2},speedUp:{speed:2},hitUp:{physHit:2,elemHit:2},physHitUp:{physHit:2},evasionUp:{evasion:2},suppAtkUp:{suppAtk:2},suppDefUp:{suppDef:2},hpMaxUp:{hpMax:2},physDefUp:{defense:2},
    atkDown:{physAtk:-2,elemAtk:-2},physAtkDown:{physAtk:-2},elemAtkDown:{elemAtk:-2},defenseDown:{defense:-2},speedDown:{speed:-2},hitDown:{physHit:-2,elemHit:-2},physHitDown:{physHit:-2},evasionDown:{evasion:-2},suppAtkDown:{suppAtk:-2},suppDefDown:{suppDef:-2},physDefDown:{defense:-2}};
  for (const [id,exp] of Object.entries(EXP)) {
    row('강화·약화→PC',id,exp, await withState(pc,cP,{'system.buffs':[{id,value:2,turns:3,param:''}]},diff));
  }
  for (const id of ['physAtkUp','defenseDown','evasionUp','hitDown','speedUp']) row('강화·약화→에너미',id,EXP[id], await withState(en,cE,{'system.buffs':[{id,value:2,turns:3,param:''}]},diff));
  for (const [id,dv] of [['resistUp',1],['resistGrant',1],['resistDown',-1],['weaknessGrant',-1]]) {
    row('내성 강화·약화→PC',id+':fire',{'resist.fire':dv}, await withState(pc,cP,{'system.buffs':[{id,value:0,turns:3,param:'fire'}]},diff));
    row('내성 강화·약화→에너미(식별)',id+':fire',{'resist.fire':dv}, await withState(en,cE,{'system.buffs':[{id,value:0,turns:3,param:'fire'}]},diff));
  }
  row('속성 부여→PC','elemImbue:fire',true, await withState(pc,cP,{'system.buffs':[{id:'elemImbue',value:0,turns:3,param:'fire'}]},(a,b)=>!a.elements.includes('fire')&&b.elements.includes('fire')));
  row('크리티컬 업→PC','critUp',true, await withState(pc,cP,{'system.buffs':[{id:'critUp',value:0,turns:3,param:''}]},(a,b)=>!a.critUp&&b.critUp));
  window.__probe.push('B');
  const CEXP={blind:{physHit:-3,elemHit:-3,evasion:-3},bindHead:{physHit:-2,elemHit:-2},bindArm:{physAtk:-4}};
  for (const [id,exp] of Object.entries(CEXP)) row('상태 이상→PC',id,exp, await withState(pc,cP,{'system.conditions':[{id,depth:5,source:'',sourceSuppAtk:0}]},diff));
  for (const id of ['bindLeg','sleep','petrify','stun']) row('상태 이상→PC(회피 0)',id,0, await withState(pc,cP,{'system.conditions':[{id,depth:5,source:'',sourceSuppAtk:0}]},(a,b)=>b.evasion));
  row('상태 이상→PC','sleep(참·괴·돌 −1 취급)',[-1,-1,-1], await withState(pc,cP,{'system.conditions':[{id:'sleep',depth:5}]},(a,b)=>['slash','strike','pierce'].map(k=>b.resist[k])));
  row('상태 이상→에너미','blind',CEXP.blind, await withState(en,cE,{'system.conditions':[{id:'blind',depth:5}]},diff));
  window.__probe.push('C');
  for (const path of ['physHit','elemHit','physAtk','elemAtk','defense','speed','suppAtk','suppDef','hpMax','resist.fire']) {
    const before=prof(pc,cP); const [it]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]보정',type:'skill',system:{sl:1,timing:'상시',effects:[{type:'modifier',path,value:2}]}}]); await wait(300);
    const after=prof(pc,cP); await pc.deleteEmbeddedDocuments('Item',[it.id]); await wait(200);
    row('상시 보정→PC',path,{[path]:2},diff(before,after));
  }
  { const [it]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]보정',type:'skill',system:{sl:1,timing:'상시',effects:[{type:'modifier',path:'condResist.poison',value:2}]}}]); await wait(300);
    row('상시 보정→PC','condResist.poison',2, prof(pc,cP).condResist?.poison ?? null); await pc.deleteEmbeddedDocuments('Item',[it.id]); }
  { const before=SU.unitProfile(pc,cP).healDice; const [it]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]보정',type:'skill',system:{sl:1,timing:'상시',effects:[{type:'modifier',path:'healDice',value:2}]}}]); await wait(300);
    row('상시 보정→PC','healDice',2, SU.unitProfile(pc,cP).healDice-before); await pc.deleteEmbeddedDocuments('Item',[it.id]); }
  window.__probe.push('D');
  { const before=prof(pc,cP); await cP.setFlag(S,'stances',[{name:'[e2e]자세',sl:1,effects:[{type:'modifier',path:'physAtk',value:2}]}]); await wait(200); const after=prof(pc,cP); await cP.unsetFlag(S,'stances');
    row('대기 자세→PC','modifier physAtk',{physAtk:2},diff(before,after)); }
  window.__probe.push('E');
  CONFIG.Dice.randomUniform=()=>0.2; window.__d5=(await new Roll("3d6").evaluate()).dice[0].results.map(r=>r.result);
  const t0b=Date.now();
  const atk=async()=>{ const before=game.messages.size; await A.normalAttack(pc,{target:cE.token, ignoreRange:true}); await wait(700); const m=game.messages.contents.filter(m=>m.getFlag(S,'attack')).pop(); return m?.getFlag(S,'attack')?.targets?.[0]; };
  const expect=(a,e)=>{ const els=a.elements; const r=Math.min(...els.filter(x=>x!=='none').map(x=>e.resist?.[x]??0)); const cnt=Math.max(0,a.physAtk-e.defense); return {hitTotal:10+a.physHit, evasion:e.evasion, diceCount:cnt, resist:r, finalDamage: e.guarding? Math.floor((5>r?cnt:0)/2) : (5>r?cnt:0)}; };
  const pick=(t)=>t?{hitTotal:t.hitTotal,evasion:t.evasion,diceCount:t.diceCount,resist:t.resist,finalDamage:t.finalDamage}:null;
  const scen=async(name,setup,undo)=>{ await setup(); await wait(300); const a=prof(pc,cP), e={...prof(en,cE), guarding: !!cE.getFlag(S,'guarding')}; const t=await atk(); row('실제 공격',name,expect(a,e),pick(t)); await undo(); await wait(250); await en.update({'system.hp.value':en.system.hp.max}); };
  const nop=async()=>{};
  await scen('기본',nop,nop);
  await scen('PC 물리 공격 상승 2',()=>pc.update({'system.buffs':[{id:'physAtkUp',value:2,turns:3}]}),()=>pc.update({'system.buffs':[]}));
  await scen('적 방어 저하 2',()=>en.update({'system.buffs':[{id:'defenseDown',value:2,turns:3}]}),()=>en.update({'system.buffs':[]}));
  await scen('PC 명중 상승 2',()=>pc.update({'system.buffs':[{id:'hitUp',value:2,turns:3}]}),()=>pc.update({'system.buffs':[]}));
  await scen('적 회피 상승 2',()=>en.update({'system.buffs':[{id:'evasionUp',value:2,turns:3}]}),()=>en.update({'system.buffs':[]}));
  const el=prof(pc,cP).elements.find(x=>x!=='none');
  await scen(`적 내성 저하(${el})`,()=>en.update({'system.buffs':[{id:'resistDown',value:0,turns:3,param:el}]}),()=>en.update({'system.buffs':[]}));
  await scen('적 미식별(내성 최소 3)',()=>en.update({'system.identified':false}),()=>en.update({'system.identified':true}));
  await scen('적 미식별 + 내성 저하',()=>en.update({'system.identified':false,'system.buffs':[{id:'resistDown',value:0,turns:3,param:el}]}),()=>en.update({'system.identified':true,'system.buffs':[]}));
  await scen('적 방어 전념(절반)',()=>cE.setFlag(S,'guarding',true),()=>cE.unsetFlag(S,'guarding'));
  await scen('PC 속성 부여: 염',()=>pc.update({'system.buffs':[{id:'elemImbue',value:0,turns:3,param:'fire'}]}),()=>pc.update({'system.buffs':[]}));
  await scen('적 [맹목]',()=>en.update({'system.conditions':[{id:'blind',depth:5}]}),()=>en.update({'system.conditions':[]}));
  await scen('PC [팔] 봉인',()=>pc.update({'system.conditions':[{id:'bindArm',depth:5}]}),()=>pc.update({'system.conditions':[]}));
  await scen('PC 대기 자세 물리 공격 +2',()=>cP.setFlag(S,'stances',[{name:'[e2e]자세',sl:1,effects:[{type:'modifier',path:'physAtk',value:2}]}]),()=>cP.unsetFlag(S,'stances'));
  window.__probe.push('F');
  const sk=async(name,expFn)=>{ const it=pc.items.find(i=>i.name===name); if(!it){row('스킬 공격',name,'스킬 있음','없음');return;} await pc.update({'system.tp.value':pc.system.tp.max}); const a=prof(pc,cP), e=prof(en,cE); await SU.resolveAndPost({actor:pc,combatant:cP,item:it,kind:'skill',units:[{actor:en,combatant:cE}],mainAction:true}); await wait(800); const m=game.messages.contents.filter(m=>m.getFlag(S,'skillCard')).pop(); const h=m?.getFlag(S,'skillCard')?.entries?.[0]?.hits?.[0]; row('스킬 공격',name+` SL${it.system.sl}`,expFn(a,e,it.system.sl??1),h?{diceCount:h.diceCount, final:h.final}:null); await en.update({'system.hp.value':en.system.hp.max}); };
  await sk('샤프 에지',(a,e,sl)=>({diceCount:Math.max(0,a.physAtk-e.defense)+sl, final:Math.max(0,a.physAtk-e.defense)+sl}));
  await sk('어설트 드라이브',(a,e,sl)=>{const c=Math.max(0,(a.physAtk+(sl-1)*2)*2-e.defense); return {diceCount:c, final:c};});
  window.__probe.push('G');
  const tmp=async(effects,extra={})=>{ const [it]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]시험',type:'skill',system:{sl:1,timing:'주행동',target:'적 1체',category:extra.category??'',effects,cost:{tp:0}}}]); return it; };
  const runSk=async(it,targetActor=en,targetC=cE)=>{ await SU.resolveAndPost({actor:pc,combatant:cP,item:it,kind:'skill',units:[{actor:targetActor,combatant:targetC}],mainAction:true}); await wait(700); const m=game.messages.contents.filter(m=>m.getFlag(S,'skillCard')).pop(); await pc.deleteEmbeddedDocuments('Item',[it.id]); await en.update({'system.hp.value':en.system.hp.max}); return m?.getFlag(S,'skillCard')?.entries?.[0]; };
  const hitOf=(e)=>{const h=e?.hits?.[0]; return h?{total:h.total, diceCount:h.diceCount, resist:h.resist, final:h.final}:null;};
  const fin=(cnt,r,half=false)=>{const raw=5>r?cnt:0; return half?Math.floor(raw/2):raw;};
  { const a=prof(pc,cP), e=prof(en,cE); const r=e.resist.slash; const c=a.physAtk-e.defense;
    const cases=[
      ['diceMod +2',[{type:'attack',kind:'physical',diceMod:2}],{total:10+a.physHit,diceCount:c+2,resist:r,final:fin(c+2,r)}],
      ['hitMod +2',[{type:'attack',kind:'physical',hitMod:2}],{total:12+a.physHit,diceCount:c,resist:r,final:fin(c,r)}],
      ['atkMod +2',[{type:'attack',kind:'physical',atkMod:2}],{total:10+a.physHit,diceCount:c+2,resist:r,final:fin(c+2,r)}],
      ['atkMultiplier 2',[{type:'attack',kind:'physical',atkMultiplier:2}],{total:10+a.physHit,diceCount:a.physAtk*2-e.defense,resist:r,final:fin(a.physAtk*2-e.defense,r)}],
      ['halfDamage',[{type:'attack',kind:'physical',halfDamage:true}],{total:10+a.physHit,diceCount:c,resist:r,final:fin(c,r,true)}],
      ['element fire(물리)',[{type:'attack',kind:'physical',element:'fire'}],{total:10+a.physHit,diceCount:c,resist:e.resist.fire,final:fin(c,e.resist.fire)}],
      ['속성 공격 fire diceMod 3',[{type:'attack',kind:'elemental',element:'fire',diceMod:3}],{total:10+a.elemHit,diceCount:a.elemAtk+3,resist:e.resist.fire,final:fin(a.elemAtk+3,e.resist.fire)}],
      ['addElement fire',[{type:'attack',kind:'physical',addElement:['fire']}],{total:10+a.physHit,diceCount:c,resist:Math.min(r,e.resist.fire),final:fin(c,Math.min(r,e.resist.fire))}]
    ];
    for (const [n,eff,exp] of cases) row('스킬 공격 보정',n,exp,hitOf(await runSk(await tmp(eff))));
  }
  // 상시 공격 보정(attackBonus): 『참격』 분류 스킬일 때 대미지 다이스 +2 / 대상 내성 −1 / 내성 1·2 낮춤
  for (const [n,ab,expFn] of [
    ['attackBonus diceMod +2(분류 참격)',{type:'attackBonus',when:{category:'참격'},diceMod:2},(a,e)=>({diceCount:a.physAtk-e.defense+2})],
    ['attackBonus resistMod −1',{type:'attackBonus',when:{category:'참격'},resistMod:-1},(a,e)=>({resist:e.resist.slash-1})],
    ['attackBonus resistLow(염 2→1)',{type:'attackBonus',when:{category:'참격'},resistLow:true},(a,e)=>({resist:e.resist.fire-1})]]) {
    const [pas]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]상시',type:'skill',system:{sl:1,timing:'상시',effects:[ab]}}]); await wait(300);
    const a=prof(pc,cP), e=prof(en,cE); const it=await tmp([{type:'attack',kind:'physical',...(n.includes('resistLow')?{element:'fire'}:{})}],{category:'참격'});
    const h=hitOf(await runSk(it)); await pc.deleteEmbeddedDocuments('Item',[pas.id]); await wait(200);
    const exp=expFn(a,e); row('상시 공격 보정',n,exp,Object.fromEntries(Object.keys(exp).map(k=>[k,h?.[k]])));
  }
  // 회복 롤: 【속성 공격】 + 보정 개, 『회복』 분류면 healDice 더함. 눈 5 → 전부 4 이상
  { const [pas]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]상시',type:'skill',system:{sl:1,timing:'상시',effects:[{type:'modifier',path:'healDice',value:2}]}}]); await wait(300);
    await pc.update({'system.hp.value':1}); const a=prof(pc,cP);
    for (const [n,cat,exp] of [['회복 롤 bonus 3(『회복』)','회복',a.elemAtk+3+2],['회복 롤 bonus 3(다른 분류)','',a.elemAtk+3]]) {
      const [it]=await pc.createEmbeddedDocuments('Item',[{name:'[e2e]회복',type:'skill',system:{sl:1,timing:'주행동',target:'아군 1체',category:cat,effects:[{type:'heal',mode:'roll',bonus:3}],cost:{tp:0}}}]);
      await SU.resolveAndPost({actor:pc,combatant:cP,item:it,kind:'skill',units:[{actor:pc,combatant:cP}],mainAction:true}); await wait(700);
      const ent=game.messages.contents.filter(m=>m.getFlag(S,'skillCard')).pop()?.getFlag(S,'skillCard')?.entries?.[0]; await pc.deleteEmbeddedDocuments('Item',[it.id]);
      row('회복 롤',n,{dice:exp,hp:exp},{dice:ent?.resource?.find(x=>x.heal==='hp')?.dice?.length,hp:ent?.heal?.hp});
    }
    await pc.deleteEmbeddedDocuments('Item',[pas.id]); await pc.update({'system.hp.value':pc.system.hp.max});
  }
  window.__probe.push('H');
  // 상태 이상 부여(고정 목표값): 억제 방어 2D6(5+5) + 【억제 방어】 + 상태 이상별 보정 ≥ 목표값이면 막음
  for (const [cr,plus] of [[0,7],[3,7],[0,20],[3,13]]) {
    let pas=null; if (cr) { [pas]=await en.createEmbeddedDocuments('Item',[{name:'[e2e]상시',type:'skill',system:{sl:1,timing:'상시',effects:[{type:'modifier',path:'condResist.poison',value:cr}]}}]); await wait(300); }
    const a=prof(pc,cP), e=prof(en,cE); const tgt=a.suppAtk+plus; const resisted=10+e.suppDef+cr>=tgt;
    const it=await tmp([{type:'inflict',condition:'poison',check:{type:'fixed',target:'@self.suppAtk + '+plus}}]);
    const ent=await runSk(it); const i=ent?.inflicts?.[0];
    row('상태 이상 부여',`[독] 목표값 억제 공격+${plus}(억제 방어 보정 ${cr})`,{resisted, depth: resisted?null:tgt},{resisted:!!i?.resisted, depth: i?.resisted?null:(i?.depth??null)});
    if (pas) await en.deleteEmbeddedDocuments('Item',[pas.id]);
  }
  // 종료 페이즈: [독] 대미지 = 건 자의 【억제 공격】, HP 리젠 2
  { const a=prof(pc,cP); await en.update({'system.conditions':[{id:'poison',depth:99,source:pc.uuid,sourceSuppAtk:1}],'system.hp.value':en.system.hp.max}); await pc.update({'system.buffs':[{id:'hpRegen',value:2,turns:3}],'system.hp.value':1}); await wait(300);
    const n0=game.messages.size; await combat.setPhase('end'); await wait(1500);
    const m=game.messages.contents.filter(m=>m.getFlag(S,'endPhase')).pop(); const ups=m?.getFlag(S,'endPhase')?.updates??[];
    const ue=ups.find(u=>u.uuid===en.uuid), up=ups.find(u=>u.uuid===pc.uuid);
    row('종료 페이즈','[독] 대미지(건 자의 억제 공격)',a.suppAtk, ue?(ue.before.hp-ue.after.hp):null);
    row('종료 페이즈','HP 리젠 2',2, up?(up.after.hp-up.before.hp):null);
    await en.update({'system.conditions':[],'system.hp.value':en.system.hp.max}); await pc.update({'system.buffs':[],'system.hp.value':pc.system.hp.max});
  }
  out.base={pc:(({physHit,physAtk,elements})=>({physHit,physAtk,elements}))(prof(pc,cP)), en:(({evasion,defense,resist})=>({evasion,defense,resist}))(prof(en,cE))};
} catch(e) { out.err=String(e.stack??e).slice(0,500); } finally {
  CONFIG.Dice.randomUniform=rnd0; clearInterval(window.__pclick);
  for (const w of Object.values(ui.windows)) if (w instanceof Dialog) w.close();
  for (const c of game.combats.contents) if (c.getFlag(S,'battle')?.presetName?.startsWith('[e2e]')) await c.delete();
  for (const a of game.actors.filter(a=>a.name.startsWith('[e2e]수치'))) await a.delete();
  for (const s of game.scenes.filter(s=>s.name.includes('[e2e]수치'))) await s.delete();
  for (const m of game.messages.contents.filter(m=>m.timestamp>=t0)) await m.delete();
  await game.settings.set(S,'autoApply',aa0);
  await game.settings.set(S,'battleTurns',0);
}
out.dlg=window.__probeDlg; out.d5=window.__d5; out.fail=rows.filter(r=>!r.ok); out.okCount=rows.filter(r=>r.ok).length; out.total=rows.length; out.rows=rows.map(r=>`${r.ok?'O':'X'} ${r.cat} | ${r.cas} | ${r.exp} | ${r.act}`);
return out;
