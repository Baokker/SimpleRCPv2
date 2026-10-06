export type RoleTable = ReadonlyMap<string, readonly string[]>;
export function ancestors(role: string, table: RoleTable) {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (name: string) => {
    if (active.has(name)) throw new Error(`role cycle: ${name}`);
    if (visited.has(name)) return;
    active.add(name);
    for (const parent of table.get(name) ?? []) visit(parent);
    active.delete(name);
    visited.add(name);
  };
  visit(role);
  return [...visited];
}
export function inheritedRoles(roles: Iterable<string>, table: RoleTable) {
  return new Set([...roles].flatMap((role) => ancestors(role, table)));
}
export function validateRoleTable(table: RoleTable) {
  for (const [role, parents] of table) {
    if (!role.trim()) throw new Error('empty role');
    for (const parent of parents) if (!table.has(parent)) throw new Error(`missing parent: ${parent}`);
    ancestors(role, table);
  }
  return true;
}
export function descendants(role: string, table: RoleTable) {
  const result = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [candidate, parents] of table) {
      if (!result.has(candidate) && parents.some((parent) => parent === role || result.has(parent))) {
        result.add(candidate);
        changed = true;
      }
    }
  }
  return [...result];
}
export function withoutRole(table: RoleTable, removed: string) {
  return new Map([...table].filter(([role]) => role !== removed).map(([role, parents]) => [role, parents.filter((parent) => parent !== removed)]));
}
export function roleDepth(role: string, table: RoleTable): number {
  const parents = table.get(role) ?? [];
  return parents.length ? 1 + Math.max(...parents.map((parent) => roleDepth(parent, table))) : 0;
}
export function roots(table: RoleTable) {
  return [...table].filter(([, parents]) => !parents.length).map(([role]) => role);
}
export function addParent(table: RoleTable, role: string, parent: string) {
  const next = new Map(table);
  next.set(role, [...new Set([...(table.get(role) ?? []), parent])]);
  validateRoleTable(next);
  return next;
}
