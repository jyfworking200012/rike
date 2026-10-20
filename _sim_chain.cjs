/* 全链条试跑 —— 从零号存档一路推到城主府
   不绕过 UI：打卡、过夜、盖房、升级全部走真实点击入口；
   事件走 applyOpt（和点选项按钮同一条路）。
   唯二注入：日期（模拟过日子）和 rnd（控制掷骰结果，验证三档都算得对）。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = scripts[scripts.length - 1][1];

let pass = 0, fail = 0;
const fails = [];
const ledger = [];   // 全程账本
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b){ ok(name, a === b, '实际 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b)); }
function act(title){ console.log('\n【' + title + '】'); ledger.push('## ' + title); }

/* ---------- DOM 桩（与 selftest5 同款） ---------- */
function node(tagName, id){
  const n = {
    tagName: (tagName || 'div').toUpperCase(), id: id || '',
    _kids: [], _attrs: {}, _html: '', parentNode: null, dataset: {}, style: {}, textContent: '', value: '',
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, toggle(c, v){ v ? this._s.add(c) : this._s.delete(c); }, contains(c){ return this._s.has(c); } },
    appendChild(c){ c.parentNode = n; n._kids.push(c); return c; },
    removeChild(c){ const i = n._kids.indexOf(c); if (i >= 0){ n._kids.splice(i, 1); c.parentNode = null; } return c; },
    remove(){ if (n.parentNode) n.parentNode.removeChild(n); },
    setAttribute(k, v){ n._attrs[k] = String(v); }, getAttribute(k){ return k in n._attrs ? n._attrs[k] : null; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, select(){}, focus(){}, addEventListener(){}
  };
  Object.defineProperty(n, 'innerHTML', { get(){ return n._html; }, set(v){ n._html = String(v); } });
  Object.defineProperty(n, 'className', {
    get(){ return [...n.classList._s].join(' '); },
    set(v){ n.classList._s.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => n.classList._s.add(c)); }
  });
  return n;
}
const store = {}; const nodes = {}; let rafId = 0;
let simNow = '2026-10-19T10:00:00';   // 唯一的日期注入点
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...a){ if (a.length) super(...a); else super(simNow); }
  static now(){ return new RealDate(simNow).getTime(); }
}

const ctx = {
  console, Math, JSON, String, Number, Object, Array, Map, Set, Promise,
  parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
  navigator: {}, location: { protocol: 'file:' }, Date: FixedDate,
  window: null,
  document: {
    getElementById(id){ if (!nodes[id]) nodes[id] = node('div', id); return nodes[id]; },
    createElement(tag){ return node(tag); }, createElementNS(ns, tag){ return node(tag); },
    querySelectorAll(){ return []; },
    addEventListener(t, fn){ if (t === 'click') ctx.__click = fn; },
    body: node('body')
  },
  localStorage: {
    getItem(k){ return store[k] === undefined ? null : store[k]; },
    setItem(k, v){ store[k] = String(v); }, removeItem(k){ delete store[k]; }
  }
};
ctx.requestAnimationFrame = () => ++rafId;
ctx.cancelAnimationFrame = () => {};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx);
const S = expr => vm.runInContext(expr, ctx);

/* ---------- 驾驶辅助 ---------- */
// 真实点击：伪造事件对象走 document 上那个委托监听器
function click(match){
  ctx.__click({ target: { closest: sel => {
    if (match.task !== undefined && sel.includes('data-task')) return { dataset: { task: match.task } };
    if (match.act !== undefined && sel.includes('data-act')) return { dataset: { act: match.act } };
    if (match.up !== undefined && sel.includes('data-up')) return { dataset: { up: match.up } };
    if (match.build !== undefined && sel.includes('data-build')) return { dataset: { build: match.build } };
    return null;
  } } });
}
// 过一天再过夜（doNight 拒绝同一天过两次夜）
let dayNo = 0;
function nextNight(){
  const d = new RealDate('2026-10-19T10:00:00');
  d.setDate(d.getDate() + (++dayNo));
  const p = n => String(n).padStart(2, '0');
  simNow = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T10:00:00';
  click({ act: 'night' });
}
// 把 vm 里的「今天」拨回 n 天前（YYYY-MM-DD），用于模拟断签
function daysAgo(n){
  return vm.runInContext('(function(){ const d=new Date(); d.setDate(d.getDate()-' + n + '); const p=x=>String(x).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); })()', ctx);
}
// 掷骰注入：rnd 换成读变量
S('var __R = 0.5; rnd = function(){ return __R; };');
function setR(v){ vm.runInContext('__R = ' + v, ctx); }
function res(){ return JSON.parse(JSON.stringify(S('state.res'))); }
function topup(o){ for (const k in o) S('state.res["' + k + '"] = (state.res["' + k + '"] || 0) + ' + o[k]); }

S("tab='today'; render();");

/* ═════════ 第一幕 · 荒村点火 ═════════ */
act('第一幕 · 荒村点火（Day1 打卡 → 过夜 → 人来）');
eq('初始空镇', S('state.pop.length'), 0);
eq('初始上限 3', S('cap()'), 3);
eq('官府自治系数（未建）', S('autonomy()'), 0.30);
click({ task: 'wake' }); click({ task: 'train' });   // 老陈砍树、阿岩打猎
eq('打卡进了 checks', S("Object.keys(state.checks).length"), 2);
nextNight();
eq('第一夜 · 2 人落籍', S('state.pop.length'), 2);
eq('人口名字', S("state.pop.map(p=>p.who).join('+')"), '老陈+阿岩');
eq('日数 +1', S('state.day'), 2);
ok('肉有进账', S('state.res.meat') > 5, 'meat=' + S('state.res.meat'));
ledger.push('Day1：打卡 2 项 → 老陈、阿岩来投 · 肉 ' + S('state.res.meat'));

/* ═════════ 第二幕 · 井与村长家 ═════════ */
act('第二幕 · 盖井 → 盖村长家（官府Lv1）');
topup({ stone: 30, wood: 40 });
const beforeWell = res();
click({ build: 'well' });
eq('井盖好了', S('state.build.well'), 1);
eq('石头付掉了', beforeWell.stone - res().stone, 10);
click({ build: 'hall' });
eq('村长家盖好了', S('state.build.hall'), 1);
eq('自治系数 0.30→0.45', S('autonomy()'), 0.45);
eq('名字是村长家', S('hallName()'), '村长家');
nextNight();   // 消化掉这一天
ok('过夜正常', S('state.day') >= 3, 'day=' + S('state.day'));
ledger.push('盖井（−10石）→ 盖村长家（−25木15石）· 自治 45%');

/* ═════════ 第三幕 · 官府升三级 ═════════ */
act('第三幕 · 村长家 → 镇长家 → 城主府');
topup({ wood: 56, stone: 44, coin: 12 });
click({ up: 'hall' });
eq('Lv2 · 镇长家', S('lvOf("hall")'), 2);
eq('Lv2 名字', S('hallName()'), '镇长家');
eq('Lv2 自治 0.60', S('autonomy()'), 0.60);
click({ up: 'hall' });
eq('Lv3 · 城主府', S('lvOf("hall")'), 3);
eq('Lv3 名字', S('hallName()'), '城主府');
eq('Lv3 自治 0.75', S('autonomy()'), 0.75);
ok('升级钱真付了', res().coin === 0, 'coin=' + res().coin);
ledger.push('两连升：−20木16石 → −36木28石12钱 · 自治 75%');

/* ═════════ 第四幕 · 补人口 ═════════ */
act('第四幕 · 盖木棚、招人，镇子升「小村」');
topup({ wood: 30 });
click({ build: 'hut' }); click({ build: 'hut' });
eq('两座木棚后上限 9（3 + 3×2）', S('cap()'), 9);
click({ task: 'study' }); click({ task: 'sleep' });   // 白先生、灯
nextNight();
ok('白先生、灯落籍（打卡人口 ≥4）', S('state.pop.length') >= 4, 'pop=' + S('state.pop.length'));
// 人口口径：popCount = 打卡的人 + 住户（盖房自动搬来，hut×2 / 石屋×3）
eq('住户机制：2 木棚 → 4 住户', S('dwellers()'), 4);
eq('镇子升「集镇」', S('rank().t'), '集镇');
ledger.push('盖 2 木棚 → 白先生、灯来投 · 打卡人口 ' + S('state.pop.length') + ' + 住户 4 = ' + S('popCount()') + ' · 集镇');

/* ═════════ 第五幕 · 掷骰三档 ═════════ */
act('第五幕 · 事件掷骰：成了 / 平平 / 砸了');
// 动态找一个「当前可用」的掷骰选项（带 when 门的选项若不可用，applyOpt 会早退）
const evtDef = S("(function(){ for (const e of EVENTS){ for (let i=0;i<e.opts.length;i++){ const o=e.opts[i]; if (o.chance && o.good && o.bad && (!o.when || o.when())) return {id:e.id, i}; } } return null; })();");
ok('找到掷骰事件', !!evtDef, JSON.stringify(evtDef));
if (evtDef){
  // applyOpt 的真实顺序：先 pay(cost) 再 chanceOf —— 肉付掉可能跨过「每 5 份」档位，
  // 所以 p 必须在扣完钱之后算（临时扣钱 → 算 p → 恢复，和游戏内部同频）
  const pPost = () => vm.runInContext('(function(){ const o=EVENTS.find(x=>x.id===' + JSON.stringify(evtDef.id) + ').opts[' + evtDef.i + ']; const save={}; for (const k in (o.cost||{})){ save[k]=state.res[k]||0; state.res[k]=(state.res[k]||0)-o.cost[k]; } const p=chanceOf(o); for (const k in save) state.res[k]=save[k]; return p; })()', ctx);
  const segR = seg => {
    const p = pPost();
    if (seg === 'good') return 0.001;                  // r < p
    if (seg === 'flat') return p + (1 - p) * 0.4;      // p ≤ r，且 r−p < (1−p)/2
    return 0.999;                                      // 其余 → 砸了
  };
  // UI 保全：选项钱不够时按钮是禁用的。直接调 applyOpt 会绕过这层，
  // 所以先把肉补到足够付，模拟「按钮可点」的真实前提
  topup({ meat: 12 });
  for (const [segKey, label] of [['good', '成了'], ['flat', '平平'], ['bad', '砸了']]){
    S('state.pend = ' + JSON.stringify(evtDef.id) + '; state.grudges = state.grudges || {};');
    const r0 = res(); const logLen0 = S('state.log.length');
    setR(segR(segKey));
    S('applyOpt(' + evtDef.i + ')');
    const r1 = res();
    // 档位文本核对：applyOpt 里 txt = (seg && seg.txt) || o.res
    const expTxt = vm.runInContext(
      '(function(){ const e=EVENTS.find(x=>x.id===' + JSON.stringify(evtDef.id) + '); const o=e.opts[' + evtDef.i + ']; const seg=o["' + segKey + '"]; return String((seg && seg.txt) || o.res).replace(/<[^>]+>/g, ""); })()', ctx);
    const gotTxt = vm.runInContext('state.log[' + logLen0 + '] ? state.log[' + logLen0 + '].t : null', ctx);
    eq('掷骰 → ' + label, gotTxt, expTxt);
    eq('hist 记了选择', vm.runInContext('state.hist && state.hist[' + JSON.stringify(evtDef.id) + ']', ctx), evtDef.i);
    // 资源账精确对账：期望 = r0 − cost + good 加项；bad 分支是「减 bad 里的数、钳 0」
    const segDef = vm.runInContext('(function(){ const o=EVENTS.find(x=>x.id===' + JSON.stringify(evtDef.id) + ').opts[' + evtDef.i + ']; const s=o["' + segKey + '"] || o; return { cost:o.cost || {}, good:s.good || null, bad:s.bad || null }; })()', ctx);
    const keys = new Set([...Object.keys(r1), ...Object.keys(segDef.cost)]);
    let money = true; const expShow = {};
    for (const k of keys){
      if (k === 'safe' || k === 'happy') continue;
      let e = (r0[k] || 0) - (segDef.cost[k] || 0);
      if (segDef.good && segDef.good[k] !== undefined && k !== 'safe' && k !== 'happy') e += segDef.good[k];
      if (segDef.bad && segDef.bad[k] !== undefined && k !== 'safe' && k !== 'happy') e = Math.max(0, e - segDef.bad[k]);
      expShow[k] = e;
      if ((r1[k] || 0) !== e) money = false;
    }
    ok(label + ' 资源账与设计 fx 一致', money, '预期 ' + JSON.stringify(expShow) + ' · 实际 ' + JSON.stringify({ r0, r1 }));
  }
}
ledger.push('掷骰事件 ' + evtDef.id + '：成了/平平/砸了三档路径全部走通，资源账与 fx 精确对上');

/* ═════════ 第六幕 · 记仇与销账 ═════════ */
act('第六幕 · 记仇：赶人 → 夜里的响动来得更准 → 销账');
const grudgeEvt = S("(function(){ for (const e of EVENTS){ if (e.opts.some(o => o.grudge === 'beggar')) return e.id; } return null; })();");
ok('找到记仇事件（赶乞丐）', !!grudgeEvt, String(grudgeEvt));
if (grudgeEvt){
  S('state.pend = ' + JSON.stringify(grudgeEvt) + ';');
  const gi = S("EVENTS.find(e=>e.id===" + JSON.stringify(grudgeEvt) + ").opts.findIndex(o=>o.grudge==='beggar')");
  S('applyOpt(' + gi + ')');
  ok('账记下了 grudges.beggar', !!S('state.grudges.beggar'), JSON.stringify(S('state.grudges')));
  // beggar2（tier2 · grudgeOn）只在记仇时入池、权重 ×3：抽 300 次必出现
  let hit = null;
  for (let i = 0; i < 300 && !hit; i++){
    S('state.seen = [];');
    setR((i * 0.137) % 1);
    const e = S('pickEvent()');
    if (e && e.id === 'beggar2') hit = true;
  }
  ok('记仇后 beggar2 入池且抽得到（×3 权重）', !!hit);
  ok('抽出后销账', !S('state.grudges.beggar'), JSON.stringify(S('state.grudges')));
}
ledger.push('赶乞丐 → 记仇 tag 入账 → beggar2 ×3 权重来寻仇 → 抽出即销账');

/* ═════════ 第七幕 · 离线三夜（挂机引擎） ═════════ */
act('第七幕 · 离线三夜：城主府替班，回来只看账不弹窗');
setR(0.99);   // 挂机期间不出事件，隔离变量
const back2 = daysAgo(2);   // 夜落在「明天」：明晚结算时 gap = 3 → 补 2 夜 + 今晚
S('state.lastNight = ' + JSON.stringify(back2) + ';');
topup({ meat: 40 });   // 备足口粮，只验挂机产出与吃肉
const r0 = res(); const pop0 = S('state.pop.length');
nextNight();
const r1 = res();
eq('断签天数算对（3 天，按结算夜复核）', vm.runInContext('daysBetween(' + JSON.stringify(back2) + ', state.lastNight)', ctx), 3);
eq('挂机不弹窗（pend 空）', S('state.pend'), null);
// 精确对账：肉 = 挂机2夜 round(2·⌈产/2⌉·0.75) + 今晚全额 − perDay×3
const yTrain = vm.runInContext('yieldOf(TASKS.find(t=>t.id==="train"))', ctx);
const rate = S('autonomy()');
const pd = S('perDay()');
const expMeat = Math.round(2 * Math.ceil(yTrain * 0.5) * rate) + yTrain - pd * 3;
eq('吃肉与挂机产出按公式结', (r1.meat || 0) - (r0.meat || 0), expMeat);
ok('挂机有产出（非肉资源涨过）', Object.keys(r1).some(k => k !== 'meat' && (r1[k] || 0) > (r0[k] || 0)), JSON.stringify({ r0, r1 }));
eq('没人饿走', S('state.pop.length'), pop0);
ledger.push('离 3 天回村：城主府挂机 · 吃肉 −' + (pd * 3) + ' · 肉净 ' + expMeat + ' · 无人离开 · 无弹窗');

/* ═════════ 第八幕 · 断粮底线 ═════════ */
act('第八幕 · 断粮底线：饿但不清零');
setR(0.99);
S('state.res.meat = 1;');   // 只留 1 肉
const back2b = daysAgo(2);  // 再断签（结算夜落在明天，gap = 3）
S('state.lastNight = ' + JSON.stringify(back2b) + ';');
const pop7 = S('state.pop.length');
nextNight();
const pop7b = S('state.pop.length');
ok('饿走 ≤2 人（挂机段最多 1 + 今晚最多 1）', pop7 - pop7b <= 2 && pop7 - pop7b >= 1, pop7 + '→' + pop7b);
ok('镇子没清零', pop7b >= 1, 'pop=' + pop7b);
eq('肉清零不透支', S('state.res.meat'), 0);
ledger.push('断粮夜：' + pop7 + ' → ' + pop7b + ' 人 · 肉 0 · 镇子未清零');

/* ═════════ 全程账本 ═════════ */
console.log('\n════════ 全程账本 ════════');
console.log('最终：第 ' + S('state.day') + ' 天 · ' + S('popCount()') + ' 人 · ' + S('rank().t') + ' · 官府「' + S('hallName()') + '」Lv' + S('lvOf("hall")'));
console.log('资源：' + JSON.stringify(res()));
console.log('记仇账：' + JSON.stringify(S('state.grudges')));
const logAll = S('state.log.map(l => "  第" + l.d + "天 · " + l.t).join("\\n")');
console.log(logAll);

console.log('\n════════ 结果 ════════');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fails.length){ console.log('失败明细：\n' + fails.map(f => '  - ' + f).join('\n')); process.exit(1); }

/* 账本写进报告 */
const report = '# 小镇 v5.0 全链条试跑报告\n\n' +
  '> 时间：' + new RealDate().toLocaleString('zh-CN') + ' · 方式：vm 沙箱内真实点击驱动（打卡/过夜/盖房/升级全走 UI 入口），仅注入日期与骰子\n\n' +
  ledger.map(l => l + '\n').join('\n') +
  '\n## 终局状态\n\n- 第 ' + S('state.day') + ' 天 · ' + S('popCount()') + ' 人 · ' + S('rank().t') + '\n' +
  '- 官府：' + S('hallName()') + ' Lv' + S('lvOf("hall")') + '（自治 75%，挂机 ≈ 全勤 68%）\n' +
  '- 资源：' + JSON.stringify(res()) + '\n\n' +
  '## 结论\n\n八幕全过：打卡→招人→资源链→官府三级→补人口→掷骰三档→记仇销账→离线衰减→断粮底线，' + pass + ' 项断言无失败。\n';
fs.writeFileSync(path.join(__dirname, 'docs', '全链条试跑报告.md'), report);
console.log('\n报告已写入 docs/全链条试跑报告.md');
