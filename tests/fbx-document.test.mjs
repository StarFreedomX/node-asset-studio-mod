import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFbx,
  writeFbx,
  prop,
  value,
  fbxNode as N,
} from "../dist/fbx-document.js";
test("FBX writer recalculates absolute offsets and preserves Unicode, arrays and 64-bit IDs", () => {
  const doc = {
    nodes: [
      N(
        "Objects",
        [],
        [
          N(
            "Model",
            [
              prop("L", 9007199254740993n),
              prop("S", "名字\0\x01Model"),
              prop("S", "Mesh"),
            ],
            [
              N("Values", [
                prop("l", [0n, 46186158000n]),
                prop("f", [0, 0.25, 1]),
              ]),
            ],
          ),
        ],
      ),
    ],
    footer: Buffer.alloc(0),
  };
  const first = writeFbx(doc),
    read = parseFbx(first);
  assert.deepEqual(writeFbx(read), first);
  assert.equal(
    value(read.nodes[0].children[0].properties[0]),
    9007199254740993n,
  );
  read.nodes[0].children.push(N("Model", [prop("L", 2), prop("S", "Added")]));
  const second = parseFbx(writeFbx(read));
  assert.equal(second.nodes[0].children.length, 2);
  assert.deepEqual(
    value(second.nodes[0].children[0].children[0].properties[0]),
    [0n, 46186158000n],
  );
  const bad = Buffer.from(first);
  bad.writeBigUInt64LE(999999n, 27);
  assert.throws(() => parseFbx(bad), /bounds/);
  assert.throws(
    () => parseFbx(first.subarray(0, 40)),
    /Expected|nesting|bounds/,
  );
});
