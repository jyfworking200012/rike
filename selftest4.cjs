/* 小镇 v4 自检 —— 在 node vm 里跑真实逻辑，不靠"看着没问题" */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = scripts[scripts.length - 1][1];

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra){
  if (cond){ pass++; }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b){ ok(name, a === b, '实际 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b)); }

/* ---------- DOM 桩 ---------- */
function el(){
  return {
    innerHTML: '', textContent: '', value: '',
    dataset: {}, style: {},
    classList: { _s: new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
      toggle(c, v){ v ? this._s.add(c) : this._s.delete(c) }, contains(c){ return this._s.has(c) } },
    appendChild(){}, removeChild(){}, select(){}, focus(){}
  };
}
const store = {};
const nodes = {};
const ctx = {
  console, Math, Date, JSON, String, Number, Object, Array, parseInt, parseFloat, isNaN,
  setTimeout, clearTimeout, navigator: {}, location: { protocol: 'file:' },
  window: null,
  document: {
    getElementById(id){ if (!nodes[id]) nodes[id] = el(); return nodes[id]; },
    querySelectorAll(){ return []; },
    addEventListener(t, fn){ ctx.__click = fn; },
    createElement(){ return el(); },
    body: el()
  },
  localStorage: {
    getItem(k){ return store[k] === undefined ? null : store[k]; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; }
  }
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

let bootErr = null;
try { vm.runInContext(code, ctx); } catch(e){ bootErr = e; }
ok('脚本加载无异常', !bootErr, bootErr && bootErr.stack.split('\n').slice(0,3).join(' | '));

const S = expr => vm.runInContext(expr, ctx);

/* ---------- 1. 初始状态 ---------- */
eq('初始第 1 天', S('state.day'), 1);
eq('初始 5 肉', S('state.res.meat'), 5);
eq('初始 0 人', S('state.pop.length'), 0);
eq('初始能住 3 人', S('cap()'), 3);
eq('初始等级：空地', S('rank().t'), '空地');
eq('初始可住', S('room()'), true);

/* ---------- 2. 数据完整性 ---------- */
eq('七件事', S('TASKS.length'), 7);
eq('七种产出各不同', new Set(S('TASKS.map(t=>t.res)')).size, 7);
ok('铁匠需铁匠铺', S("TASKS.find(t=>t.id==='quit').need === 'forge'"));
ok('账房需集市', S("TASKS.find(t=>t.id==='read').need === 'market'"));
ok('建筑都有成本', S('BUILDS.every(b=>Object.keys(b.cost).length>0)'));
ok('事件都有 2 个以上选项', S('EVENTS.every(e=>e.opts.length>=2)'));
ok('事件三个档位都有', S('new Set(EVENTS.map(e=>e.tier)).size') === 3);
ok('所有选项都写了结果文案', S('EVENTS.every(e=>e.opts.every(o=>o.res && o.res.length>4))'));

/* ---------- 3. 打卡 ---------- */
function clickTask(id){
  ctx.__click({ target: { closest(sel){
    return sel === '[data-task]' ? { dataset: { task: id } } : null;
  } } });
}
S("state.checks = {};");
clickTask('wake');
eq('点一下打卡成功', S('Object.keys(state.checks).length'), 1);
eq('点的是早起', S('state.checks.wake'), 1);
clickTask('wake');
eq('再点一下取消', S('Object.keys(state.checks).length'), 0);
clickTask('quit');
eq('缺铁匠铺时点不动铁匠', S('Object.keys(state.checks).length'), 0);

/* ---------- 4. 过夜：招人 + 产出 ---------- */
Math.random = () => 0.99;   // 关掉随机事件，让结算可精确断言
S("state.checks = { wake:1, train:1, study:1 };");
S("doNight();");
eq('容量 3，三个人全留下', S('state.pop.length'), 3);
eq('第一个是樵夫', S("state.pop[0].id"), 'wake');
eq('樵夫砍 5 木', S('state.res.wood'), 5);
eq('过完到第 2 天', S('state.day'), 2);
eq('5 肉 + 猎人 2 − 三人吃 2 = 5', S('state.res.meat'), 5);
eq('三人就是小村', S('rank().t'), '小村');
ok('过夜后打卡清空', S('state.checks.wake') === undefined);

/* ---------- 5. 容量公式 ---------- */
S("state.build.hut = 1;");
eq('一间木棚容量 6', S('cap()'), 6);
S("state.build.stonehouse = 1;");
eq('加石屋容量 11', S('cap()'), 11);
S("state.build.hut = 0; state.build.stonehouse = 0;");

/* ---------- 6. 食物消耗 ---------- */
S("state.pop = []; state.res.meat = 20; state.build = {hut:1,stonehouse:0,trap:0,granary:0,well:0,forge:1,market:1,tower:0,shrine:0};");
for (const id of ['wake','train','wash','study','quit','read']) S("state.pop.push({id:'" + id + "', who:'x', since:1})");
eq('6 人刚好住满木棚', S('popCount()'), 6);
eq('6 人每天吃 3 肉', S('perDay()'), 3);
S("state.build.granary = 1;");
eq('有粮仓后消耗降到 2', S('perDay()'), 2);

/* ---------- 7. 产出计算 ---------- */
eq('樵夫 5 木', S("yieldOf(TASKS.find(t=>t.id==='wake'))"), 5);
eq('无陷阱猎人 2 肉', S("yieldOf(TASKS.find(t=>t.id==='train'))"), 2);
S("state.build.trap = 2;");
eq('两级陷阱猎人 4 肉', S("yieldOf(TASKS.find(t=>t.id==='train'))"), 4);

/* ---------- 8. 结算真的加资源 ---------- */
S("state.pop = [{id:'study',who:'白先生',since:1}];");
S("state.res = {wood:0,stone:0,meat:30,cloth:0,iron:0,coin:0};");
S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0};");
S("state.checks = {}; state.lastNight=''; state.day = 5; doNight();");
eq('只留石匠：石 +3', S('state.res.stone'), 3);
eq('只留石匠：肉 30 − 1 = 29', S('state.res.meat'), 29);
eq('石匠不产木', S('state.res.wood'), 0);

/* ---------- 9. 建造扣费 ---------- */
S("state.res = {wood:12,stone:100,meat:50,cloth:20,iron:20,coin:50};");
S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0};");
ok('买得起木棚', S("afford({wood:10})") === true);
S("pay({wood:10})");
eq('付完剩 2 木', S('state.res.wood'), 2);
ok('买不起石屋', S("afford({wood:20,stone:15})") === false);

/* ---------- 10. 事件 ---------- */
S("state.pend = 'beast'; state.pop = [{id:'train',who:'阿岩',since:1}]; state.res.meat = 10;");
const optHtml = S("optHTML(EVENTS.find(e=>e.id==='beast').opts[0], 0)");
ok('有猎人的选项可点', !optHtml.includes('disabled'));
ok('选项显示代价', optHtml.includes('肉 1'));
S("state.pop = [];");
ok('没猎人时该选项禁用', S("optHTML(EVENTS.find(e=>e.id==='beast').opts[0], 0)").includes('disabled'));

S("state.pop = [{id:'train',who:'阿岩',since:1}]; state.res.meat = 10; state.pend='beast';");
S("applyOpt(0);");
eq('选完事件消耗 1 肉', S('state.res.meat'), 9);
ok('事件处理完清空 pend', S('state.pend') === null);
ok('事件写进日志', S('state.log.length') > 0);

/* ---------- 11. 坏结果不把资源打成负数 ---------- */
S("state.res.meat = 1; state.pend='beast'; state.pop=[{id:'train',who:'阿岩',since:1}];");
S("applyOpt(2);");
ok('肉不会被扣成负数', S('state.res.meat') >= 0, '实际 ' + S('state.res.meat'));

/* ---------- 12. 存档 ---------- */
S("save();");
ok('存档写进 localStorage', store['town_v4'] !== undefined && store['town_v4'].length > 50);
S("state = JSON.parse(localStorage.getItem('town_v4'));");
ok('读回来是 v4', S('state.v') === 4);

/* ---------- 13. 四页渲染 ---------- */
let rErr = null;
try {
  S("state.pend = null; state.legacy = null; tab='today'; render();");
  S("tab='build'; render();");
  S("tab='people'; render();");
  S("tab='log'; render();");
} catch(e){ rErr = e; }
ok('四个页面渲染无异常', !rErr, rErr && rErr.message);
S("tab='today'; render();");
ok('今天页出现打卡项', nodes['main'].innerHTML.includes('早起'));
ok('今天页出现过夜按钮', nodes['main'].innerHTML.includes('过 夜'));
ok('今天页出现等级条', nodes['main'].innerHTML.includes('再招'));
S("tab='build'; render();");
ok('建镇页列出木棚', nodes['main'].innerHTML.includes('木棚'));
S("state.pop=[{id:'wake',who:'老陈',since:1}]; tab='people'; render();");
ok('人页列出职业', nodes['main'].innerHTML.includes('樵夫'));
S("tab='log'; render();");
ok('记录页显示日志', nodes['main'].innerHTML.includes('第'));

/* ---------- 14. 小镇画面 ---------- */
S("state.pop=[{id:'wake',who:'老陈',since:1},{id:'train',who:'阿岩',since:1}]; state.build={hut:1,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0}; state.checks={};");
const svg = S("townSVG()");
ok('小镇有 svg', svg.includes('<svg'));
ok('画了房子', svg.includes('smoke') || svg.includes('<path d="M'));
ok('镇上有人时画了人', svg.includes('class="walk"'));
eq('木棚 1 间：2 个有名 + 2 户人家 = 4 人', S('popCount()'), 4);
ok('显示人口/容量', svg.includes('4 / 6 人'));
ok('显示镇子等级', svg.includes('小村'));
S("state.checks = {wash:1};");
ok('打卡后镇口出现半透明的人', S("townSVG()").includes('stroke-dasharray'));
S("state.checks = {}; state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0};");
ok('空镇不画炊烟', !S("townSVG()").includes('class="smoke"'));

/* ---------- 15. 住不下 ---------- */
S("state.pop = [{id:'wake',who:'a',since:1},{id:'train',who:'b',since:1},{id:'wash',who:'c',since:1}];");
S("tab='today'; render();");
ok('住满时提示住不下', nodes['main'].innerHTML.includes('住不下'));

/* ---------- 16. 等级门槛 ---------- */
eq('六级镇子', S('STEPS.length'), 6);
ok('等级门槛递增', S('STEPS.every((s,i)=>i===0||s[0]>STEPS[i-1][0])'));
S("state.pop=[{id:'wake',who:'x',since:1}]; state.build={hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0};");
eq('1 人荒村', S('rank().t'), '荒村');
S("state.build.hut=3; state.build.stonehouse=2;");
eq('住满 22 人上限', S('cap()'), 22);
ok('等级条写出下一级', S('rankBar()').includes('再招'));

/* ---------- 17. 旧档迁移 ---------- */
store['rike_yard_v2'] = JSON.stringify({ days: { a:1,b:1,c:1 }, checks: {x:1}, points: 28 });
S("state = null; localStorage.removeItem('town_v4'); load();");
ok('旧档变成前人记录', S('state.legacy') && S('state.legacy').length > 0, String(S('state.legacy')));
eq('新档从第 1 天开始', S('state.day'), 1);

/* ---------- 输出 ---------- */
console.log('\n小镇 v4 自检');
console.log('─'.repeat(46));
if (fails.length){
  console.log('失败项：');
  fails.forEach(f => console.log('  ✗ ' + f));
  console.log('');
}
console.log((fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
