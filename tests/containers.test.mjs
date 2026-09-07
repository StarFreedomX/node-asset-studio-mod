import test from "node:test";
import assert from "node:assert/strict";
import { buildContainerMap } from "../dist/containers.js";
const pointer = (pathID, fileID = 0) => ({ pathID: BigInt(pathID), fileID });
const container = (key, preloadIndex, preloadSize) => ({
  key,
  value: { preloadIndex, preloadSize },
});
test("preload container mapping uses half-open ranges and last assignment, including duplicate pointers", () => {
  const map = buildContainerMap(
    [pointer(1), pointer(2), pointer(1), pointer(3), pointer(1, 1)],
    [
      container("first", 0, 2),
      container("later", 2, 1),
      container("empty", 3, 0),
      container("external", 4, 1),
    ],
  );
  assert.equal(map.get(1n).key, "later");
  assert.equal(map.get(2n).key, "first");
  assert.equal(map.has(3n), false);
});
test("malformed preload ranges fail explicitly", () => {
  for (const [start, size] of [
    [-1, 1],
    [0, -1],
    [0, 2],
    [0.5, 1],
  ])
    assert.throws(
      () =>
        buildContainerMap([pointer(1)], [container("invalid", start, size)]),
      /Invalid/,
    );
});
