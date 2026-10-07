/** v2 旧库升级到 v3 的迁移实测：旧库无 marks 表，打开后应自动建表且数据无损。 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { db, listMarks } from '../src/utils/db';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  // 1) 手工构造一个 v2 结构的旧库（不含 marks 表）
  const old = new Dexie('gbpvstring');
  old.version(2).stores({
    plants: 'id, name, gridDate, latitude, capacityMWp',
    arrays: 'id, plantId, code, capacityKw',
    inverters: 'id, arrayId, model, ratedKw',
    strings: 'id, inverterId, combinerBox, code, moduleModel',
    samples: 'id, stringId, sampledAt, [stringId+sampledAt]',
    disposals: 'id, stringId, state, type, owner, dueDate',
    settings: 'id',
  });
  await old.table('plants').put({
    id: 'plant-x',
    name: '老电站',
    capacityMWp: 1,
    gridDate: '2020-01-01',
    latitude: 30,
    createdAt: '2020-01-01 00:00:00',
    revision: 2,
  });
  old.close();

  // 2) 用当前（v3）的 db 打开，应自动升级
  await db.open();
  assert(db.verno === 3, `升级后结构版本为 3（实际 ${db.verno}）`);

  // 3) 老数据无损
  const plant = await db.plants.get('plant-x');
  assert(plant?.name === '老电站', 'v2 老数据在 v3 中完好');

  // 4) marks 表可用且为空
  const marks = await listMarks();
  assert(Array.isArray(marks) && marks.length === 0, '升级后 marks 表存在且为空（无历史标记可迁移）');

  // 5) 可正常写入（验证表真正建好了，而不是静默失败）
  await db.marks.put({ stringId: 'str-x', markedAt: '2026-10-07 09:00:00' });
  assert((await listMarks()).length === 1, '升级后的 marks 表可正常读写');

  console.log('\n迁移测试通过 ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
