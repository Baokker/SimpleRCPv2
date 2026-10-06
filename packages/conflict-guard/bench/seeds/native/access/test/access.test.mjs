import * as check from 'node:assert/strict';
import { test } from 'node:test';
import * as roles from '../src/roles.ts';
import * as policy from '../src/policy.ts';
import { AccessSessions } from '../src/sessions.ts';
import { AuditTrail } from '../src/audit.ts';
test('role graph, deny precedence, scoped sessions, and audit history', () => {
  const graph = new Map([['reader', []], ['editor', ['reader']], ['admin', ['editor']]]);
  check.deepEqual(roles.ancestors('admin', graph), ['reader', 'editor', 'admin']);
  check.throws(() => roles.addParent(graph, 'reader', 'admin'));
  const subject = { id: 'member', roles: ['admin'], tenant: 'first', attempts: 0 };
  const rules = [
    { id: 'read', role: 'reader', action: 'read', resource: 'document', effect: 'allow', priority: 0 },
    { id: 'restricted', role: 'admin', action: 'read', resource: 'document', effect: 'deny', priority: 1 }
  ];
  const result = policy.decide(subject, 'read', 'document', graph, rules);
  check.equal(result.allowed, false);
  check.equal(result.rule, 'restricted');
  const sessions = new AccessSessions();
  const token = sessions.create('member', 0, 100, ['read', 'write']);
  sessions.narrow(token, ['read']);
  check.equal(sessions.validate(token, 'write', 50), undefined);
  check.equal(sessions.validate(token, 'read', 50), 'member');
  check.equal(sessions.validate(token, 'read', 100), undefined);
  const audit = new AuditTrail();
  audit.record({ subject: 'member', action: 'read', resource: 'document', allowed: false, at: 10 });
  check.deepEqual(audit.repeatedDenials(1, 10, 15), ['member']);
  check.equal(audit.forget('member'), 1);
});
