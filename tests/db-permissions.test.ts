import assert from "node:assert/strict";
import test from "node:test";
import { sanitizedDbCheckError, validateDbPermissions, type DbPermissionSnapshot } from "../src/lib/dbPermissions";

const scoped: DbPermissionSnapshot = {
  currentUser: "tcf_slot_monitor", sessionUser: "tcf_slot_monitor", adminFlags: false, membershipCount: 0,
  targetExists: true, targetOwned: false, targetReadable: true, targetInsertable: true, targetUpdatable: true,
  targetForbiddenPrivileges: false, targetGrantOptions: false,
  otherTablePrivilegeCount: 0, otherColumnPrivilegeCount: 0, sequencePrivilegeCount: 0,
  schemaCreateCount: 0, databaseCreateCount: 0, securityDefinerCount: 0,
  inspectedRelationCount: 68, inspectedSequenceCount: 5,
};

test("accepts a direct monitor login with only the required table permissions", () => {
  assert.deepEqual(validateDbPermissions(scoped), []);
});

test("rejects the owner credential even after SET ROLE", () => {
  assert.ok(validateDbPermissions({ ...scoped, currentUser: "neondb_owner" }).includes("role identity"));
  assert.ok(validateDbPermissions({ ...scoped, sessionUser: "neondb_owner" }).includes("role identity"));
});

test("rejects administrative flags, table ownership, and memberships that could allow SET ROLE", () => {
  for (const change of [{ adminFlags: true }, { targetOwned: true }, { membershipCount: 1 }]) {
    assert.equal(validateDbPermissions({ ...scoped, ...change }).length, 1);
  }
});

test("requires all three monitor privileges and rejects forbidden or grantable privileges", () => {
  for (const change of [
    { targetExists: false }, { targetReadable: false }, { targetInsertable: false }, { targetUpdatable: false },
    { targetForbiddenPrivileges: true }, { targetGrantOptions: true },
  ]) assert.equal(validateDbPermissions({ ...scoped, ...change }).length, 1);
});

test("rejects other-table, column-only, sequence, permanent CREATE, and security-definer access", () => {
  for (const field of ["otherTablePrivilegeCount", "otherColumnPrivilegeCount", "sequencePrivilegeCount",
    "schemaCreateCount", "databaseCreateCount", "securityDefinerCount"] as const) {
    assert.equal(validateDbPermissions({ ...scoped, [field]: 1 }).length, 1, field);
  }
});

test("fails closed when catalog results omit fields or supply invalid counts", () => {
  assert.ok(validateDbPermissions({ ...scoped, adminFlags: undefined } as unknown as DbPermissionSnapshot).length);
  assert.ok(validateDbPermissions({ ...scoped, otherTablePrivilegeCount: null } as unknown as DbPermissionSnapshot).length);
  assert.ok(validateDbPermissions({ ...scoped, inspectedRelationCount: NaN }).length);
});

test("never includes database errors or connection strings in failure diagnostics", () => {
  const secret = "postgres://owner:do-not-log@example.invalid/db";
  assert.equal(sanitizedDbCheckError({ message: secret, code: "42501", detail: secret }),
    "Database permission check could not complete (SQLSTATE 42501)");
  for (const error of [new Error(secret), { code: secret }, { code: "42501\n" }, null]) {
    assert.equal(sanitizedDbCheckError(error), "Database permission check could not complete");
  }
});
