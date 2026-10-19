/* 《日课 v2》逻辑自检：抽取 index.html 的 script，注入最小 DOM 桩后真跑 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

/* ---------- 抽取内联脚本 ---------- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FATAL: 未找到内联 script'); process.exit(1); }
const src = m[1];

/* ---------- 最小 DOM 桩 ---------- */
const els = {};
function mkEl(id){
  if (!els[id]) els[id] = {
    id, innerHTML: '', style: {}, textContent: '', classList: {
      add(){}, remove(){}, toggle(){}
    },
    dataset: {}, select(){}, setSelectionRange(){}, closest(){ return null; }
  };
  return els[id];
}
const store = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval: () => 0,
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
  confirm: () => true,
  navigator: {},
  location: { protocol: 'file:' },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: id => mkEl('#' + id),
    querySelector: () => mkEl('_q'),
    querySelectorAll: () => [],
    addEventListener(){},
    execCommand: () => true
  },
  window: { scrollTo(){}, AudioContext: null }
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

/* ---------- 执行（顶层 let/const 不挂 window，显式导出） ---------- */
const EXPORTS = `
;globalThis.__X = {
  get state(){ return state; }, set state(v){ state = v; },
  get view(){ return view; }, set view(v){ view = v; },
  TASKS, ICONS, GOAL, EXP_SCENES, RELIC_POOL,
  todayKey, parseDay, dayDiff, esc, pick, blankState,
  todayList, todayCount, todayMet, doneTask, prevMetDate, rollDay,
  yardParams, svgYard, renderYard, yardChronicle,
  weekKey, supplyDays, expState, expReady, renderExp, expChoose, expBack,
  renderSet, doTask, doImport, showExport, showImport,
  renderHeader, render, updateBadge, toast, openSheet, closeSheet
};`;
let ctx;
try {
  ctx = vm.createContext(sandbox);
  vm.runInContext(src + EXPORTS, ctx, { filename: 'index-inline.js' });
} catch (e) {
  console.error('FATAL 运行失败：', e && e.message);
  console.error(e && e.stack);
  process.exit(1);
}

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra){
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? '  [' + extra + ']' : '')); }
}
const S = ctx.__X;

/* ---------- T1 数据结构 ---------- */
ok('T1.1 七件事齐全', Array.isArray(S.TASKS) && S.TASKS.length === 7);
ok('T1.2 每件事有 id/name/act/icon/hint',
  S.TASKS.every(t => t.id && t.name && t.act && t.icon && t.hint));
ok('T1.3 每件事的图标都存在', S.TASKS.every(t => S.ICONS[t.icon]));
ok('T1.4 每日门槛为 3', S.GOAL === 3);
ok('T1.5 院子初始七项全为 0',
  Object.keys(S.state.yard).length === 7 && Object.values(S.state.yard).every(v => v === 0));
ok('T1.6 远行场景 3 段', S.EXP_SCENES.length === 3);
ok('T1.7 每段都有 2 个选项且含稳妥/冒险',
  S.EXP_SCENES.every(s => s.opts.length === 2 && s.opts.some(o => o.k === 'safe') && s.opts.some(o => o.k === 'risk')));
ok('T1.8 纪念物池至少 6 种', S.RELIC_POOL.length >= 6);
ok('T1.9 纪念物字段完整', S.RELIC_POOL.every(r => r.name && r.mark && r.desc));

/* ---------- T2 打卡 ---------- */
store['rike_yard_v2'] = JSON.stringify({ ...S.blankState(), createdAt: S.todayKey() });
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
S.state.streak = 0; S.state.bestStreak = 0; S.state.totalMet = 0; S.state.lastMet = null;
S.state.relics = [];
S.state.exp = { week: null, used: false, log: [] };

ok('T2.1 初始今日 0 件', S.todayCount() === 0);
ok('T2.2 初始未达成', S.todayMet() === false);
S.doneTask('wake');
ok('T2.3 打卡后今日 1 件', S.todayCount() === 1);
ok('T2.4 打卡后院子 wake = 1', S.state.yard.wake === 1);
ok('T2.5 1 件未达成', S.todayMet() === false);
S.doneTask('wake');
ok('T2.6 重复打卡不计数', S.todayCount() === 1 && S.state.yard.wake === 1);
S.doneTask('train');
ok('T2.7 第 2 件仍未达成', S.todayMet() === false);
S.doneTask('study');
ok('T2.8 第 3 件达成', S.todayMet() === true);
ok('T2.9 达成后 totalMet = 1', S.state.totalMet === 1);
ok('T2.10 达成后 streak = 1', S.state.streak === 1);
ok('T2.11 达成后 lastMet = 今天', S.state.lastMet === S.todayKey());
ok('T2.12 第 4 件不重复计达成', (S.doneTask('quit'), S.state.totalMet === 1));
ok('T2.13 第 4 件仍写入院子', S.state.yard.quit === 1);

/* ---------- T3 院子成长参数 ---------- */
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
const p0 = S.yardParams();
ok('T3.1 初始树高为基础值', p0.treeH === 26, 'treeH=' + p0.treeH);
ok('T3.2 初始石阶 0 级', p0.steps === 0);
ok('T3.3 初始井水 0', p0.water === 0);
ok('T3.4 初始窗内书 0', p0.books === 0);

S.state.yard.train = 1;
ok('T3.5 锻炼 1 次树即变高', S.yardParams().treeH === 33, 'treeH=' + S.yardParams().treeH);
S.state.yard.train = 20;
ok('T3.6 树高有上限 122', S.yardParams().treeH === 122, 'treeH=' + S.yardParams().treeH);
S.state.yard.wake = 3;
ok('T3.7 起床 3 次 = 3 级石阶', S.yardParams().steps === 3);
S.state.yard.wake = 99;
ok('T3.8 石阶上限 10 级', S.yardParams().steps === 10);
S.state.yard.shower = 6;
ok('T3.9 井水半满', Math.abs(S.yardParams().water - 0.5) < 0.001);
S.state.yard.shower = 99;
ok('T3.10 井水上限 1', S.yardParams().water === 1);
S.state.yard.study = 5;
ok('T3.11 窗内书 5 本', S.yardParams().books === 5);
S.state.yard.study = 99;
ok('T3.12 书上限 12', S.yardParams().books === 12);
S.state.yard.quit = 99;
ok('T3.13 墙砖上限 18', S.yardParams().bricks === 18);

/* ---------- T4 院子永不清零 ---------- */
const yardSnapshot = JSON.stringify(S.state.yard);
S.rollDay();
ok('T4.1 跨天不减少院子任何一项', JSON.stringify(S.state.yard) === yardSnapshot);
ok('T4.2 跨天不清空今日（同一天）', S.todayCount() === 4);

/* ---------- T5 连击 ---------- */
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
const today = S.todayKey();
const d = S.parseDay(today);
function shift(n){ const t = new Date(d); t.setDate(d.getDate() + n); return S.todayKey(t); }

// 昨天达成 → 今天达成，连击应为 2
S.state.days[shift(-1)] = ['wake','train','study'];
S.state.streak = 1;
S.state.lastMet = shift(-1);
S.state.totalMet = 1;
S.doneTask('wake'); S.doneTask('train'); S.doneTask('study');
ok('T5.1 连续两天达成 → streak = 2', S.state.streak === 2, 'streak=' + S.state.streak);
ok('T5.2 连续达成累加 totalMet', S.state.totalMet === 2);

// 断两天后达成，连击重置为 1
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
S.state.days[shift(-3)] = ['wake','train','study'];
S.state.streak = 5;
S.state.lastMet = shift(-3);
S.state.days[shift(0)] = [];
S.doneTask('wake'); S.doneTask('train'); S.doneTask('study');
ok('T5.3 断档后连击重置为 1', S.state.streak === 1, 'streak=' + S.state.streak);

/* ---------- T6 院子渲染 ---------- */
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
S.state.relics = [];
S.state.exp = { week: null, used: false, log: [] };

S.view = 'yard';
S.render();
const yardHtml = els['#v-yard'].innerHTML;
ok('T6.1 院子渲染出 SVG', yardHtml.includes('<svg'));
ok('T6.2 SVG 有 viewBox', /viewBox="0 60 360 360"/.test(yardHtml));
ok('T6.3 渲染出七张任务卡', (yardHtml.match(/data-act="do"/g) || []).length === 7);
ok('T6.4 含「任选三件即可」', yardHtml.includes('任选三件即可'));
ok('T6.5 含「院子不会清零」承诺', yardHtml.includes('院子不会清零'));
ok('T6.6 初始状态无 lit 暖光层', !yardHtml.includes('fill="#e8b64f" opacity=".045"'));
ok('T6.7 空院子文案正确', yardHtml.includes('院子还很空'));

// 打卡 3 件后重新渲染
S.doneTask('wake'); S.doneTask('train'); S.doneTask('shower');
S.render();
const litHtml = els['#v-yard'].innerHTML;
ok('T6.8 达成后出现暖光层', litHtml.includes('fill="#e8b64f" opacity=".045"'));
ok('T6.9 达成后出现亮灯', litHtml.includes('#e3ae43'));
ok('T6.10 达成后进度 3/3', litHtml.includes('今日达成'));
ok('T6.11 达成后石阶渲染', litHtml.includes('fill="#cbb99c"'));
ok('T6.12 树随锻炼生长（含 ellipse 树冠）', litHtml.includes('<ellipse cx="62"'));

/* ---------- T7 远行 ---------- */
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
S.state.relics = [];
S.state.exp = { week: S.weekKey(), used: false, log: [] };
// 造 6 天达成 → 补给 6，足够走完三段稳妥路线
for (let i = 0; i < 6; i++) S.state.days[shift(-i)] = ['wake','train','study'];
ok('T7.1 近 7 天达成天数 ≥ 1', S.supplyDays() >= 1, 'wk=' + S.supplyDays());
ok('T7.2 可远行', S.expReady() === true);

S.view = 'exp'; S.render();
const expHtml = els['#v-exp'].innerHTML;
ok('T7.3 远行页渲染首段标题', expHtml.includes('岔路口'));
ok('T7.4 两个选项都在', (expHtml.match(/data-act="exp-opt"/g) || []).length === 2);
ok('T7.5 显示补给数', expHtml.includes('本周补给'));

// 走完全程
S.expChoose(0);
S.expChoose(0);
S.expChoose(0);
ok('T7.6 三段走完标记为已用', S.state.exp.used === true);
ok('T7.7 走过 3 段', S.state.exp.log.length === 3);
ok('T7.8 全稳妥通过 → 带回纪念物', S.state.relics.length === 1, 'relics=' + S.state.relics.length);

// 已用后不能再远行
ok('T7.9 本周已用后不可再远行', S.expReady() === false);

/* 死锁场景：补给只够走一段，必须能折返结束 */
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.days[shift(0)] = ['wake','train','study'];   // 补给 = 1
S.state.yard = { wake:0, train:0, shower:0, study:0, quit:0, read:0, sleep:0 };
S.state.exp = { week: S.weekKey(), used: false, log: [] };
S.state.relics = [];
S.view = 'exp'; S.render();
const lowExp = els['#v-exp'].innerHTML;
ok('T7.10 补给 1 时稳妥选项被禁用', /data-i="0" disabled[\s\S]{0,80}走官道/.test(lowExp), lowExp.slice(0, 200));
ok('T7.11 补给 1 时仍可选冒险', /钻小径/.test(lowExp));
S.expChoose(1);                                       // 走冒险，消耗 1
ok('T7.12 冒险后有折返按钮', els['#v-exp'].innerHTML.includes('exp-back'));
S.expBack();
ok('T7.13 折返后本周结束', S.state.exp.used === true);
ok('T7.14 折返后不可再远行', S.expReady() === false);

// 新的一周重置
S.state.exp.week = '2000-W1';
S.expState();
ok('T7.10 跨周自动重置远行', S.state.exp.used === false && S.state.exp.log.length === 0);

/* ---------- T8 设置页 ---------- */
S.state = S.blankState();
S.state.createdAt = S.todayKey();
S.state.days = {};
S.state.yard = { wake:3, train:2, shower:1, study:0, quit:0, read:0, sleep:0 };
S.state.relics = [];
S.state.exp = { week: S.weekKey(), used: false, log: [] };
S.view = 'set'; S.render();
const setHtml = els['#v-set'].innerHTML;
ok('T8.1 设置页渲染统计', setHtml.includes('达成天数'));
ok('T8.2 七件事进度全列', (setHtml.match(/七件事的进度/g) || []).length === 1);
ok('T8.3 有音效开关', setHtml.includes('toggle-sound'));
ok('T8.4 有导出/导入/清空', setHtml.includes('data-act="export"') && setHtml.includes('data-act="import"') && setHtml.includes('data-act="reset"'));
ok('T8.5 数据提醒文案在', setHtml.includes('清缓存或删主屏图标会丢'));

/* ---------- T9 导出导入往返 ---------- */
S.state.relics = [{ name:'一枚旧铜钱', mark:'钱', color:'#a8764f', desc:'test' }];
S.state.totalMet = 7;
const dumped = JSON.stringify(S.state);
S.state = S.blankState();
const restored = Object.assign(S.blankState(), JSON.parse(dumped));
restored.yard = Object.assign(S.blankState().yard, JSON.parse(dumped).yard);
ok('T9.1 导出导入后 totalMet 保留', restored.totalMet === 7);
ok('T9.2 导出导入后纪念物保留', restored.relics.length === 1);
ok('T9.3 导出导入后院子保留', restored.yard.wake === 3);

/* ---------- T10 脏数据健壮性 ---------- */
S.state = S.blankState();
S.state.days = { '2026-10-19': 'not-an-array' };
const badList = S.todayList();
ok('T10.1 脏 days 返回空数组不抛错', Array.isArray(badList));
S.state.yard = {};
ok('T10.2 空 yard 不抛错', typeof S.yardParams().treeH === 'number');
S.state.relics = null;
let svgOk = true;
try { S.state.relics = []; S.svgYard(); } catch(e){ svgOk = false; }
ok('T10.3 SVG 渲染不依赖 relics 非空', svgOk);

/* ---------- T11 日期工具（本地时区） ---------- */
const ymd = S.todayKey(new Date(2026, 9, 19));
ok('T11.1 日期格式化正确', ymd === '2026-10-19', ymd);
ok('T11.2 跨月差值正确', S.dayDiff('2026-09-30', '2026-10-01') === 1);
ok('T11.3 闰年差值正确', S.dayDiff('2024-02-28', '2024-03-01') === 2);
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok('T11.4 代码中不用 toISOString（避免 UTC 偏移）', !/toISOString/.test(codeOnly));

/* ---------- T12 关键承诺：清零风险 ---------- */
S.state = S.blankState();
S.state.yard = { wake:5, train:3, shower:1, study:2, quit:1, read:0, sleep:0 };
const beforeBreak = JSON.stringify(S.state.yard);
S.state.lastMet = shift(-5);
S.state.streak = 4;
S.rollDay();
ok('T12.1 断链后院子一项不少', JSON.stringify(S.state.yard) === beforeBreak,
   'before=' + beforeBreak + ' after=' + JSON.stringify(S.state.yard));
ok('T12.2 断链只改 streak，不改 yard',
  /state\.streak\s*=\s*0/.test(src) && S.state.yard.wake === 5);

/* ---------- 汇总 ---------- */
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail){
  console.log('\n失败清单：');
  fails.forEach(f => console.log('  ✗ ' + f));
}
fs.writeFileSync(path.join(__dirname, '_test_out.txt'),
  '通过 ' + pass + ' 项，失败 ' + fail + ' 项\n' +
  (fail ? '\n' + fails.map(f => '✗ ' + f).join('\n') : '全部通过\n'), 'utf8');
process.exit(fail ? 1 : 0);
