/**
 * 人工标记持久化的实测脚本（Node + fake-indexeddb）。
 * 覆盖：录入/取消/批量/清空落库、重开库后仍在、组串改挂保留、清退清掉、
 *       导入快照字段存在/缺失两种语义。
 */
import 'fake-indexeddb/auto';
import {
  db,
  initDatabase,
  listMarks,
  putMarks,
  clearAllMarks,
  deleteMark,
  putString,
  removeString,
  newStringRow,
  exportSnapshot,
  importSnapshot,
  resetDatabase,
  putInverter,
  removeInverter,
  removePlant,
} from '../src/utils/db';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function reopen(): Promise<void> {
  db.close();
  await db.open();
}

async function main(): Promise<void> {
  await initDatabase();
  const strings = await db.strings.toArray();
  const [s1, s2, s3] = strings;

  console.log('1) 标记 CRUD 落库');
  await putMarks([
    { stringId: s1.id, markedAt: '2026-10-07 09:00:00' },
    { stringId: s2.id, markedAt: '2026-10-07 09:01:00' },
  ]);
  let marks = await listMarks();
  assert(marks.length === 2, '批量录入后有 2 个标记');
  assert(marks[0].stringId === s1.id, 'listMarks 按 markedAt 升序');

  console.log('2) 取消与清空');
  await deleteMark(s1.id);
  marks = await listMarks();
  assert(marks.length === 1 && marks[0].stringId === s2.id, '取消标记后剩 1 个');
  await clearAllMarks();
  assert((await listMarks()).length === 0, '清空标记后为 0');

  console.log('3) 重开数据库后标记仍在（模拟刷新/重开浏览器）');
  await putMarks([
    { stringId: s1.id, markedAt: '2026-10-07 10:00:00' },
    { stringId: s2.id, markedAt: '2026-10-07 10:01:00' },
  ]);
  await reopen();
  marks = await listMarks();
  assert(marks.length === 2, '重开库后 2 个标记仍保留');

  console.log('4) 组串改挂（换 inverter / combinerBox / code，id 不变）标记跟随');
  await putString({ ...s2, combinerBox: 'BX-99', code: '99-99' });
  marks = await listMarks();
  assert(marks.some((m) => m.stringId === s2.id), '改挂后同 id 的标记保留');

  console.log('5) 组串被清退时标记从集合中移除');
  await removeString(s1.id);
  marks = await listMarks();
  assert(!marks.some((m) => m.stringId === s1.id), '删除组串后其标记级联清掉');
  assert(marks.some((m) => m.stringId === s2.id), '其他组串标记不受影响');

  console.log('6) 导出快照含 markedStringIds');
  const snapshot = await exportSnapshot();
  assert(Array.isArray(snapshot.markedStringIds), '快照带 markedStringIds 字段');
  assert(snapshot.markedStringIds!.includes(s2.id), '快照标记含当前星标组串');

  console.log('7) 导入：快照字段为权威来源（空数组清掉当前新标记，防止旧备份反向覆盖）');
  await putMarks([{ stringId: s3.id, markedAt: '2026-10-07 11:00:00' }]);
  const oldBackup = { ...snapshot, markedStringIds: [] };
  await importSnapshot(oldBackup);
  marks = await listMarks();
  assert(marks.length === 0, '备份显式为空数组 → 当前标记被清空');

  console.log('8) 导入：旧备份缺字段时保留当前标记，并按新组串集合清退悬空标记');
  await putMarks([
    { stringId: s2.id, markedAt: '2026-10-07 12:00:00' },
    { stringId: s3.id, markedAt: '2026-10-07 12:01:00' },
    { stringId: 'ghost-string', markedAt: '2026-10-07 12:02:00' },
  ]);
  const legacyBackup = { ...snapshot };
  delete (legacyBackup as Partial<typeof legacyBackup>).markedStringIds;
  await importSnapshot(legacyBackup);
  marks = await listMarks();
  const ids = marks.map((m) => m.stringId);
  assert(ids.includes(s2.id) && ids.includes(s3.id), '字段缺失：现存组串的当前标记保留');
  assert(!ids.includes('ghost-string'), '字段缺失：导入后不存在的组串标记被清退');

  console.log('9) 导入：快照字段存在时以快照为准（旧标记不会被沿用），且快照悬空标记被清退');
  await importSnapshot({
    ...snapshot,
    markedStringIds: [s2.id, 'ghost-in-backup'],
  });
  marks = await listMarks();
  const ids2 = marks.map((m) => m.stringId);
  assert(ids2.length === 1 && ids2[0] === s2.id, '仅保留快照中真实存在组串的标记');
  assert(!ids2.includes(s3.id), '快照未含 s3 → s3 的旧标记不保留');

  console.log('10) 逆变器 / 电站级联删除清标记');
  const arrayId = (await db.arrays.toArray())[0].id;
  const newInvId = 'inv-test-cascade';
  await putInverter({
    id: newInvId,
    arrayId,
    model: 'TEST',
    ratedKw: 100,
    mpptCount: 2,
    commissionDate: '2026-01-01',
    createdAt: '2026-01-01 00:00:00',
    revision: 2,
  });
  const row = newStringRow({
    inverterId: newInvId,
    combinerBox: 'BX-T',
    code: '01-01',
    moduleModel: 'M',
    seriesCount: 20,
  });
  await putString(row);
  await putMarks([{ stringId: row.id, markedAt: '2026-10-07 14:00:00' }]);
  await removeInverter(newInvId);
  assert(!(await listMarks()).some((m) => m.stringId === row.id), '删除逆变器级联清掉下属组串标记');

  // 电站级联：给现存组串打标后整站删除，标记应消失
  const aPlant = await db.plants.toArray();
  const victim = aPlant[aPlant.length - 1];
  const victimStrings = await db.strings.toArray();
  const victimArrays = await db.arrays.where('plantId').equals(victim.id).toArray();
  const victimInverters = victimArrays.length
    ? await db.inverters.where('arrayId').anyOf(victimArrays.map((a) => a.id)).toArray()
    : [];
  const victimStringRows = victimInverters.length
    ? victimStrings.filter((st) => victimInverters.some((inv) => inv.id === st.inverterId))
    : [];
  if (victimStringRows.length > 0) {
    await putMarks(victimStringRows.map((st) => ({ stringId: st.id, markedAt: '2026-10-07 15:00:00' })));
    const before = (await listMarks()).length;
    await removePlant(victim.id);
    const afterMarks = await listMarks();
    assert(
      afterMarks.length === before - victimStringRows.length,
      '删除电站级联清掉该电站全部组串标记',
    );
  }

  console.log('11) 重置演示库清空标记');
  await resetDatabase();
  assert((await listMarks()).length === 0, 'resetDatabase 后无标记');

  console.log('\n全部通过 ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
