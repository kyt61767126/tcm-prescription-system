// ============================================================================
// test-stock-core.cjs —— 药品库存核心引擎单测（Node VM 沙箱，2026-09-11）
//
// 覆盖场景：
//   ① 未启用时零行为变化（老用户升级安全）
//   ② 保存处方自动扣库存（用量×剂数）+ 流水记 'rx'
//   ③ 同日覆盖/改历史：差值冲正（多退少补）+ 流水记 'rx-adj'
//   ④ 处方删除药味：全额退回
//   ⑤ 回收站恢复：幂等 no-op（不重复扣减）
//   ⑥ 彻底删除：冲回 + 流水记 'rx-revert'；未启用不冲回
//   ⑦ 入库记账 + 负数退货出库
//   ⑧ 盘点调整记账
//   ⑨ 阈值预警（低库存判定 + 保存后预警清单 + toast）
//   ⑩ planDeduction 纯函数（同名聚合/微增量跳过/删味退回）
//   ⑪ 幂等标记随处方持久化（__stockApplied.items = 实际用量）
//   ⑫ 备份导出字段与恢复（stockLedger/stockMgmtEnabled）
//
// 用法：node tests/test-stock-core.cjs   （exit 0 = 全过）
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STOCK_CORE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'stock-core.js'), 'utf8');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  [PASS] ' + name); }
  else { failed++; console.log('  [FAIL] ' + name); }
}
function approx(a, b) { return Math.abs(a - b) < 0.005; }

// ---------------------------------------------------------------------------
//  沙箱环境：mock localStorage/document/顶层 medicines 数组 + 全局钩子函数
// ---------------------------------------------------------------------------
function createHarness(initialMeds) {
  const storage = {};
  if (initialMeds) storage['local_medicines'] = JSON.stringify(initialMeds);
  const h = {
    toasts: [],
    recycleBin: [],
    savedRecords: [],
    diskSaved: 0
  };
  const noop = function () {};
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    Date, JSON, Math, isNaN, parseFloat, parseInt, String, Array, Object, Number, RegExp, Error,
    Promise, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: () => 0, clearTimeout: noop,
    setInterval: (fn) => { try { fn(); } catch (e) {} return 0; }, // 立即执行一次（boot 安装钩子）
    clearInterval: noop,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    },
    document: {
      readyState: 'complete',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, appendChild: noop, addEventListener: noop, querySelector: () => null }),
      addEventListener: noop,
      body: { appendChild: noop }
    },
    showToast: (msg) => h.toasts.push(msg),
    currentUser: { name: '测试医师', username: 'tester' }
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;

  // 顶层 medicines 数组（等价各端 inline script 的顶层 let medicines）
  sandbox.medicines = initialMeds ? JSON.parse(JSON.stringify(initialMeds)) : [];

  // 全局钩子 mock（签名对齐各端 index.html 真实函数）
  sandbox.savePrescriptionToDB = async function (record) {
    h.savedRecords.push(JSON.parse(JSON.stringify(record))); // 模拟 IndexedDB put 持久化
  };
  sandbox.deletePrescriptionFromDB = noop;
  sandbox.saveMedicineEdit = noop;
  sandbox.showMedicineEditModal = noop;
  sandbox.getMedicineByName = (name) => sandbox.medicines.find(m => m.name === name) || null;
  sandbox.getRecycleBin = () => h.recycleBin;
  sandbox.deleteFromRecycleBin = (id) => { h.recycleBin = h.recycleBin.filter(r => r.id !== id); };
  sandbox.clearRecycleBin = () => { h.recycleBin = []; };
  sandbox.renderMedicineList = noop;
  sandbox.importDataFromJson = async function () {};
  sandbox.saveMedicinesToDisk = () => { h.diskSaved++; };

  // 载入 stock-core（IIFE 立即执行，boot→tryInstall 同步完成）
  vm.runInContext(STOCK_CORE, sandbox, { filename: 'stock-core.js' });
  h.sandbox = sandbox;
  h.storage = storage;
  h.getMed = (name) => sandbox.medicines.find(m => m.name === name);
  h.getStock = (name) => parseFloat(h.getMed(name).stock);
  h.ledgerOf = (name) => sandbox.StockCore.getLedger().filter(e => e.name === name);
  h.rx = (id, items, doseCount, extra) => Object.assign({
    id: id, prescriptionNo: 'RX' + id, patientName: '测试患者',
    items: items, doseCount: doseCount
  }, extra || {});
  return h;
}

const MEDS = () => [
  { name: '麻黄', code: 'mh', unit: 'g', price: 0.1, dosage: 10, stock: 1000, stockThreshold: 100 },
  { name: '桂枝', code: 'gz', unit: 'g', price: 0.1, dosage: 10, stock: 60, stockThreshold: 50 },
  { name: '甘草', code: 'gc', unit: 'g', price: 0.1, dosage: 6, stock: 200, stockThreshold: 0 }
];

// ---------------------------------------------------------------------------
console.log('== ① 未启用：零行为变化 ==');
{
  const h = createHarness(MEDS());
  assert(h.sandbox.StockCore.isEnabled() === false, '默认未启用');
  (async () => {
    await h.sandbox.savePrescriptionToDB(h.rx(1, [{ name: '麻黄', dosage: 10 }], 7));
    assert(h.getStock('麻黄') === 1000, '未启用保存处方不动库存');
    assert(h.sandbox.StockCore.getLedger().length === 0, '未启用不记流水');
    h.recycleBin = [h.rx(9, [{ name: '麻黄', dosage: 10 }], 7, { __stockApplied: { v: 1, items: { 麻黄: 70 } } })];
    h.sandbox.deleteFromRecycleBin(9);
    assert(h.getStock('麻黄') === 1000, '未启用彻底删除不冲回');
  })();
}

console.log('== ② 保存处方自动扣库存 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  (async () => {
    await h.sandbox.savePrescriptionToDB(h.rx(1, [{ name: '麻黄', dosage: 10 }, { name: '甘草', dosage: 6 }], 7));
    assert(approx(h.getStock('麻黄'), 930), '麻黄 1000-10×7=930');
    assert(approx(h.getStock('甘草'), 158), '甘草 200-6×7=158');
    const led = h.ledgerOf('麻黄');
    assert(led.length === 1 && led[0].type === 'rx' && approx(led[0].qty, 70), "流水记 'rx' qty=70");
    assert(led[0].stock === 930 && led[0].op === '测试医师' && led[0].note === '处方 RX1', '流水含结存/经办/处方号');
  })();
}

console.log('== ③ 同日覆盖差值冲正（多退少补） ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  (async () => {
    const rec = h.rx(1, [{ name: '麻黄', dosage: 10 }], 7);
    await h.sandbox.savePrescriptionToDB(rec);   // 首存扣 70
    rec.doseCount = 3;                            // 改 3 剂 → 只需 30
    await h.sandbox.savePrescriptionToDB(rec);   // 退 40
    assert(approx(h.getStock('麻黄'), 970), '1000-70+40=970');
    const types = h.ledgerOf('麻黄').map(e => e.type);
    assert(types.join(',') === 'rx-adj,rx', "第二次流水记 'rx-adj'");
    rec.items.push({ name: '桂枝', dosage: 10 }); // 加一味
    await h.sandbox.savePrescriptionToDB(rec);   // 桂枝新扣 30
    assert(approx(h.getStock('桂枝'), 30), '桂枝 60-10×3=30');
  })();
}

console.log('== ④ 处方删除药味全额退回 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  (async () => {
    const rec = h.rx(1, [{ name: '麻黄', dosage: 10 }, { name: '甘草', dosage: 6 }], 5);
    await h.sandbox.savePrescriptionToDB(rec);   // 麻黄-50 甘草-30
    rec.items = rec.items.filter(i => i.name !== '麻黄'); // 删麻黄
    await h.sandbox.savePrescriptionToDB(rec);   // 麻黄退 50
    assert(approx(h.getStock('麻黄'), 1000), '麻黄全额退回 1000');
    assert(approx(h.getStock('甘草'), 170), '甘草保持 200-30=170');
  })();
}

console.log('== ⑤ 回收站恢复幂等 no-op ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  (async () => {
    const rec = h.rx(1, [{ name: '麻黄', dosage: 10 }], 7);
    await h.sandbox.savePrescriptionToDB(rec);   // 扣 70 → 930
    // 模拟：删进回收站（软删不冲库存）→ 从回收站恢复（restoreFromRecycleBin 再次 savePrescriptionToDB）
    await h.sandbox.savePrescriptionToDB(rec);
    assert(approx(h.getStock('麻黄'), 930), '恢复不重复扣减（标记幂等）');
    assert(h.ledgerOf('麻黄').length === 1, '无新增流水');
  })();
}

console.log('== ⑥ 彻底删除冲回 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  const rec = h.rx(9, [{ name: '麻黄', dosage: 10 }], 7);
  rec.__stockApplied = { v: 1, at: '2026-09-11T00:00:00Z', items: { 麻黄: 70 } };
  h.recycleBin = [rec];
  h.sandbox.deleteFromRecycleBin(9);              // confirm 在真实端；mock 直接删
  assert(approx(h.getStock('麻黄'), 1070), '冲回 +70 → 1070');
  const led = h.ledgerOf('麻黄');
  assert(led.length === 1 && led[0].type === 'rx-revert', "流水记 'rx-revert'");
}

console.log('== ⑦ 入库 / 负数退货 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  assert(h.sandbox.StockCore._stockIn('麻黄', 500, '进货 5 公斤') === true, '入库成功返回 true');
  assert(approx(h.getStock('麻黄'), 1500), '1000+500=1500');
  const led = h.ledgerOf('麻黄');
  assert(led[0].type === 'in' && approx(led[0].qty, 500) && led[0].note === '进货 5 公斤', "流水记 'in' 含备注");
  h.sandbox.StockCore._stockIn('麻黄', -200, '退货');
  assert(approx(h.getStock('麻黄'), 1300), '负数出库 1500-200=1300');
  assert(h.sandbox.StockCore._stockIn('不存在药', 10) === false, '无此药返回 false');
}

console.log('== ⑧ 盘点调整记账 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  assert(h.sandbox.StockCore._recordManualAdjust('麻黄', 1000, 990, '盘点') === true, '盘点 1000→990 记账');
  const led = h.ledgerOf('麻黄');
  assert(led[0].type === 'adj' && approx(led[0].qty, -10), "流水记 'adj' qty=-10");
  assert(h.sandbox.StockCore._recordManualAdjust('麻黄', 990, 990) === false, '无变化不记账');
}

console.log('== ⑨ 阈值预警 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  const 麻黄 = h.getMed('麻黄'), 桂枝 = h.getMed('桂枝'), 甘草 = h.getMed('甘草');
  assert(h.sandbox.StockCore._isLowStock(桂枝) === false, '桂枝 60>50 不算低库存');
  桂枝.stock = 50;
  assert(h.sandbox.StockCore._isLowStock(桂枝) === true, '50≤50 阈值内算低');
  assert(h.sandbox.StockCore._isLowStock(麻黄) === false, '麻黄 1000 充足');
  assert(h.sandbox.StockCore._isLowStock(甘草) === false, '甘草阈值 0 不预警');
  h.sandbox.StockCore.updateStockBadges();
  assert(h.sandbox.StockCore.lowStockList().length === 1 && h.sandbox.StockCore.lowStockList()[0].name === '桂枝', '低库存清单=桂枝');
  // 保存后预警：麻黄阈值 100，扣到 ≤100 触发
  (async () => {
    await h.sandbox.savePrescriptionToDB(h.rx(2, [{ name: '麻黄', dosage: 100 }], 9)); // -900 → 100
    assert(h.toasts.some(t => t.indexOf('库存预警') >= 0 && t.indexOf('麻黄') >= 0), '保存后 toast 预警麻黄');
    const led = h.ledgerOf('麻黄');
    assert(led[0].type === 'rx', '扣减流水正常');
  })();
}

console.log('== ⑩ planDeduction 纯函数 ==');
{
  const h = createHarness(MEDS());
  const S = h.sandbox.StockCore;
  const p1 = S._planDeduction({ items: [{ name: '麻黄', dosage: 10 }, { name: '麻黄', dosage: 5 }], doseCount: 4 });
  assert(p1.deltas.length === 1 && approx(p1.deltas[0].delta, 60), '同名药味聚合 15×4=60');
  assert(p1.marker.items['麻黄'] === 60, '标记 items=聚合后用量');
  const p2 = S._planDeduction({ items: [{ name: '麻黄', dosage: 10 }], doseCount: 7, __stockApplied: { v: 1, items: { 麻黄: 70, 甘草: 30 } } });
  assert(p2.hasChanges === true, '删味(甘草)+无变化(麻黄) → 有变更');
  assert(p2.deltas.length === 1 && approx(p2.deltas[0].delta, -30), '甘草全额退回 -30');
  const p3 = S._planDeduction({ items: [{ name: '麻黄', dosage: 10 }], doseCount: 7, __stockApplied: { v: 1, items: { 麻黄: 70 } } });
  assert(p3.hasChanges === false, '完全一致 → 无变更（恢复 no-op 基础）');
  const p4 = S._planDeduction({ items: [], doseCount: 7 });
  assert(p4.hasChanges === false, '空处方无变更');
}

console.log('== ⑪ 幂等标记随处方持久化 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  (async () => {
    await h.sandbox.savePrescriptionToDB(h.rx(1, [{ name: '麻黄', dosage: 10 }], 7));
    const persisted = h.savedRecords[h.savedRecords.length - 1];
    assert(persisted.__stockApplied && persisted.__stockApplied.v === 1, '落库记录携带 __stockApplied');
    assert(approx(persisted.__stockApplied.items['麻黄'], 70), '标记用量 70');
  })();
}

console.log('== ⑫ 备份字段导出与恢复 ==');
{
  const h = createHarness(MEDS());
  h.sandbox.StockCore.setEnabled(true);
  h.sandbox.StockCore._stockIn('麻黄', 500, '进货');
  (async () => {
    const backupJson = JSON.stringify({
      medicines: MEDS(),
      prescriptionHistory: [],
      stockLedger: h.sandbox.StockCore.getLedger(),
      stockMgmtEnabled: true
    });
    h.storage['stock_ledger_v1'] = '[]';
    h.sandbox.StockCore.setEnabled(false);
    await h.sandbox.importDataFromJson(backupJson);
    assert(h.sandbox.StockCore.getLedger().length === 1, '流水随备份恢复');
    assert(h.sandbox.StockCore.isEnabled() === true, '开关状态随备份恢复');
  })();
}

console.log('== ⑬ 库存红字/徽标渲染辅助 ==');
{
  const h = createHarness(MEDS());
  const S = h.sandbox.StockCore;
  const 桂枝 = h.getMed('桂枝');
  assert(S.stockText(桂枝) === '60', '未启用时输出纯文本（零行为变化）');
  S.setEnabled(true);
  桂枝.stock = 30; // 阈值 50 → 低
  const html = S.stockText(桂枝);
  assert(html.indexOf('#e53935') >= 0 && html.indexOf('30') >= 0 && html.indexOf('⚠') >= 0, '启用后低库存红字+⚠');
  assert(S.stockText({ stock: 5 }) === '5', '无阈值不红字');
  const badge = S.dropBadge(桂枝);
  assert(badge.indexOf('[库存:30]') >= 0 && badge.indexOf('#e53935') >= 0, '拾药下拉红徽标');
  const 麻黄 = h.getMed('麻黄');
  assert(S.dropBadge(麻黄).indexOf('#909399') >= 0, '充足库存灰徽标');
  assert(S.dropBadge({ stock: 0, dosage: 10 }) === '', '0 库存不显示徽标（噪音控制）');
}

console.log('== ⑭ 批量入库导入：解析纯函数 ==');
{
  const h = createHarness(MEDS());
  const S = h.sandbox.StockCore;
  const r1 = S._parseCsvRow('"麻,黄",500,"备注""A"""');
  assert(r1[0] === '麻,黄' && r1[1] === '500' && r1[2] === '备注"A"', 'CSV 行解析：引号包裹/内嵌逗号/双引号转义');
  const p1 = S._parseStockImportText('药品,数量,备注\n麻黄,500,进货5公斤\n\n桂枝,60\n\n甘草,abc\n杏仁,-30');
  assert(p1.rows.length === 3, '表头跳过+空行忽略 → 3 有效行');
  assert(p1.rows[0].name === '麻黄' && p1.rows[0].qty === 500 && p1.rows[0].note === '进货5公斤', '行1 药名/数量/备注');
  assert(p1.rows[1].name === '桂枝' && p1.rows[1].note === '', '行2 备注省略');
  assert(p1.rows[2].qty === -30, '负数=退货出库可导入');
  assert(p1.bad.length === 1 && p1.bad[0] === '第6行', '数量非法行记 bad 行号（甘草,abc 为第 6 行）');
  const p2 = S._parseStockImportText('麻黄,100');
  assert(p2.rows.length === 1 && p2.rows[0].name === '麻黄', '无表头首行即数据');
  const p3 = S._rowsFromColArrays([['名称', '数量'], ['麻黄', 500]]);
  assert(p3.rows.length === 1 && p3.rows[0].qty === 500, 'Excel 二维数组路径：「名称」表头也识别');
}

console.log('== ⑮ 批量入库导入：执行 + 编码解码 + 文件分流 ==');
{
  const h = createHarness(MEDS());
  const S = h.sandbox.StockCore;
  S.setEnabled(true);
  const res = S._importStockBatch([
    { name: '麻黄', qty: 500, note: '进货' },
    { name: '杏仁', qty: 100, note: '' },
    { name: '桂枝', qty: -10, note: '' }
  ]);
  assert(res.ok === 2 && res.skipped.length === 1 && res.skipped[0] === '杏仁', '在库 2 笔成功，无此药跳过汇总');
  assert(approx(h.getStock('麻黄'), 1500) && approx(h.getStock('桂枝'), 50), '库存正确加/减');
  assert(h.ledgerOf('麻黄')[0].type === 'in' && h.ledgerOf('麻黄')[0].note === '进货', "流水记 'in' 含备注");
  assert(h.ledgerOf('桂枝')[0].note === '批量导入', '无备注默认「批量导入」');
  assert(S._decodeAuto(new Uint8Array(Buffer.from('麻黄,500', 'utf8'))) === '麻黄,500', 'UTF-8 无 BOM 正确解码');
  const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('麻黄,500', 'utf8')]);
  assert(S._decodeAuto(new Uint8Array(bom)) === '麻黄,500', 'BOM 剥除后正确解码');
  let gbkOk = false;
  try { new TextDecoder('gbk'); gbkOk = true; } catch (e) {}
  if (gbkOk) {
    assert(S._decodeAuto(new Uint8Array([0xD6, 0xD0])) === '中', 'GBK 字节（D6D0=中）自动走 GBK 解码');
  } else {
    console.log('  [SKIP] 当前 Node 无 GBK 解码支持，跳过 GBK 断言');
  }
  const p = S._rowsFromArrayBuffer(Buffer.from('药品,数量,备注\n麻黄,500\n杏仁,60', 'utf8'), 'stock.csv');
  assert(p.rows.length === 2 && p.rows[0].name === '麻黄', 'rowsFromArrayBuffer CSV 分支（Buffer 入参）');
  let threw = false;
  try { S._rowsFromArrayBuffer(new ArrayBuffer(8), 'x.xlsx'); } catch (e) { threw = e.message === 'EXCEL_LIB_MISSING'; }
  assert(threw, 'xlsx 扩展名但无 XLSX 库 → 抛 EXCEL_LIB_MISSING');
}

// 等异步断言全部落地后汇总（savePrescriptionToDB 为 async）
setTimeout(() => {
  console.log('');
  console.log('══════════════════════════════════');
  console.log('  结果: ' + passed + ' 通过, ' + failed + ' 失败');
  console.log('══════════════════════════════════');
  process.exit(failed === 0 ? 0 : 1);
}, 50);
