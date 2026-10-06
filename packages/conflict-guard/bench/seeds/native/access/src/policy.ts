import { inheritedRoles } from './roles.ts';
import type { RoleTable } from './roles.ts';
import * as risk from './risk.ts';
export interface Subject {
  id: string;
  roles: string[];
  tenant: string;
  attempts: number;
}
export interface Rule {
  id: string;
  role: string;
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
  priority: number;
  tenant?: string;
}
export function decide(subject: Subject, action: string, resource: string, table: RoleTable, rules: Rule[]) {
  const roles = inheritedRoles(subject.roles, table);
  const matching = rules.filter((rule) => roles.has(rule.role) && rule.action === action && rule.resource === resource && (!rule.tenant || rule.tenant === subject.tenant));
  matching.sort((a, b) => b.priority - a.priority || Number(b.effect === 'deny') - Number(a.effect === 'deny') || a.id.localeCompare(b.id));
  const selected = matching[0];
  return { allowed: selected?.effect === 'allow', rule: selected?.id, evaluated: matching.map((rule) => rule.id), risk: risk.assessment(subject.attempts, 0.1, 'internal').score };
}
export function reviewPriority(attempts: number): number {
  const score = risk.calculateRisk(attempts, 0.1, 'public');
  return score / risk.riskUnit;
}
export function accessMargin(attempts: number): number {
  return risk.assessment(attempts, 0.1, 'public').clearance;
}
export function explain(subject: Subject, action: string, resource: string, table: RoleTable, rules: Rule[]) {
  const result = decide(subject, action, resource, table, rules);
  const phrase = result.allowed ? 'granted' : 'denied';
  return `${subject.id}: ${action} on ${resource} ${phrase}; rule=${result.rule ?? 'default'}`;
}
export function permissionSet(subject: Subject, table: RoleTable, rules: Rule[]) {
  const requested = new Map(rules.map((rule) => [`${rule.action}:${rule.resource}`, rule]));
  const permissions: string[] = [];
  for (const [key, rule] of requested) {
    if (decide(subject, rule.action, rule.resource, table, rules).allowed) permissions.push(key);
  }
  return permissions.sort();
}
export function filterResources(subject: Subject, action: string, resources: string[], table: RoleTable, rules: Rule[]) {
  return resources.filter((resource) => decide(subject, action, resource, table, rules).allowed);
}
export function conflictingRules(rules: Rule[]) {
  const collisions: Array<[string, string]> = [];
  for (let index = 0; index < rules.length; index += 1) {
    const left = rules[index]!;
    for (const right of rules.slice(index + 1)) {
      if (left.role === right.role && left.action === right.action && left.resource === right.resource && left.priority === right.priority && left.effect !== right.effect) collisions.push([left.id, right.id]);
    }
  }
  return collisions;
}
