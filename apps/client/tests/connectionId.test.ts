import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { it } from "node:test";
import { createConnectionId } from "../src/memberIdentity.ts";

it("uses randomUUID when the page runs in a secure context", () => {
  assert.equal(createConnectionId({ randomUUID: () => "fixed-id", getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }), "fixed-id");
});

it("builds a version 4 UUID on plain HTTP pages where randomUUID is missing", () => {
  const ids = new Set(Array.from({ length: 50 }, () => createConnectionId({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
