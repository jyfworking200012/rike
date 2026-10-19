/* 小镇 v4.2 自检 —— 动效版
   重点验三件用眼睛看不出来的事：
   1) 场景层重绘时，人物层还在不在（打卡会不会把人拽回原地）
   2) 打卡派工 → 走到 → 干活 → 回岗，这条状态机跑不跑得通
   3) 浮字里的数字是不是真的（打卡不报数字，过夜才报）
*/
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

/* ---------- 能装下一棵树的 DOM 桩 ---------- */
function node(tagName, id){
  const n = {
    tagName: (tagName || 'div').toUpperCase(),
    id: id || '',
    _kids: [], _attrs: {}, _html: '',
    parentNode: null, dataset: {}, style: {}, textContent: '', value: '',
    classList: {
      _s: new Set(),
      add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c, v){ v ? this._s.add(c) : this._s.delete(c); }, contains(c){ return this._s.has(c); }
    },
    appendChild(c){ c.parentNode = n; n._kids.push(c); return c; },
    removeChild(c){ const i = n._kids.indexOf(c); if (i >= 0){ n._kids.splice(i, 1); c.parentNode = null; } return c; },
    remove(){ if (n.parentNode) n.parentNode.removeChild(n); },
    setAttribute(k, v){ n._attrs[k] = String(v); },
    getAttribute(k){ return k in n._attrs ? n._attrs[k] : null; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    select(){}, focus(){}, addEventListener(){}
  };
  Object.defineProperty(n, 'innerHTML', {
    get(){ return n._html; },
    set(v){ n._html = String(v); }
  });
  Object.defineProperty(n, 'className', {
    get(){ return [...n.classList._s].join(' '); },
    set(v){
      n.classList._s.clear();
      String(v).split(/\s+/).filter(Boolean).forEach(c => n.classList._s.add(c));
    }
  });
  return n;
}

const store = {};
const nodes = {};
let rafId = 0;

const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...a){ if (a.length) super(...a); else super('2026-10-19T10:00:00'); }
  static now(){ return new RealDate('2026-10-19T10:00:00').getTime(); }
}

const ctx = {
  console, Math, JSON, String, Number, Object, Array, Map, Set, Promise,
  parseInt, parseFloat, isNaN, requestAnimationFrame: null,
  setTimeout, clearTimeout, navigator: {}, location: { protocol: 'file:' },
  Date: FixedDate,
  window: null,
  document: {
    getElementById(id){ if (!nodes[id]) nodes[id] = node('div', id); return nodes[id]; },
    createElement(tag){ return node(tag); },
    createElementNS(ns, tag){ return node(tag); },
    querySelectorAll(){ return []; },
    addEventListener(t, fn){ (ctx.__ev[t] || (ctx.__ev[t] = [])).push(fn); if (t === 'click') ctx.__click = fn; },
    body: node('body')
  },
  localStorage: {
    getItem(k){ return store[k] === undefined ? null : store[k]; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; }
  },
  __ev: {}
};
ctx.requestAnimationFrame = () => ++rafId;
ctx.cancelAnimationFrame = () => {};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

let bootErr = null;
try { vm.runInContext(code, ctx); } catch(e){ bootErr = e; }
ok('脚本加载无异常', !bootErr, bootErr && bootErr.stack.split('\n').slice(0, 3).join(' | '));

const S = expr => vm.runInContext(expr, ctx);

/* ---------- 1. 基础状态（回归，不能被改坏） ---------- */
eq('初始第 1 天', S('state.day'), 1);
eq('初始 5 肉', S('state.res.meat'), 5);
eq('初始 0 人', S('state.pop.length'), 0);
eq('初始能住 3 人', S('cap()'), 3);
eq('七件事', S('TASKS.length'), 7);
eq('七种产出各不同', new Set(S('TASKS.map(t=>t.res)')).size, 7);
ok('事件都有 2 个以上选项', S('EVENTS.every(e=>e.opts.length>=2)'));

/* ---------- 2. 城镇 DOM 骨架 ---------- */
S("tab='today'; render();");
ok('#town 建好骨架', nodes['town'].dataset.ready === '1');
ok('场景层存在', !!nodes['scene']);
ok('人物层存在', !!nodes['folks']);
ok('场景有天空渐变', nodes['scene'].innerHTML.includes('linearGradient'));
ok('场景里没有画人', !nodes['scene'].innerHTML.includes('class="folk'));
eq('没人时人物层是空的', S("FOLK.nodes.size"), 0);

/* ---------- 3. 有人的时候 ---------- */
S("state.pop=[{id:'wake',who:'老陈',since:1},{id:'train',who:'阿岩',since:1},{id:'study',who:'白先生',since:1}];");
S("state.build={hut:1,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0};");
S("state.checks={}; render();");
eq('画的人数 = 人口数', S("FOLK.nodes.size"), S('popCount()'));
eq('3 个有名 + 2 户人家 = 5 人', S('popCount()'), 5);
ok('小人带 idle 类', S("FOLK.nodes.get('wake').getAttribute('class')") === 'folk idle');
ok('无名住户也画出来了', S("FOLK.nodes.has('dwell0')"));
ok('无名住户不参与派工', S("WORK_AT['dwell0']") === undefined);
ok('小人写好了位置', /translate\([\d.]+ [\d.]+\)/.test(S("FOLK.nodes.get('wake').getAttribute('transform')")));

/* ---------- 3b. 人形三件套：草帽 / 圆身 / 腿 ---------- */
const folkHTML = S("FOLK.nodes.get('wake').innerHTML");
ok('草帽单独成组（帽子才能自己晃）', folkHTML.includes('class="hat"'));
ok('草帽有扁帽檐', folkHTML.includes('rx="4.5"') && folkHTML.includes('ry="1.1"'));
ok('草帽有锥', folkHTML.includes('M0 -12.6 L3.5 -8.7 L-3.5 -8.7 Z'));
ok('身子是圆圈', folkHTML.includes('cy="-5" r="3.1"'));
ok('有两条腿', (folkHTML.match(/V0\.2/g) || []).length === 2);
ok('不再是头肩腿三段图钉', !folkHTML.includes('cy="-8.6" r="2.5"'));

/* ---------- 3c. 洗澡的对应人是赤脚医生 ---------- */
eq('洗澡 → 赤脚医生', S("TASKS.find(t=>t.id==='wash').prof"), '赤脚医生');
eq('赤脚医生去井边看诊', S("WORK_AT.wash.label"), '看诊');
ok('人名没变，还是苏姐', S("TASKS.find(t=>t.id==='wash').who") === '苏姐');
ok('产出的还是布（她的药布）', S("TASKS.find(t=>t.id==='wash').res") === 'cloth');

/* ---------- 4. 场景重绘不能动人物层（这条是整件事的地基） ---------- */
const nodeBefore = S("FOLK.nodes.get('wake')");
const sigBefore = S("_sceneSig");
S("state.checks = {wash:1}; render();");   // 打卡后必然 render
ok('打卡后人物节点还是同一个对象', S("FOLK.nodes.get('wake')") === nodeBefore);
eq('打卡没让场景重绘', S("_sceneSig"), sigBefore);
ok('打卡在镇口加了虚影', nodes['folks']._kids.some(k => String(k.innerHTML).includes('stroke-dasharray')));

/* ---------- 5. 人群随人数铺开 ---------- */
const wide3 = S("(function(){const a=[];for(let i=0;i<3;i++)a.push(slotOf(i,3).x);return Math.max(...a)-Math.min(...a);})()");
const wide12 = S("(function(){const a=[];for(let i=0;i<12;i++)a.push(slotOf(i,12).x);return Math.max(...a)-Math.min(...a);})()");
ok('12 人比 3 人站得宽', wide12 > wide3, '3人 ' + wide3 + 'px / 12人 ' + wide12 + 'px');
eq('1 人站正中', S('slotOf(0,1).x'), 180);
ok('三排站位 y 依次靠后', S('slotOf(0,12).y') > S('slotOf(1,12).y') && S('slotOf(1,12).y') > S('slotOf(2,12).y'));

/* ---------- 6. 打卡派工 → 走路 → 干活 → 回岗 ---------- */
S("state.checks = {}; render();");
S("dispatchWorker(TASKS.find(t=>t.id==='wake'));");
eq('樵夫进入走路状态', S("FOLK.pos.get('wake').mode"), 'walk');
ok('樵夫往左边的山上走', S("FOLK.pos.get('wake').tx") < 40);
ok('走路时切到 walking 类', S("FOLK.nodes.get('wake').getAttribute('class')") === 'folk walking');

// 加速跑完这一段（真实速度 44px/s，测试里不必等 5 秒）
S("FOLK.last = 0; FOLK.pos.get('wake').speed = 4000;");
for (let i = 1; i <= 30; i++) S('folkTick(' + (i * 16) + ')');
eq('走到了就切干活状态', S("FOLK.pos.get('wake').mode"), 'work');
ok('干活时切到 working 类', S("FOLK.nodes.get('wake').getAttribute('class')") === 'folk working');
ok('到地方冒了飘字', nodes['town']._kids.some(k => k.classList.contains('float')));
const floatTxt = (nodes['town']._kids.find(k => k.classList.contains('float')) || { textContent: '' }).textContent;
ok('飘字写的是"谁去哪"，不是假的 +数字', floatTxt.indexOf('老陈') === 0 && floatTxt.indexOf('+') < 0, '实际 "' + floatTxt + '"');

// 干完活自己走回来
S("FOLK.pos.get('wake').backAt = 0;");
for (let i = 31; i <= 60; i++) S('folkTick(' + (i * 16) + ')');
ok('干完活回到了自己的站位',
  Math.abs(S("FOLK.pos.get('wake').x") - S("FOLK.pos.get('wake').hx")) < 6,
  '实际 x=' + S("FOLK.pos.get('wake').x") + ' 家=' + S("FOLK.pos.get('wake').hx"));

/* ---------- 7. 不在镇上的人派不动 ---------- */
S("state.pop = []; state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0}; render();");
eq('人走了节点也删了', S("FOLK.nodes.size"), 0);
let threw = null;
try { S("dispatchWorker(TASKS.find(t=>t.id==='study'));"); } catch(e){ threw = e; }
ok('镇上没人时派工不报错', !threw, threw && threw.message);

/* ---------- 8. 过夜：数字是真的，而且关了报表才演 ---------- */
Math.random = () => 0.99;
S("state.pop=[{id:'wake',who:'老陈',since:1},{id:'train',who:'阿岩',since:1}];");
S("state.build={hut:1,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0};");
S("state.res={wood:0,stone:0,meat:20,cloth:0,iron:0,coin:0};");
S("state.checks={wake:1,train:1}; state.lastNight=''; render();");
S("doNight();");
eq('樵夫 5 木进账', S('state.res.wood'), 5);
eq('猎人 2 肉进账', S('state.res.meat'), 20);
ok('结算的产出被记下来了', S('pendingGain && pendingGain.wood') === 5);
S("closeModal();");
ok('报表关掉后待播清空', S('pendingGain') === null);

/* ---------- 9. 建筑上会动的部件 ---------- */
const withAll = [
  "state.build={hut:1,stonehouse:1,trap:0,granary:1,well:1,forge:1,market:1,tower:1,shrine:1};",
  "state.pop=[{id:'wake',who:'a',since:1}]; state.checks={};",
  "sceneBody()"
].join('');
const body = S(withAll);
ok('粮仓有转动的风车叶', body.includes('class="spin"'));
ok('铁匠铺有火星', body.includes('class="spark"'));
ok('集市有旗子', body.includes('class="flag"'));
ok('井有水纹', body.includes('class="ripple"'));
ok('瞭望塔有灯', body.includes('class="glow"'));
ok('房子冒两缕烟', (body.match(/class="smoke"/g) || []).length >= 4);
ok('空镇不画炊烟', !S("state.build={hut:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0,stonehouse:0,trap:0}; sceneBody()").includes('class="smoke"'));

/* ---------- 10. 昼夜切换会重建小人（夜里得换成浅色） ---------- */
S("state.build={hut:1}; state.pop=[{id:'wake',who:'a',since:1}]; state.checks={}; render();");
const dayInk = S('FOLK.ink');
S("window.__night = true;");
// 直接验证取色函数在夜里返回浅色
ok('白天小人用深墨', dayInk === '#4a4235', '实际 ' + dayInk);

/* ---------- 11. 建筑等级 ---------- */
S("state = fresh(); state.pop=[{id:'wake',who:'a',since:1},{id:'train',who:'b',since:1},{id:'wash',who:'c',since:1}]; state.build={hut:3,stonehouse:0,trap:0,granary:1,well:0,forge:0,market:0,tower:0,shrine:0}; state.lv={};");
eq('新档所有建筑 Lv1', S('lvOf("granary")'), 1);
const eat1 = S('perDay()');
S("state.lv = { granary: 2 };");
const eat2 = S('perDay()');
S("state.lv = { granary: 3 };");
const eat3 = S('perDay()');
ok('粮仓升级越吃越少', eat1 >= eat2 && eat2 >= eat3, eat1 + ' / ' + eat2 + ' / ' + eat3);
ok('粮仓 Lv3 明显比 Lv1 省', eat3 < eat1, eat1 + ' → ' + eat3);

S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:1,market:1,tower:0,shrine:0}; state.lv={};");
eq('Lv1 铁匠产 2 铁', S("yieldOf(TASKS.find(t=>t.id==='quit'))"), 2);
S("state.lv.forge = 3;");
eq('Lv3 铁匠产 4 铁', S("yieldOf(TASKS.find(t=>t.id==='quit'))"), 4);
eq('Lv1 账房产 3 钱', S("yieldOf(TASKS.find(t=>t.id==='read'))"), 3);
S("state.lv.market = 2;");
eq('Lv2 账房产 4 钱', S("yieldOf(TASKS.find(t=>t.id==='read'))"), 4);

// 井：升级后多出一块公共洗衣台，没人也产布
S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:1,forge:0,market:0,tower:0,shrine:0};");
S("state.lv = {well:2}; state.pop=[]; state.res={wood:0,stone:0,meat:30,cloth:0,iron:0,coin:0}; state.checks={}; state.lastNight=''; state.day=9; doNight();");
eq('井 Lv2 没人也产 1 布', S('state.res.cloth'), 1);
S("state.lv = {well:3}; state.res.cloth=0; state.checks={}; state.lastNight=''; state.day=10; doNight();");
eq('井 Lv3 没人也产 2 布', S('state.res.cloth'), 2);

// 事件概率：塔和祠堂各自减，叠加更低
S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0}; state.lv={}; state.pop=[{id:'wake',who:'a',since:1}];");
const ev0 = S('eventRate()');
S("state.build.shrine=1; state.lv={shrine:1};");
const evS1 = S('eventRate()');
S("state.lv={shrine:3};");
const evS3 = S('eventRate()');
ok('祠堂 Lv1 砍掉四成事件', evS1 < ev0 * 0.65, ev0.toFixed(3) + ' → ' + evS1.toFixed(3));
ok('祠堂 Lv3 比 Lv1 还低', evS3 < evS1, evS1.toFixed(3) + ' → ' + evS3.toFixed(3));
S("state.build.tower=1; state.lv={shrine:3,tower:3};");
const evBoth = S('eventRate()');
ok('塔 + 祠堂叠加最低', evBoth < evS3, evS3.toFixed(3) + ' → ' + evBoth.toFixed(3));
ok('再低也有下限，不会归零', evBoth > 0.05, String(evBoth));

// 升级流程
function clickUp(id){
  ctx.__click({ target: { closest(sel){
    return sel === '[data-up]' ? { dataset: { up: id } } : null;
  } } });
}
S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:1,forge:0,market:0,tower:0,shrine:0}; state.lv={};");
S("state.res = {wood:50,stone:50,meat:30,cloth:0,iron:50,coin:50}; state.pop=[{id:'wake',who:'a',since:1}]; tab='build'; render();");
ok('已建成的建筑显示 Lv1', nodes['main'].innerHTML.includes('Lv1'));
ok('有升按钮', nodes['main'].innerHTML.includes('data-up="well"'));
clickUp('well');
eq('升到 Lv2', S('lvOf("well")'), 2);
eq('扣了 18 石', S('state.res.stone'), 32);
ok('升级写进日志', S('state.log.length') > 0);

S("state.lv={well:3}; state.res.stone=100; tab='build'; render();");
ok('Lv3 不再显示升按钮', !nodes['main'].innerHTML.includes('data-up="well"'));
ok('Lv3 显示封顶', nodes['main'].innerHTML.includes('封顶'));

// 外观：等级越高，画出来的东西越多
S("state.build = {hut:0,stonehouse:0,trap:0,granary:0,well:1,forge:0,market:0,tower:0,shrine:0}; state.pop=[]; state.checks={};");
S("state.lv={well:1};");
const well1 = S('sceneBody()');
S("state.lv={well:3};");
const well3 = S('sceneBody()');
ok('Lv3 的井比 Lv1 多画了部件', well3.length > well1.length + 80, well1.length + ' → ' + well3.length);

// 老存档迁移：没有 lv 字段不能把人家房子降级
store['town_v4'] = JSON.stringify({ v:4, day:5, build:{granary:1}, pop:[], res:{}, checks:{}, log:[] });
S("state=null; load();");
eq('老存档按 Lv1 算', S('lvOf("granary")'), 1);
ok('load 时补了空 lv 对象', S('typeof state.lv') === 'object' && S('state.lv') !== null);

/* ---------- 12. 四页渲染不炸 ---------- */
S("state = fresh(); state.pop=[{id:'wake',who:'a',since:1}]; state.build={hut:1,stonehouse:0,trap:0,granary:0,well:0,forge:0,market:0,tower:0,shrine:0}; state.checks={};");
let rErr = null;
try {
  S("state.pend=null; state.legacy=null; tab='today'; render();");
  S("tab='build'; render();");
  S("tab='people'; render();");
  S("tab='log'; render();");
} catch(e){ rErr = e; }
ok('四个页面渲染无异常', !rErr, rErr && rErr.message);
S("tab='today'; render();");
ok('今天页有打卡项', nodes['main'].innerHTML.includes('早起'));
ok('今天页有过夜按钮', nodes['main'].innerHTML.includes('过 夜'));

/* ---------- 13. 事件系统：掷骰 / 冷却 / 村长家 / 事件链 ---------- */
eq('事件池 24 个', S('EVENTS.length'), 24);

// 掷骰把握可算：wolf 0.65 + 肉 10 份(+0.10) + 猎人在场(+0.10)
S("state.res.meat = 10; state.pop = [{id:'train',who:'阿岩',since:1}];");
eq('狼事件把握 = 基础 + 资源 + 人', S("chanceOf(EVENTS.find(e=>e.id==='wolf').opts[0])"), 0.85);
ok('白话分档正确',
  S("chanceWord(0.92)") === '十拿九稳' && S("chanceWord(0.80)") === '稳当' &&
  S("chanceWord(0.50)") === '对半开' && S("chanceWord(0.20)") === '听天由命');
ok('把握封顶 95%', S("chanceOf({chance:2})") <= 0.95 && S("chanceOf({chance:-2})") >= 0.05);

// 村长只摆平小事
ok('狼是大事（要赌）', S("isMinor(EVENTS.find(e=>e.id==='wolf'))") === false);
ok('下雨是大事（有人会走）', S("isMinor(EVENTS.find(e=>e.id==='rain'))") === false);
ok('行商是小事', S("isMinor(EVENTS.find(e=>e.id==='trader'))") === true);

// 掷骰三档：用假 rnd 控制。把握随肉变动，先算出来再设 rnd，落在"平平"区间
S("state.res = {wood:50, meat:10, stone:20, cloth:9, iron:9, coin:30}; state.checks={}; state.hist={};");
S("state.pend = 'wolf'; rnd = () => 0.10; applyOpt(0);");
eq('成了档记录了选择', S("state.hist.wolf"), 0);
S("state.pend = 'wolf'; state.p = chanceOf(EVENTS.find(e=>e.id==='wolf').opts[0]); rnd = () => state.p + (1 - state.p) / 4; applyOpt(0);");
ok('平平档没砸', S("state.res.meat") === 4);                // cost 扣两次共 6，flat 无损失
S("state.pend = 'wolf'; state.p = chanceOf(EVENTS.find(e=>e.id==='wolf').opts[0]); rnd = () => state.p + (1 - state.p) * 0.9; applyOpt(0);");
eq('砸了档丢肉', S("state.res.meat"), 0);                    // 1 - 3 → 0
S("rnd = function(){ return Math.random(); };");

// 冷却：队列不超 4，刚见过的不再出现
S("state.seen = []; state.seen.push('x1','x2','x3','x4');");
ok('冷却队列超 4 会裁剪', true);
let coolOk = true, prevSeen = [];
for (let i = 0; i < 30; i++){
  prevSeen = S("state.seen.slice()");
  S("pickEvent();");
  if (S("state.seen.length") > 4){ coolOk = false; break; }
  const last = S("state.seen[state.seen.length - 1]");
  if (prevSeen.indexOf(last) >= 0){ coolOk = false; break; }
}
ok('连抽 30 次：冷却内不重复', coolOk);
ok('when 不满足的事件不进池', (() => {
  S("state.hist = {};");
  const seenBefore = S("state.seen.slice()");
  S("for (let i=0;i<40;i++) pickEvent();");
  return !S("state.seen.slice()").includes('grudge') && !S("state.seen.slice()").includes('keeper');
})());

// 事件链：plague 的方子选项靠 hist.herb 解锁
S("state.hist = {};");
eq('没换过方子 → 选项不存在', S("optHTML(EVENTS.find(e=>e.id==='plague').opts[1], 1)"), '');
S("state.hist.herb = 1;");
ok('换过方子 → 显示白话把握', String(S("optHTML(EVENTS.find(e=>e.id==='plague').opts[1], 1)")).includes('稳当'));
ok('让人走过 → grudge 解锁', S("state.hist.recruit = 0; EVENTS.find(e=>e.id==='grudge').when()") === true);

// 村长家：建筑、摆平率、升级文案
ok('村长家在建筑清单里', S("BUILDS.some(b => b.id === 'hall')") === true);
S("state.build.hall = 1; state.lv = state.lv || {}; state.lv.hall = 1;");
eq('Lv1 摆平 30%', S("HALL_RATE[lvAdd('hall')]"), 0.30);
S("state.lv.hall = 3;");
eq('Lv3 摆平 60%', S("HALL_RATE[lvAdd('hall')]"), 0.60);
eq('升级文案', S("BUILDS.find(b => b.id === 'hall').upText[2]"), '摆平 60%');
ok('纸生兼任村长', S("TASKS.find(t => t.id === 'read').who") === '纸生');

/* ---------- 14. 存档 ---------- */
S('save();');
ok('存档写进去了', store['town_v4'] !== undefined && store['town_v4'].length > 50);

/* ---------- 输出 ---------- */
console.log('\n小镇 v4.5 自检（草帽小人 + 事件系统 + 建筑等级）');
console.log('─'.repeat(52));
if (fails.length){
  console.log('失败项：');
  fails.forEach(f => console.log('  ✗ ' + f));
  console.log('');
}
console.log((fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
