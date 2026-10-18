import assert from "node:assert/strict";

export function matchingReferenceRows<T extends { id: string }>(previous: T[], current: T[], label: string): Map<string, T> {
  function uniqueRows(rows: T[], source: string) {
    const index = new Map<string, T>();
    for (const row of rows) {
      assert.equal(typeof row.id, "string", `${label} ${source} ID 类型`);
      assert.ok(!index.has(row.id), `${label} ${source} 重复 ID: ${row.id}`);
      index.set(row.id, row);
    }
    return index;
  }
  const reference = uniqueRows(previous, "reference");
  const actual = uniqueRows(current, "current");
  assert.deepEqual([...actual.keys()].sort(), [...reference.keys()].sort(), `${label} ID 集合`);
  return reference;
}
