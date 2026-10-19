/* 夜行 v3 自检 —— 在 vm 沙箱里用 DOM 桩跑真实脚本 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts[scripts.length - 1];

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }

/* ---------- DOM 桩 ---------- */
function mkEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '',
    style: {}, dataset: {},
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                 toggle(c, v){ v ? this._s.add(c) : this._s.delete(c); }, contains(c){return this._s.has(c);} },
    appendChild(){}, closest(){ return null; }
  };
}
const els = {};
function getEl(id) { if (!els[id]) els[id] = mkEl(id); return els[id]; }

class LS {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k,v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
  clear(){ this.map.clear(); }
}
const ls = new LS();

const listeners = {};
const doc = {
  getElementById: getEl,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  createElement: () => mkEl('tmp'),
  body: mkEl('body'),
  visibilityState: 'visible'
};

const ctx = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, parseInt, parseFloat,
  isNaN, encodeURIComponent, decodeURIComponent, escape, unescape, btoa: s => Buffer.from(s,'binary').toString('base64'),
  atob: s => Buffer.from(s,'base64').toString('binary'),
  document: doc,
  localStorage: ls,
  navigator: { serviceWorker: undefined },
  location: { protocol: 'http:', reload(){} },
  serviceWorker: undefined,
  setTimeout: (f) => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  confirm: () => true,
  alert: () => {}
};
ctx.window = ctx;
ctx.globalThis = ctx;

const sandbox = vm.createContext(ctx);
let bootErr = null;
try { new vm.Script(code).runInContext(sandbox); }
catch (e) { bootErr = e; }
ok('脚本无语法/启动错误', !bootErr, bootErr && bootErr.message);

/* 从沙箱取出内部函数 */
function S(expr) { return vm.runInContext(expr, sandbox); }

if (!bootErr) {
  /* ---------- 1. 基础状态 ---------- */
  const s0 = S('state');
  ok('初始状态存在', !!s0);
  eq('初始材料归零', s0.mats, { wood:0, cloth:0, paper:0, metal:0 });
  eq('初始建造等级全 0', s0.build, { shelf:0, sand:0, wall:0, gram:0 });
  ok('家已点亮 1 度', s0.city.home.lit === 1);
  eq('街区总数 12', Object.keys(s0.city).length, 12);

  /* ---------- 2. 筹码公式 ---------- */
  S('state.checks = {}; state.sleptLast = false; state.clueBank = 0; state.nightsToday = 0; state.nightDay = null;');
  eq('0 件 → 2 滴油', S('chips().oil'), 2);
  eq('0 件 → 0 胆', S('chips().nerve'), 0);
  eq('0 件 → 0 线索', S('chips().clue'), 0);

  S('state.checks = {wake:1,train:1,shower:1,study:1,quit:1,read:1,sleep:1}; state.nightsToday = 0; state.nightDay = null;');
  eq('7 件全做 → 9 滴油', S('chips().oil'), 9);
  eq('7 件全做 → 3 胆', S('chips().nerve'), 3);
  eq('7 件全做 → 3 线索', S('chips().clue'), 3);
  eq('7 件全做 → 隐蔽 1', S('chips().stealth'), 1);

  S('state.checks = {wake:1,train:1}; state.nightsToday = 0;');
  eq('2 件（早起+锻炼）→ 5 滴油', S('chips().oil'), 5);

  S('state.checks = {}; state.sleptLast = true;');
  eq('昨日早睡 → +2 滴', S('chips().oil'), 4);

  S('state.sleptLast = false; state.checks = {wake:1,train:1}; state.nightDay = state.date; state.nightsToday = 1;');
  eq('同日第二次入夜 → 扣 2 滴', S('chips().oil'), 3);
  S('state.nightsToday = 3;');
  eq('同日第四次 → 最低保底 1 滴', S('chips().oil'), 1);
  S('state.nightsToday = 0; state.nightDay = null;');

  /* ---------- 3. 日期 ---------- */
  const tk = S('todayKey()');
  ok('todayKey 格式 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(tk), tk);
  ok('todayKey 无 UTC 偏移（与本地日期一致）', tk === (() => {
    const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  })());

  /* ---------- 4. 解锁逻辑 ---------- */
  eq('初始解锁街区数', S('unlockedList().length'), 4); // home, shop, b3, shed
  ok('十字路口未解锁', S("isUnlocked(BLOCKS.find(b=>b.id==='cross'))") === false);
  S('state.city.shop.lit = 3;');
  ok('点亮便利店后十字路口解锁', S("isUnlocked(BLOCKS.find(b=>b.id==='cross'))") === true);
  S('state.city.shop.lit = 0;');

  /* ---------- 5. 枯竭与危险 ---------- */
  S('state.city.b3.drained = 0;');
  const y0 = S("yieldOf('b3').n");
  S('state.city.b3.drained = 3;');
  const y3 = S("yieldOf('b3').n");
  ok('枯竭降低产出', y3 < y0, y0 + ' → ' + y3);
  S('state.city.b3.drained = 5;');
  ok('枯竭到底仍有保底 1', S("yieldOf('b3').n") >= 1);

  S('state.city.b3.drained = 0; state.city.b3.lit = 0;');
  const d0 = S("dangerOf('b3')");
  S('state.city.b3.lit = 3;');
  const d3 = S("dangerOf('b3')");
  ok('点亮降低危险', d3 < d0, d0.toFixed(2) + ' → ' + d3.toFixed(2));

  /* ---------- 6. 完整一夜 ---------- */
  S('state.checks = {wake:1,train:1,study:1}; state.nightsToday = 0; state.nightDay = null; state.sleptLast = false;');
  S("startNight('shop')");
  const night = S('state.night');
  ok('入夜建立状态', !!night);
  eq('入夜油量 = 6（3件含早起）', night.oil, 6);
  eq('入夜胆 = 2', night.nerve, 2);
  ok('有当前节点', !!S('state.night.node'));
  ok('节点有文字', typeof S('state.night.node.t') === 'string' && S('state.night.node.t').length > 4);
  ok('节点至少 1 个选项', S('state.night.node.o.length') >= 1);

  // 执行第一个能负担的选项
  // 固定节点，避免随机抽到诱惑节点导致断言不稳
  S('state.night.node = NODES.shop[0]; state.night.oil = 6; state.night.steps = 0;');
  const idx = S('state.night.node.o.findIndex(o => canAfford(o))');
  ok('至少有一个可负担选项', idx >= 0);
  S('chooseOpt(' + idx + ')');
  ok('执行后步数 +1', S('state.night.steps') === 1);
  ok('执行后灯油被扣', S('state.night.oil') === 5, '实际 ' + S('state.night.oil'));

  // 换地方
  S('state.night.pendingMove = true;');
  ok('邻居列表非空', S("neighbors('shop').length") >= 1);
  S("moveTo('home')");
  ok('移动后换街区', S("state.night.cur") === 'home');
  ok('移动后油再 -1', S('state.night.oil') === 4, '实际 ' + S('state.night.oil'));

  // 回家结算
  const beforeWood = S('state.mats.wood');
  S("endNight('home')");
  ok('结束后夜间状态清空', S('state.night') === null);
  ok('夜间计入统计', S('state.stats.nights') === 1);
  ok('历史有记录', S('state.history.length') === 1);

  /* ---------- 7. 油耗尽结算保留率 ---------- */
  S('state.build.sand = 0; state.mats.cloth = 0;');
  S('state.night = {start:"home",cur:"home",steps:0,oil:0,oilMax:2,nerve:0,clue:0,stealth:0,carried:{cloth:10},node:null,ended:false};');
  S("endNight('oil')");
  eq('沙袋 0 级：油耗尽保留 50%', S('state.mats.cloth'), 5);

  S('state.build.sand = 3; state.mats.cloth = 0;');
  S('state.night = {start:"home",cur:"home",steps:0,oil:0,oilMax:2,nerve:0,clue:0,stealth:0,carried:{cloth:10},node:null,ended:false};');
  S("endNight('oil')");
  eq('沙袋 3 级：油耗尽保留 100%', S('state.mats.cloth'), 10);

  /* ---------- 8. 受伤与死亡 ---------- */
  S('state.build.sand = 0; state.walker.injuries = 0; state.notes = []; state.stats.deaths = 0; state.walker.gen = 1;');
  S('state.mats.cloth = 0;');
  S('state.night = {start:"home",cur:"home",steps:0,oil:1,oilMax:2,nerve:0,clue:0,stealth:0,carried:{cloth:10},node:null,ended:false};');
  S("endNight('hurt')");
  ok('受伤累计 1 次', S('state.walker.injuries') === 1);
  eq('受伤保留 50%', S('state.mats.cloth'), 5);

  S('state.night = {start:"home",cur:"home",steps:0,oil:1,oilMax:2,nerve:0,clue:0,stealth:0,carried:{cloth:10},node:null,ended:false};');
  S("endNight('hurt')");
  S('state.night = {start:"home",cur:"home",steps:0,oil:1,oilMax:2,nerve:0,clue:0,stealth:0,carried:{cloth:10},node:null,ended:false};');
  S("endNight('hurt')");
  ok('第 3 次受伤 → 换代', S('state.walker.gen') === 2);
  ok('死亡计数 +1', S('state.stats.deaths') === 1);
  ok('死亡留下笔记', S('state.notes.length') === 1);
  ok('死亡不清空城市', Object.keys(S('state.city')).length === 12);
  ok('死亡不清空建造', S('state.build.sand') === 0);

  /* ---------- 9. 建造 ---------- */
  S('state.mats.wood = 100; state.build.shelf = 0;');
  S("doBuild('shelf')");
  eq('书架升到 1 级', S('state.build.shelf'), 1);
  eq('扣木 3', S('state.mats.wood'), 97);
  S("doBuild('shelf')"); S("doBuild('shelf')");
  eq('书架封顶 3 级', S('state.build.shelf'), 3);
  const woodAfter = S('state.mats.wood');
  S("doBuild('shelf')");
  eq('满级后不再扣材料', S('state.mats.wood'), woodAfter);

  S('state.build.shelf = 2; state.checks = {study:1}; state.clueBank = 0;');
  eq('书架 2 级 → 线索 +2', S('chips().clue'), 3); // study 1 + shelf 2
  S('state.build.shelf = 0;');

  /* ---------- 10. 存档往返 ---------- */
  S('state.mats.paper = 42; save();');
  const raw = ls.getItem('rike_night_v3');
  ok('存档已写入', !!raw);
  const parsed = JSON.parse(raw);
  eq('存档版本 3', parsed.v, 3);
  eq('存档保留材料', parsed.mats.paper, 42);

  /* ---------- 11. 节点库完整性 ---------- */
  const blockIds = S('BLOCKS.map(b=>b.id)');
  const nodeKeys = S('Object.keys(NODES)');
  const missing = blockIds.filter(id => !nodeKeys.includes(id));
  eq('每个街区都有节点池', missing, []);
  const badNode = S('Object.entries(NODES).flatMap(([k,v]) => v.flatMap(n => n.o.filter(o => !o.lb || typeof o.res !== "string"))).length');
  eq('所有选项都有标签和结果文本', badNode, 0);

  /* ---------- 12. 邻接表有效性 ---------- */
  const badAdj = S(`Object.entries(ADJ).flatMap(([k,v]) => v.map(x => ADJ[x] ? null : x)).filter(Boolean).length`);
  eq('邻接表指向的街区都存在', badAdj, 0);
  const noAdj = S(`BLOCKS.filter(b => !ADJ[b.id]).map(b=>b.id)`);
  eq('每个街区都在邻接表里', noAdj, []);

  /* ---------- 13. 渲染不炸 ---------- */
  let renderErr = null;
  try {
    S('state.night = null; tab = "day"; render();');
    S('tab = "city"; render();');
    S('tab = "home"; render();');
    S('tab = "notes"; render();');
    S('tab = "day"; render();');
  } catch (e) { renderErr = e; }
  ok('四个页面渲染无异常', !renderErr, renderErr && renderErr.message);
  ok('白天页渲染出打卡项', getEl('main').innerHTML.includes('早起'));

  let nightRenderErr = null;
  try {
    S('state.checks = {}; startNight("home"); render();');
  } catch (e) { nightRenderErr = e; }
  ok('入夜页渲染无异常', !nightRenderErr, nightRenderErr && nightRenderErr.message);
  ok('入夜页显示状态条', getEl('main').innerHTML.includes('灯油') || getEl('main').innerHTML.includes('油'));
}

/* ---------- 输出 ---------- */
console.log('');
if (fail === 0) console.log('全部通过：' + pass + ' 项');
else {
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
  fails.forEach(f => console.log('  ✗ ' + f));
}
process.exit(fail === 0 ? 0 : 1);
