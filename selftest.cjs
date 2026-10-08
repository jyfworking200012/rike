/* 《日课》逻辑自检 —— 从 index.html 抽离脚本，注入最小 DOM 桩后跑真实逻辑 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

/* 把控制台输出同时落盘（PowerShell 重定向会写坏编码） */
const _logs = [];
const _origLog = console.log;
console.log = (...a) => { _logs.push(a.map(x => typeof x === 'string' ? x : String(x)).join(' ')); _origLog(...a); };
process.on('exit', () => {
  try { fs.writeFileSync(path.join(__dirname, '_test_out.txt'), _logs.join('\r\n'), 'utf8'); } catch(e){}
});

let pass = 0, fail = 0;
const errs = [];
function ok(name, cond, extra){
  if (cond){ pass++; }
  else { fail++; errs.push(name + (extra ? '  →  ' + extra : '')); }
}

/* ---------- 1. 抽取脚本 ---------- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error('FATAL: 找不到 <script> 块'); process.exit(1); }
let code = m[1];

const scriptCount = (html.match(/<script>/g) || []).length;
ok('只有一个内联 script 块', scriptCount === 1, '实际 ' + scriptCount);

/* ---------- 2. 语法检查 ---------- */
try { new Function(code); ok('脚本语法通过', true); }
catch(e){ ok('脚本语法通过', false, e.message); console.error(e.stack); process.exit(1); }

/* ---------- 3. 截掉 boot() 并构建 DOM 桩 ---------- */
if (!/\nboot\(\);\s*$/.test(code)) { ok('检出末尾 boot() 调用', false); }
code = code.replace(/\nboot\(\);\s*$/, '\n');

function mkEl(){
  const el = {
    innerHTML:'', textContent:'', value:'', id:'', className:'',
    dataset:{}, style:{}, children:[],
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
                toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c) } else { f?this._s.add(c):this._s.delete(c) } },
                contains(c){ return this._s.has(c) } },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){},
    remove(){}, select(){}, setSelectionRange(){}, focus(){}, blur(){},
    closest(){ return null }, querySelector(){ return mkEl() }, querySelectorAll(){ return [] },
    getAttribute(){ return null }, setAttribute(){}, insertAdjacentHTML(){}
  };
  return el;
}
const store = {};
const els = {};   // 按选择器缓存元素，便于回读 innerHTML 做渲染断言
global.document = {
  querySelector: sel => { if (!els[sel]) els[sel] = mkEl(); return els[sel]; },
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => mkEl(),
  body: { style:{} },
  hidden: false
};
global.localStorage = {
  _d: store,
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null },
  setItem(k, v){ this._d[k] = String(v) },
  removeItem(k){ delete this._d[k] }
};
global.location = { protocol:'file:', reload(){} };
global.navigator = {};
global.confirm = () => true;
global.prompt = () => '';
global.window = { addEventListener(){} };
global.setTimeout = (fn) => 0;
global.clearTimeout = () => {};

/* ---------- 4. 加载并导出内部 API ---------- */
const EXPORTS = `;return {
  get state(){return state}, set state(v){state=v},
  get run(){return run}, set run(v){run=v},
  newState, blankDay, todayStr, shiftD, dayDiff, parseD,
  mul, applyMul, addEnergy, traitSum, allEff, grantTrait, hasTrait,
  settle, doTask, handleBreak,
  buildSeq, drawEvent, unlockedEv, judgeOpt, judgeBonus,
  startRun, chooseOption, nextStep, endRun, closeRun,
  render, renderRun, renderDay, renderAttr, renderShop, renderRunTab,
  curViewGet:()=>curView, setView:(v)=>{curView=v},
  load, save, showExport, showImport, setModalTitle,
  renderNode, renderOutcome, renderTraitPick, renderDeepOffer, renderResult, renderHeader,
  toast, floatText, bind, boot, esc, dstr, parseD, shiftD, pick, openModal, closeModal,
  undoTask, rebuildLeft, dailyLine, updateBadge, sfx, handleBreak, settle, doTask,
  evWeight, drawEvent, unlockedEv, hasTrait, blankDay, dayDiff,
  TASKS, EVENTS, TRAITS, UNLOCKS, ENTRANCES, ATTR_NAME,
  ENERGY_MAX, RUN_COST, RUN_NODES, ANCHOR_AT, TRAIT_PICK_AFTER,
  FOCUS_BASE, FOCUS_MAX, FREE_PASS_MAX, FAIL_COST, OVERLEVEL_COST, VERSION, SAVE_KEY
};`;
let api;
try {
  api = new Function(code + EXPORTS)();
  ok('脚本可在桩环境求值', true);
} catch(e){
  ok('脚本可在桩环境求值', false, e.message);
  console.error(e.stack); process.exit(1);
}

const S = api;

/* ============================================================
   测试开始
   ============================================================ */
console.log('\n=== 《日课》逻辑自检 ===\n');

/* --- T1 数据完整性 --- */
ok('T1.1 打卡任务 7 项', S.TASKS.length === 7, '实际 ' + S.TASKS.length);
ok('T1.2 事件骨架 30 个', S.EVENTS.length === 30, '实际 ' + S.EVENTS.length);
ok('T1.3 词条 24 个', S.TRAITS.length === 24, '实际 ' + S.TRAITS.length);
ok('T1.4 临时词条 16 / 永久 8',
   S.TRAITS.filter(t=>t.type==='tmp').length === 16 && S.TRAITS.filter(t=>t.type==='perm').length === 8,
   'tmp=' + S.TRAITS.filter(t=>t.type==='tmp').length + ' perm=' + S.TRAITS.filter(t=>t.type==='perm').length);
ok('T1.5 属性键统一为 body/mind/will',
   S.TASKS.every(t => ['body','mind','will'].includes(t.attr)));
ok('T1.6 任务属性分布 身3/智2/志2',
   (function(){ const c={body:0,mind:0,will:0}; S.TASKS.forEach(t=>c[t.attr]++);
     return c.body===3 && c.mind===2 && c.will===2; })(),
   JSON.stringify((function(){ const c={body:0,mind:0,will:0}; S.TASKS.forEach(t=>c[t.attr]++); return c; })()));
ok('T1.7 事件 id 无重复', new Set(S.EVENTS.map(e=>e.id)).size === S.EVENTS.length);
ok('T1.8 词条 id 无重复', new Set(S.TRAITS.map(t=>t.id)).size === S.TRAITS.length);
ok('T1.9 每个事件至少有一个无门槛保底选项（防死锁）',
   S.EVENTS.every(e => e.o.some(o => !o.req)),
   S.EVENTS.filter(e=>!e.o.some(o=>!o.req)).map(e=>e.id).join(',') || '全部合格');
ok('T1.10 每个事件都有标题 / 正文 / 至少 1 个选项',
   S.EVENTS.every(e => e.title && e.t && e.t.length > 10 && e.o && e.o.length >= 1),
   S.EVENTS.filter(e => !(e.title && e.t && e.o && e.o.length >= 1)).map(e => e.id).join(','));
const noOk = [];
S.EVENTS.forEach(e => e.o.forEach((o, i) => {
  if (!o.t || !o.ok || !o.okE) noOk.push(e.id + '#' + i);
}));
ok('T1.10b 每个选项都有文案 / 成功文本 / 效果对象', noOk.length === 0, noOk.join(','));
const badReq = [];
S.EVENTS.forEach(e => e.o.forEach((o,i) => {
  if (o.req && (!Array.isArray(o.req) || o.req.length !== 2 || !S.ATTR_NAME[o.req[0]] || typeof o.req[1] !== 'number'))
    badReq.push(e.id + '#' + i);
}));
ok('T1.11 所有 req 形如 [合法属性, 数字]', badReq.length === 0, badReq.join(','));
const badUnlock = [];
S.EVENTS.forEach(e => { if (e.unlock && (!Array.isArray(e.unlock) || !S.ATTR_NAME[e.unlock[0]])) badUnlock.push(e.id); });
ok('T1.12 所有 unlock 形如 [合法属性, 数字]', badUnlock.length === 0, badUnlock.join(','));
ok('T1.13 事件不含任何发放属性的字段（支柱 01）',
   !S.EVENTS.some(e => e.o.some(o => o.okE && o.okE.attr !== undefined)));

/* --- T2 连击系数（GDD 3.4） --- */
const s = S.newState();
S.state = s;
const mulAt = n => { S.state.streak = n; return S.mul(); };
ok('T2.1 streak 0-6  → ×1.0', [0,1,6].every(n => mulAt(n) === 1.0));
ok('T2.2 streak 7-13 → ×1.2', [7,13].every(n => mulAt(n) === 1.2));
ok('T2.3 streak 14-20→ ×1.5', [14,20].every(n => mulAt(n) === 1.5));
ok('T2.4 streak 21+  → ×2.0', [21,50].every(n => mulAt(n) === 2.0));
S.state.streak = 0;

/* --- T3 精力溢出折算 2:1（GDD 3.2） --- */
S.state = S.newState();
S.addEnergy(4); ok('T3.1 精力 4/6', S.state.energy === 4 && S.state.points === 0);
const ov = S.addEnergy(3);  // 4+3=7 → 上限6，溢出1 → floor(1/2)=0 分
ok('T3.2 溢出 1 点 → 折 0 积分且精力封顶 6', ov === 0 && S.state.energy === 6, 'ov=' + ov + ' e=' + S.state.energy);
const ov2 = S.addEnergy(2); // 6+2=8 → 溢出2 → 1 分
ok('T3.3 溢出 2 点 → 折 1 积分', ov2 === 1 && S.state.points === 1, 'ov2=' + ov2 + ' pts=' + S.state.points);
S.addEnergy(-3); ok('T3.4 扣精力不触发折算', S.state.energy === 3 && S.state.points === 1);

/* --- T4 单项打卡（1:1:1 + 即时结算） --- */
S.state = S.newState();
S.state.points = 0;
const before = { e:S.state.energy, p:S.state.points, b:S.state.attrs.body };
const r0 = S.doTask(1, false);      // 出去锻炼 → 身
ok('T4.1 打卡返回结算文案', r0 && Array.isArray(r0.lines) && r0.lines.length > 0);
ok('T4.2 属性 +1（身）', S.state.attrs.body === before.b + 1);
ok('T4.3 积分 +1（连击 ×1.0）', S.state.points === before.p + 1, 'pts=' + S.state.points);
ok('T4.4 精力 +1', S.state.energy === before.e + 1);
ok('T4.5 重复打卡无效', S.doTask(1, false) === null);
const rEv = S.doTask(2, true);      // 带证据
ok('T4.6 附证据积分 ×1.5 → +2', S.state.points === 3, 'pts=' + S.state.points + '（0+1+2 应为 3）');

/* --- T5 满勤加成 + 连击 + 免死金牌 --- */
S.state = S.newState();
for (let i = 0; i < 7; i++) S.doTask(i, false);
ok('T5.1 满勤后 streak=1', S.state.streak === 1, 'streak=' + S.state.streak);
ok('T5.2 满勤标记置位', S.state.cur.full === true);
ok('T5.3 累计满勤天数 +1', S.state.totalFull === 1);
// 精力：7 项 +1 = 7 → 上限 6 溢出 1 → 0 分；满勤再 +1 → 又是溢出 1 → 0 分
ok('T5.4 精力封顶于 6', S.state.energy === 6, 'e=' + S.state.energy);
// 积分：7 项 ×1 = 7，满勤 +5（streak 已变 1，倍率仍 ×1.0）= 12
ok('T5.5 满勤日积分 = 7 + 5 = 12', S.state.points === 12, 'pts=' + S.state.points);
// 属性：身3 智2 志2
ok('T5.6 属性日增 身3/智2/志2',
   S.state.attrs.body === 3 && S.state.attrs.mind === 2 && S.state.attrs.will === 2,
   JSON.stringify(S.state.attrs));

// 连续 7 天满勤 → 免死金牌 + 永久词条
S.state = S.newState();
for (let d = 0; d < 7; d++){
  S.state.cur = S.blankDay(S.todayStr());
  for (let i = 0; i < 7; i++) S.doTask(i, false);
}
ok('T5.7 连续 7 天满勤 → streak=7', S.state.streak === 7, 'streak=' + S.state.streak);
ok('T5.8 第 7 天赠 1 张免死金牌', S.state.freePasses === 1, 'pass=' + S.state.freePasses);
ok('T5.9 连击满 7 天赠 1 个永久词条', S.state.permTraits.length === 1, 'perm=' + JSON.stringify(S.state.permTraits));
ok('T5.10 streak=7 时倍率切到 ×1.2', S.mul() === 1.2);

/* --- T6 断链保护（GDD 4.3） --- */
S.state = S.newState();
S.state.streak = 5;
S.state.freePasses = 1;
S.state.attrs = {body:10, mind:8, will:6};
S.state.points = 40;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -1));
S.state.cur.done[0] = true;   // 昨天只打了 1 项 → 未满勤
const notices = S.settle();
ok('T6.1 未满勤触发断链处理', notices.length >= 1);
ok('T6.2 有金牌 → 消耗 1 张，连击不清零',
   S.state.freePasses === 0 && S.state.streak === 5,
   'pass=' + S.state.freePasses + ' streak=' + S.state.streak);
ok('T6.3 属性不被清零（支柱 04 红线）',
   S.state.attrs.body === 10 && S.state.attrs.mind === 8 && S.state.attrs.will === 6);
ok('T6.4 积分不被清零', S.state.points === 40);
ok('T6.5 结算后 cur 切换到今天', S.state.cur.date === S.todayStr());
ok('T6.6 断链写入 log', S.state.log.length === 1 && S.state.log[0].n === 1);

S.state = S.newState();
S.state.streak = 9;
S.state.freePasses = 0;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -1));
S.settle();
ok('T6.7 无金牌 → 连击归零', S.state.streak === 0, 'streak=' + S.state.streak);

S.state = S.newState();
S.state.streak = 9;
S.state.freePasses = 3;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -4));   // 中间断 3 天
S.settle();
ok('T6.8 连续缺失 3 天 → 消耗 3 张金牌', S.state.freePasses === 0, 'pass=' + S.state.freePasses);
S.state = S.newState();
S.state.streak = 9;
S.state.freePasses = 3;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -5));   // 中间断 4 天，金牌只有 3 张
S.settle();
ok('T6.9 金牌耗尽后连击归零', S.state.freePasses === 0 && S.state.streak === 0,
   'pass=' + S.state.freePasses + ' streak=' + S.state.streak);

/* --- T7 连击系数绝不影响精力（GDD 3.4 硬约束） --- */
S.state = S.newState();
S.state.streak = 30;           // ×2.0
S.doTask(0, false);
ok('T7.1 高连击下打卡精力仍为 +1', S.state.energy === 1, 'e=' + S.state.energy);
ok('T7.2 高连击下打卡积分翻倍为 +2', S.state.points === 2, 'pts=' + S.state.points);

/* --- T8 判定规则（GDD 5.3）：门槛内必定成功 --- */
S.state = S.newState();
S.state.attrs = {body:10, mind:10, will:10};
const evAny = S.EVENTS.find(e => e.o.some(o => o.req));
S.run = null;
let alwaysPass = true;
for (let i = 0; i < 300; i++){
  const ev = S.EVENTS.find(e => e.id === 'ev_lamppost');
  const j = S.judgeOpt(ev, ev.o[0]);        // req mind 6 ≤ 10
  if (!j.pass) { alwaysPass = false; break; }
}
ok('T8.1 门槛内 300 次判定全成功（无随机失败）', alwaysPass);
ok('T8.2 门槛内标记为 safe', S.judgeOpt(S.EVENTS.find(e=>e.id==='ev_lamppost'), S.EVENTS.find(e=>e.id==='ev_lamppost').o[0]).safe === true);
// 越级：属性 0 / 门槛 30 → 成功率被夹到下限 0.05
S.state.attrs = {body:0, mind:0, will:0};
S.state.permTraits = [];
const evDeep = S.EVENTS.find(e => e.id === 'an_deep');
const jg = S.judgeOpt(evDeep, evDeep.o[0]);   // req will 30
ok('T8.3 越级标记为 gamble 且给出成功率', jg.gamble === true && jg.p === 0.05, 'p=' + jg.p);
ok('T8.4 概率夹在 [0.05, 0.95]',
   (function(){ let minp=1, maxp=0;
     for (let i=0;i<2000;i++){ S.state.attrs.will = Math.floor(Math.random()*40);
       const j = S.judgeOpt(evDeep, evDeep.o[0]); if (j.p!=null){ minp=Math.min(minp,j.p); maxp=Math.max(maxp,j.p); } }
     return minp >= 0.05 && maxp <= 0.95; })());
ok('T8.5 无 req 选项必定通过',
   (function(){ const ev=S.EVENTS.find(e=>e.id==='ev_lamppost'); for(let i=0;i<200;i++){ if(!S.judgeOpt(ev,ev.o[1]).pass) return false; } return true; })());

/* --- T9 词条加成真的生效 --- */
S.state = S.newState();
S.state.attrs = {body:0, mind:0, will:0};
S.state.permTraits = [];
S.run = {temp:[]};
const evMirror = S.EVENTS.find(e => e.id === 'ev_mirror');
const b0 = S.judgeBonus(evMirror, 'will');
S.run.temp = ['t_iron'];       // 铁心：志 门槛判定 +3
const b1 = S.judgeBonus(evMirror, 'will');
ok('T9.1 铁心 +3 生效（attrJudge）', b1 === b0 + 3, 'b0=' + b0 + ' b1=' + b1);
S.run.temp = ['t_night'];
ok('T9.2 夜视只对含 night 标签的事件生效',
   S.judgeBonus(S.EVENTS.find(e=>e.id==='ev_lamppost'), 'mind') > 0 &&
   S.judgeBonus(S.EVENTS.find(e=>e.id==='ev_clock'), 'mind') === 0);
S.run.temp = [];
S.state.permTraits = ['p_syn'];  // 通感：全判定 +2
ok('T9.3 永久词条参与判定',
   S.judgeBonus(S.EVENTS.find(e=>e.id==='ev_clock'), 'mind') === 2);
ok('T9.4 初始定力受永久词条影响',
   (function(){ S.state.permTraits=['p_walker']; S.run={temp:[]}; return S.traitSum('initFocus') === 2; })());
S.state.permTraits = []; S.run = null;

/* --- T10 run 序列生成 --- */
S.state = S.newState();
const ent = S.ENTRANCES[0];
let seqOk = true, anchorOk = true, dupOk = true;
for (let i = 0; i < 200; i++){
  const seq = S.buildSeq(ent);
  if (seq.length !== S.RUN_NODES) seqOk = false;
  if (!seq[S.ANCHOR_AT - 1].anchor) anchorOk = false;
  const ids = seq.map(e => e.id);
  if (new Set(ids).size !== ids.length) dupOk = false;
}
ok('T10.1 每局固定 ' + S.RUN_NODES + ' 个节点', seqOk);
ok('T10.2 第 ' + S.ANCHOR_AT + ' 个节点必定是锚点', anchorOk);
ok('T10.3 单局内事件不重复', dupOk);
ok('T10.4 深层事件不进普通序列',
   (function(){ for(let i=0;i<200;i++){ if(S.buildSeq(ent).some(e=>e.deep)) return false; } return true; })());
// 解锁门槛
S.state.attrs = {body:0, mind:0, will:0};
ok('T10.5 属性不足时解锁事件不进池',
   S.EVENTS.filter(e => e.unlock).every(e => !S.unlockedEv(e)));
S.state.attrs = {body:20, mind:15, will:0};
ok('T10.6 达标后解锁事件进池',
   S.EVENTS.filter(e => e.unlock).every(e => S.unlockedEv(e)));

/* --- T11 完整 run 全流程 --- */
S.state = S.newState();
S.state.energy = 6;
S.state.attrs = {body:40, mind:40, will:40};   // 高属性让所有门槛都过
S.startRun();
ok('T11.1 run 已创建', !!S.run);
ok('T11.2 精力被扣除 ' + S.RUN_COST, S.state.energy === 6 - S.RUN_COST, 'e=' + S.state.energy);
ok('T11.3 pendingRun 已登记（防中途退出丢精力）', !!S.state.pendingRun);
ok('T11.4 初始定力 = 8 + floor(志/10)', S.run.focus === S.FOCUS_BASE + 4, 'focus=' + S.run.focus);

let guard = 0, traitPicked = false, deepPrompted = false;
const trace = [];
while (S.run && S.run.mode !== 'result' && guard++ < 60){
  trace.push(S.run.mode + '@' + S.run.node + '/' + S.run.seq.length + (S.run.deep ? '/deep' : ''));
  if (S.run.mode === 'node'){
    S.chooseOption(0);                       // 永远选第一个
  } else if (S.run.mode === 'outcome'){
    S.nextStep();
  } else if (S.run.mode === 'trait'){
    traitPicked = true;
    S.grantTrait(S.TRAITS.find(t => t.type === 'tmp'));
    S.run.traitPicked = true; S.run._offer = null; S.run.mode = 'node';
  } else if (S.run.mode === 'deep'){
    deepPrompted = true;
    S.run.deep = true;
    S.run.seq.push(S.EVENTS.find(e => e.deep));
    S.run.mode = 'node';
  }
}
ok('T11.5 run 能走到结算', S.run && S.run.mode === 'result', 'mode=' + (S.run ? S.run.mode : 'null') + ' guard=' + guard);
ok('T11.6 途中触发过词条三选一', traitPicked);
ok('T11.7 走完后触发深入抉择', deepPrompted);
ok('T11.8 结算结果字段完整',
   S.run.result && typeof S.run.result.pts === 'number' && typeof S.run.result.base === 'number',
   JSON.stringify(S.run.result));
ok('T11.9 深层通关基础分 = 7×2+20 = 34（无词条加成时）',
   S.run.result.base === 34,
   'base=' + S.run.result.base + ' kind=' + S.run.result.kind
   + ' deep=' + S.run.deep + ' lastPass=' + S.run.lastPass
   + ' seqLen=' + S.run.seq.length
   + ' | trace=' + trace.join(' → '));
ok('T11.10 结算后 pendingRun 清空', S.state.pendingRun === null);
ok('T11.11 冒险次数 +1', S.state.totalRun === 1);
ok('T11.12 属性全程未被 run 改变（支柱 01）',
   S.state.attrs.body === 40 && S.state.attrs.mind === 40 && S.state.attrs.will === 40);

/* --- T12 定力归零 → 失败结算，且不清空资产 --- */
S.state = S.newState();
S.state.energy = 6;
S.state.attrs = {body:0, mind:0, will:0};
S.state.points = 100;
S.state.permTraits = [];
S.run = null;                                 // 清掉上一局，否则 startRun 会被 `if (run) return` 拦下
S.startRun();
ok('T12.0 新 run 已建立', !!S.run && S.run.mode === 'node');
S.run.focus = 1;                              // 强制濒死
guard = 0;
while (S.run && S.run.mode !== 'result' && guard++ < 60){
  if (S.run.mode === 'node') S.chooseOption(1);   // 选保底/低收益选项
  else if (S.run.mode === 'outcome') S.nextStep();
  else if (S.run.mode === 'trait'){
    S.grantTrait(S.TRAITS.find(t => t.type === 'tmp'));
    S.run.traitPicked = true; S.run._offer = null; S.run.mode = 'node';
  } else if (S.run.mode === 'deep'){ S.run.mode = 'node'; }
}
ok('T12.1 定力归零导致失败结算', S.run && S.run.result.kind === 'dead', 'kind=' + (S.run ? S.run.result.kind : '?'));
ok('T12.2 失败结算 = 已过节点 × 2', S.run.result.base === S.run.result.passed * 2,
   'base=' + S.run.result.base + ' passed=' + S.run.result.passed);
ok('T12.3 失败不清空积分（支柱 04）', S.state.points >= 100, 'pts=' + S.state.points);
ok('T12.4 结算记录了本局临时词条（用于展示清空）', Array.isArray(S.run.result.traits));
ok('T12.5 失败不发放永久词条', S.run.result.drop === null || S.run.result.drop === undefined);

/* --- T13 兑换与导出数据 --- */
S.state = S.newState();
ok('T13.1 默认四档兑换清单', S.state.rewards.length === 4);
ok('T13.2 档位数值 25/150/400/900',
   JSON.stringify(S.state.rewards.map(r => r.cost)) === '[25,150,400,900]',
   JSON.stringify(S.state.rewards.map(r => r.cost)));
ok('T13.3 即时档当天可达（日产出约 28 分 > 25 分）', S.state.rewards[0].cost <= 28);
ok('T13.4 状态可完整序列化（导出/导入用）',
   (function(){ try { const j = JSON.stringify(S.state); const o = JSON.parse(j); return !!o.attrs && Array.isArray(o.rewards); } catch(e){ return false; } })());

/* --- T14 词条数值自查 --- */
const traitBad = [];
S.TRAITS.forEach(t => {
  if (!t.id || !t.name || !t.desc || !t.eff) traitBad.push(t.id || '?');
  if (t.type !== 'tmp' && t.type !== 'perm') traitBad.push(t.id + '(type)');
});
ok('T14.1 词条字段完整', traitBad.length === 0, traitBad.join(','));
ok('T14.2 临时词条含「加收益」与「减风险」两类（构筑张力 · GDD 5.4）',
   S.TRAITS.filter(t=>t.type==='tmp').some(t=>t.eff.judge||t.eff.tags||t.eff.attrJudge) &&
   S.TRAITS.filter(t=>t.type==='tmp').some(t=>t.eff.dmgReduce||t.eff.initFocus>0));
ok('T14.3 存在自带代价的词条（风险换收益）',
   S.TRAITS.filter(t=>t.type==='tmp').some(t=>t.eff.initFocus < 0),
   '有 ' + S.TRAITS.filter(t=>t.type==='tmp'&&t.eff.initFocus<0).length + ' 个');

/* --- T15 解锁表与失败点设计 --- */
ok('T15.1 解锁表 9 条', S.UNLOCKS.length === 9, '实际 ' + S.UNLOCKS.length);
const firstUnlock = S.UNLOCKS.filter(u => u.kind !== 'world').sort((a,b)=>a.val-b.val)[0];
ok('T15.2 首个可达解锁点门槛 ≤ 20（对应第 7-8 天失败点）', firstUnlock.val <= 20,
   firstUnlock.attr + ' ' + firstUnlock.val);
ok('T15.3 解锁门槛单调递增（每个属性）',
   ['body','mind','will'].every(a => {
     const v = S.UNLOCKS.filter(u=>u.attr===a).map(u=>u.val);
     return v.every((x,i) => i === 0 || x > v[i-1]);
   }));

/* --- T16 渲染层：真实产出 HTML，逐页回读断言 --- */
const noPlaceholder = h => !h.includes('undefined') && !h.includes('NaN') && !h.includes('[object');

S.state = S.newState();
S.setView('day'); S.render();
const dayHtml = els['#v-day'].innerHTML;
ok('T16.1 打卡页渲染出 7 张任务卡',
   (dayHtml.match(/class="task/g) || []).length === 7,
   '实际 ' + (dayHtml.match(/class="task/g) || []).length);
ok('T16.2 打卡页含全部任务名', S.TASKS.every(t => dayHtml.includes(t.name)));
ok('T16.3 打卡页含进度条与免死金牌说明',
   dayHtml.includes('daybar') && dayHtml.includes('免死金牌'));
ok('T16.4 打卡页无未替换占位', noPlaceholder(dayHtml));

S.doTask(0, false);
ok('T16.5 打卡后卡片切到已完成态', els['#v-day'].innerHTML.includes('task done'));

S.state = S.newState();
S.state.energy = 6;
S.state.attrs = {body:40, mind:40, will:40};
S.run = null;
S.startRun();
const nodeHtml = els['#mBody'].innerHTML;
const ev0 = S.run.seq[0];
ok('T16.6 冒险节点页渲染出事件标题', nodeHtml.includes(ev0.title));
ok('T16.7 冒险节点页渲染出事件正文（ev.text 缺陷的回归测试）',
   nodeHtml.includes(ev0.t.slice(0, 12)), '正文未出现在渲染结果中');
ok('T16.8 冒险节点页选项数正确',
   (nodeHtml.match(/class="opt"/g) || []).length === ev0.o.length,
   '预期 ' + ev0.o.length + ' 实际 ' + (nodeHtml.match(/class="opt"/g) || []).length);
ok('T16.9 选项带门槛 / 保底提示',
   nodeHtml.includes('门槛') || nodeHtml.includes('保底路径'));
ok('T16.10 冒险节点页无未替换占位', noPlaceholder(nodeHtml));
ok('T16.11 头部资源栏无未替换占位',
   noPlaceholder(els['#hdStreak'].innerHTML + els['#hdEnergy'].innerHTML + els['#hdPoints'].textContent));

S.setView('attr'); S.render();
const attrHtml = els['#v-attr'].innerHTML;
ok('T16.12 属性页含三属性与解锁表全部条目',
   ['身','智','志'].every(x => attrHtml.includes(x)) && S.UNLOCKS.every(u => attrHtml.includes(u.name)),
   S.UNLOCKS.filter(u => !attrHtml.includes(u.name)).map(u => u.name).join(','));
ok('T16.13 属性页无未替换占位', noPlaceholder(attrHtml));

S.setView('shop'); S.render();
const shopHtml = els['#v-shop'].innerHTML;
ok('T16.14 兑换页四档齐全且数值正确',
   ['即时','周','半月','月'].every(x => shopHtml.includes(x)) &&
   ['25','150','400','900'].every(x => shopHtml.includes('>' + x + '<')));
ok('T16.15 兑换页无未替换占位', noPlaceholder(shopHtml));

S.setView('run'); S.render();
const runTabHtml = els['#v-run'].innerHTML;
ok('T16.16 冒险页含三个入口', S.ENTRANCES.every(e => runTabHtml.includes(e.name)));
ok('T16.17 冒险页无未替换占位', noPlaceholder(runTabHtml));

/* 结算页也要能渲染 */
S.setView('day');
S.state = S.newState();
S.state.energy = 6;
S.state.attrs = {body:40, mind:40, will:40};
S.run = null;
S.startRun();
guard = 0;
while (S.run && S.run.mode !== 'result' && guard++ < 60){
  if (S.run.mode === 'node') S.chooseOption(0);
  else if (S.run.mode === 'outcome') S.nextStep();
  else if (S.run.mode === 'trait'){
    S.grantTrait(S.TRAITS.find(t => t.type === 'tmp'));
    S.run.traitPicked = true; S.run._offer = null; S.run.mode = 'node';
  } else if (S.run.mode === 'deep'){
    S.run.deep = true; S.run.seq.push(S.EVENTS.find(e => e.deep)); S.run.mode = 'node';
  }
}
const resHtml = els['#mBody'].innerHTML;
ok('T16.18 结算页渲染出收益明细', /class="gain"/.test(resHtml) && resHtml.includes('连击倍率'));
ok('T16.19 结算页无未替换占位', noPlaceholder(resHtml));

/* --- T17 健壮性：脏数据不应导致崩溃 --- */
global.localStorage.setItem(S.SAVE_KEY, '{{{ 这不是 JSON');
ok('T17.1 损坏存档被安全拒绝', S.load() === false);
global.localStorage.setItem(S.SAVE_KEY, JSON.stringify({version: 999, attrs: null}));
ok('T17.2 版本不符的存档被拒绝', S.load() === false);
global.localStorage.setItem(S.SAVE_KEY, JSON.stringify({version: S.VERSION}));
S.state = S.newState();
ok('T17.3 字段残缺的存档能补齐后加载', S.load() === true);
ok('T17.4 补齐后 done 数组长度对齐任务数',
   S.state.cur.done.length === S.TASKS.length && S.state.cur.evi.length === S.TASKS.length,
   'done=' + S.state.cur.done.length);
S.state.cur = null;
ok('T17.5 cur 为 null 时 settle 不抛异常',
   (function(){ try { S.settle(); return true; } catch(e){ return false; } })());

/* --- T18 弹层：导出 / 导入 --- */
try {
  S.showExport();
  const expHtml = els['#mBody'].innerHTML;
  ok('T18.1 导出弹层可渲染', expHtml.includes('导出数据') && expHtml.includes('expArea'));
  ok('T18.2 导出弹层含状态 JSON', expHtml.includes('version') && expHtml.includes('attrs'));
  ok('T18.3 导出弹层无占位残留', noPlaceholder(expHtml));
  ok('T18.4 弹层头部标题被设置', els['#mHdr'].innerHTML.includes('数据'));
} catch(e){ ok('T18.1 导出弹层可渲染', false, e.message); }

try {
  S.showImport();
  const impHtml = els['#mBody'].innerHTML;
  ok('T18.5 导入弹层可渲染', impHtml.includes('导入数据') && impHtml.includes('impArea'));
} catch(e){ ok('T18.5 导入弹层可渲染', false, e.message); }

/* --- T19 函数完整性：被调用的顶层函数必须全部有定义 --- */
const needFns = ['render','renderRun','renderDay','renderAttr','renderShop','renderRunTab',
  'renderNode','renderOutcome','renderTraitPick','renderDeepOffer','renderResult','renderHeader',
  'showExport','showImport','setModalTitle','toast','floatText','bind','boot','save','load',
  'settle','doTask','startRun','chooseOption','nextStep','endRun','closeRun','buildSeq',
  'judgeOpt','judgeBonus','grantTrait','traitSum','allEff','addEnergy','applyMul','mul',
  'handleBreak','blankDay','newState','dstr','todayStr','parseD','dayDiff','shiftD','pick',
  'esc','unlockedEv','evWeight','drawEvent','hasTrait','openModal','closeModal'];
const missing = needFns.filter(f => typeof S[f] !== 'function');
ok('T19.1 所有顶层函数均有定义（无未定义引用）', missing.length === 0, '缺失：' + missing.join(', '));

/* --- T20 event 绑定完整性：data-act 值都有对应处理分支 --- */
const bindSrc = (code.match(/function bind\(\)\{[\s\S]*?\n\}/) || [''])[0];
const actsInBind = new Set((bindSrc.match(/act === '([a-zA-Z]+)'/g) || []).map(x => x.replace(/act === '|'/g, '')));
const actsInHtml = new Set((html.match(/data-act="([a-zA-Z]+)"/g) || []).map(x => x.replace(/data-act="|"/g, '')));
const deadActs = [...actsInHtml].filter(a => !actsInBind.has(a));
ok('T20.1 所有 data-act 都有处理分支（无死按钮）', deadActs.length === 0, '无处理：' + deadActs.join(', '));
ok('T20.2 data-act 覆盖数 ≥ 15', actsInHtml.size >= 15, '实际 ' + actsInHtml.size);

/* --- T21 CSS 变量引用完整性（拼错会导致样式静默失效） --- */
const rootVars = new Set((html.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) || []));
const usedNoFallback = [...html.matchAll(/var\((--[a-zA-Z0-9-]+)\s*\)/g)].map(m => m[1]);
const usedAll = [...html.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map(m => m[1]);
const undef = [...new Set(usedNoFallback)].filter(v => !rootVars.has(v));
ok('T21.1 所有无 fallback 的 var() 变量都有定义', undef.length === 0, '未定义：' + undef.join(', '));
ok('T21.2 定义了但从未使用的变量应极少（≤3）',
   [...rootVars].filter(v => !usedAll.includes(v)).length <= 3,
   '未使用：' + [...rootVars].filter(v => !usedAll.includes(v)).join(', '));

/* --- T22 样式表基本完整性 --- */
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const open = (styleBlock.match(/\{/g) || []).length;
const close = (styleBlock.match(/\}/g) || []).length;
ok('T22.1 CSS 花括号配对', open === close, '{=' + open + ' }=' + close);
ok('T22.2 存在移动端视口声明', html.includes('viewport-fit=cover') && html.includes('width=device-width'));
ok('T22.3 存在 iOS 主屏配置', html.includes('apple-mobile-web-app-capable') && html.includes('apple-mobile-web-app-title'));
ok('T22.4 底部导航栏避开 iPhone 安全区', styleBlock.includes('env(safe-area-inset-bottom)'));
ok('T22.5 触控目标不小于 44px 量级（任务卡高度足够）',
   /\.task\{[^}]*padding:12px 14px/.test(styleBlock) || styleBlock.includes('padding:13px 14px'));
ok('T22.6 HTML 结构闭合（div 开闭数量一致）',
   (html.match(/<div[\s>]/g) || []).length === (html.match(/<\/div>/g) || []).length,
   '<div>=' + (html.match(/<div[\s>]/g) || []).length + ' </div>=' + (html.match(/<\/div>/g) || []).length);

/* --- T23 撤销打卡（the-forge 心法：误触可纠正） --- */
S.state = S.newState();
S.state.points = 50; S.state.energy = 2;
const pre = { p:S.state.points, e:S.state.energy, b:S.state.attrs.body };
S.doTask(1, false);                          // 出去锻炼 → 身 +1
ok('T23.1 打卡后 paid 有记账', !!S.state.cur.paid[1], JSON.stringify(S.state.cur.paid[1]));
S.undoTask(1);
ok('T23.2 撤销后 done 复位', S.state.cur.done[1] === false);
ok('T23.3 撤销按实付回滚积分', S.state.points === pre.p + 1 - S.state.cur.paid[1] || S.state.points === pre.p,
   'pts=' + S.state.points + ' pre.p=' + pre.p);
// 精确回滚断言（撤销后应精确回到打卡前）
S.state = S.newState(); S.state.points = 50; S.state.energy = 2;
const p2 = S.state.points, e2 = S.state.energy, b2 = S.state.attrs.body;
S.doTask(1, false); S.undoTask(1);
ok('T23.4 撤销后积分精确复原', S.state.points === p2, 'pts=' + S.state.points + ' 应=' + p2);
ok('T23.5 撤销后精力精确复原', S.state.energy === e2, 'e=' + S.state.energy + ' 应=' + e2);
ok('T23.6 撤销后属性精确复原', S.state.attrs.body === b2, 'b=' + S.state.attrs.body);
ok('T23.7 撤销后可重新打卡', S.doTask(1, false) !== null);
// 满勤后不可撤销
S.state = S.newState();
for (let i = 0; i < 7; i++) S.doTask(i, false);
S.undoTask(3);
ok('T23.8 满勤后撤销被拒绝（防刷）', S.state.cur.done[3] === true && S.state.streak === 1,
   'done[3]=' + S.state.cur.done[3] + ' streak=' + S.state.streak);
// 精力溢出场景的记账
S.state = S.newState(); S.state.energy = S.ENERGY_MAX;   // 满精力打卡 → +1 全溢出
const ptsBefore = S.state.points;
S.doTask(0, false);
ok('T23.9 溢出场景 paid 记账包含折算积分', S.state.cur.paid[0].pts >= 1,
   JSON.stringify(S.state.cur.paid[0]));

/* --- T24 重建期（Rebuild Protocol） --- */
S.state = S.newState();
S.state.streak = 5; S.state.freePasses = 0;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -1));
S.settle();
ok('T24.1 真断链（原 streak≥3）触发重建期', !!S.state.rebuild, JSON.stringify(S.state.rebuild));
ok('T24.2 重建期剩 3 天', S.rebuildLeft() === 3, 'left=' + S.rebuildLeft());
// 重建期内打卡积分 ×1.5（×1.0 倍率下 1 → 2）
const pts0 = S.state.points;
S.doTask(0, false);
ok('T24.3 重建期打卡积分 = round(1×1.5) = 2', S.state.points === pts0 + 2,
   'pts=' + S.state.points + ' pts0=' + pts0);
// streak=2 断链不触发（门槛 ≥3）
S.state = S.newState();
S.state.streak = 2; S.state.freePasses = 0;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -1));
S.settle();
ok('T24.4 原 streak<3 断链不触发重建期', !S.state.rebuild);
// 到期清理：start 设为 4 天前
S.state = S.newState();
S.state.rebuild = {start: S.shiftD(S.todayStr(), -4), days: 3};
ok('T24.5 过期重建期 rebuildLeft=0', S.rebuildLeft() === 0);
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -1));
S.settle();
ok('T24.6 settle 清理过期重建期', !S.state.rebuild);
// 有金牌接住时不触发重建期
S.state = S.newState();
S.state.streak = 5; S.state.freePasses = 1;
S.state.cur = S.blankDay(S.shiftD(S.todayStr(), -1));
S.settle();
ok('T24.7 金牌接住的断链不触发重建期', !S.state.rebuild && S.state.streak === 5);

/* --- T25 深层掉落防刷（每天只掷 1 次） --- */
S.state = S.newState();
S.state.energy = 6;
S.state.attrs = {body:40, mind:40, will:40};
S.run = null;
S.startRun();
guard = 0;
while (S.run && S.run.mode !== 'result' && guard++ < 60){
  if (S.run.mode === 'node') S.chooseOption(0);
  else if (S.run.mode === 'outcome') S.nextStep();
  else if (S.run.mode === 'trait'){
    S.grantTrait(S.TRAITS.find(t => t.type === 'tmp'));
    S.run.traitPicked = true; S.run._offer = null; S.run.mode = 'node';
  } else if (S.run.mode === 'deep'){
    S.run.deep = true; S.run.seq.push(S.EVENTS.find(e => e.deep)); S.run.mode = 'node';
  }
}
ok('T25.1 首次 deep 结算已掷掉落（dropRolled 标记）',
   S.run.result.dropRolled === true, JSON.stringify({dropRolled:S.run.result.dropRolled}));
ok('T25.2 首次掷后 lastPermDrop 记为今天', S.state.lastPermDrop === S.todayStr());
const permCount = S.state.permTraits.length;
// 同日第二次 deep —— 强制走到 deep 结算
S.run = null;
S.state.energy = 6;
S.startRun();
guard = 0;
while (S.run && S.run.mode !== 'result' && guard++ < 60){
  if (S.run.mode === 'node') S.chooseOption(0);
  else if (S.run.mode === 'outcome') S.nextStep();
  else if (S.run.mode === 'trait'){
    S.grantTrait(S.TRAITS.find(t => t.type === 'tmp'));
    S.run.traitPicked = true; S.run._offer = null; S.run.mode = 'node';
  } else if (S.run.mode === 'deep'){
    S.run.deep = true; S.run.seq.push(S.EVENTS.find(e => e.deep)); S.run.mode = 'node';
  }
}
ok('T25.3 同日第二次 deep 不再掷掉落', S.run.result.drop === null && S.run.result.dropRolled === true,
   'drop=' + JSON.stringify(S.run.result.drop && S.run.result.drop.id));
ok('T25.4 同日重复 deep 不增加永久词条', S.state.permTraits.length === permCount,
   'perm=' + S.state.permTraits.length + ' 应=' + permCount);

/* --- T26 每日一句：确定性（刷新不重掷） --- */
S.state = S.newState();
const l1 = S.dailyLine(), l2 = S.dailyLine();
ok('T26.1 同一天两次调用结果一致', l1 === l2, l1 + ' vs ' + l2);
ok('T26.2 返回非空字符串', typeof l1 === 'string' && l1.length > 5, l1);

/* --- T27 徽章与音效在无 API 环境下降级不崩溃 --- */
ok('T27.1 updateBadge 无 Badge API 时不抛异常',
   (function(){ try { S.updateBadge(); return true; } catch(e){ return false; } })());
ok('T27.2 sfx 无 AudioContext 时不抛异常',
   (function(){ S.state.sound = true; try { S.sfx('check'); S.sfx('full'); S.sfx('settle'); return true; } catch(e){ return false; } })());

/* --- T28 新渲染元素 --- */
S.state = S.newState();
S.state.attrs = {body:0, mind:0, will:0};
S.setView('day'); S.render();
const dayHtml2 = els['#v-day'].innerHTML;
ok('T28.1 打卡页含每日一句', dayHtml2.includes('daily-line'));
ok('T28.2 打卡页含最近解锁（Proximity Scan）', dayHtml2.includes('离你最近的三扇门') && dayHtml2.includes('prox-item'));
ok('T28.3 时间计量：显示剩余分钟', dayHtml2.includes('约') && dayHtml2.includes('分钟'));
ok('T28.4 每日一句无占位残留', !dayHtml2.includes('undefined') && !dayHtml2.includes('NaN'));
// 全解锁后 prox 区消失
S.state = S.newState();
S.state.attrs = {body:999, mind:999, will:999};
S.setView('day'); S.render();
ok('T28.5 全部解锁后不再显示最近解锁区', !els['#v-day'].innerHTML.includes('离你最近的三扇门'));
// 重建期横幅渲染
S.state = S.newState();
S.state.rebuild = {start: S.todayStr(), days: 3};
S.setView('day'); S.render();
ok('T28.6 重建期横幅渲染', els['#v-day'].innerHTML.includes('重建期') && els['#v-day'].innerHTML.includes('rebuild-banner'));
// 撤销按钮只在已打卡项出现
S.state = S.newState();
S.doTask(0, false);
S.setView('day'); S.render();
const dh3 = els['#v-day'].innerHTML;
ok('T28.7 已打卡项渲染撤销按钮', dh3.includes('data-act="undo"'));
ok('T28.8 商店页含音效开关', (S.setView('shop'), S.render(), els['#v-shop'].innerHTML.includes('音效')));

/* ---------- 汇总 ---------- */
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
if (fail){
  console.log('失败明细：');
  errs.forEach(e => console.log('  ✗ ' + e));
  console.log('');
  process.exit(1);
} else {
  console.log('全部通过 ✓\n');
}
