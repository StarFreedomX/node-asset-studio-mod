import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Euler } from "three";
import {
  sampleKeys,
  curveTimes,
  eulerQuaternion,
} from "../dist/animation-curves.js";
import {
  PackedQuaternionVector,
  packedIntegers,
  packedQuaternions,
  slerp,
} from "../dist/packed-animation.js";
const bits = (entries) => {
  const data = Buffer.alloc(
    Math.ceil(entries.reduce((n, [, bits]) => n + bits, 0) / 8),
  );
  let at = 0;
  for (const [value, n] of entries)
    for (let i = 0; i < n; i++, at++)
      data[at >>> 3] |= (Math.floor(value / 2 ** i) & 1) << (at & 7);
  return data;
};
test("weighted Hermite curves match a known Bezier point, endpoint steps and ordinary Hermite", () => {
  const keys = [
    { time: 0, value: 0, outSlope: 2, weightedMode: 2, outWeight: 0.1 },
    { time: 1, value: 1, inSlope: 0, weightedMode: 1, inWeight: 0.6 },
  ];
  // Bezier t=0.5: x=(3*0.1+3*0.4+1)/8; y=(0+3*0.2+3*1+1)/8.
  assert.ok(Math.abs(sampleKeys(keys, 0.3125, 1)[0] - 0.575) < 1e-10);
  assert.equal(
    sampleKeys(
      [
        { time: 0, value: 5, outSlope: Infinity },
        { time: 1, value: 9, inSlope: Infinity },
      ],
      1,
      1,
    )[0],
    9,
  );
  assert.ok(
    Math.abs(
      sampleKeys(
        [
          { time: 0, value: 0, outSlope: 1 },
          { time: 1, value: 1, inSlope: 1 },
        ],
        0.3,
        1,
      )[0] - 0.3,
    ) < 1e-10,
  );
  assert.throws(() => curveTimes([{ time: 1 }, { time: 0 }], 60), /Invalid/);
  assert.throws(() => curveTimes([{ time: 0 }, { time: 1e10 }], 60), /Invalid/);
});
test("all six Unity Euler application orders agree with independent quaternion composition", () => {
  for (const [order, name] of [
    "XYZ",
    "XZY",
    "YZX",
    "YXZ",
    "ZXY",
    "ZYX",
  ].entries()) {
    const actual = eulerQuaternion([30, 40, 50], order),
      expected = new Quaternion()
        .setFromEuler(
          new Euler(
            (30 * Math.PI) / 180,
            (40 * Math.PI) / 180,
            (50 * Math.PI) / 180,
            [...name].reverse().join(""),
          ),
        )
        .toArray();
    for (let i = 0; i < 4; i++)
      assert.ok(Math.abs(actual[i] - expected[i]) < 1e-12);
  }
});
test("packed animation decodes unsigned 32-bit times and quaternion flags with strict bounds", () => {
  assert.deepEqual(
    packedIntegers({
      length: 2,
      bitSize: 32,
      data: bits([
        [0xffffffff, 32],
        [100, 32],
      ]),
    }),
    [0xffffffff, 100],
  );
  const q = bits([
      [3, 3],
      [256, 9],
      [512, 10],
      [512, 10],
    ]),
    decoded = packedQuaternions({ length: 1, data: q })[0];
  assert.ok(decoded[3] > 0.999);
  assert.equal(q.length, 4);
  assert.throws(() => packedQuaternions({ length: 2, data: q }), /Truncated/);
  const n = bits([
    [7, 3],
    [256, 9],
    [512, 10],
    [512, 10],
  ]);
  assert.ok(packedQuaternions({ length: 1, data: n })[0][3] < -0.999);
  const result = slerp([0, 0, 0, 1], [0, 0, 1, 0], 0.5);
  assert.ok(Math.abs(result[2] - Math.SQRT1_2) < 1e-12);
});
test("PackedQuatVector consumes exactly its payload, preserving the following slopes field", () => {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(1);
  b.writeUInt32LE(4, 4);
  b.writeUInt32LE(0x12345678, 12);
  const reader = {
    offset: 0,
    readUInt32() {
      const v = b.readUInt32LE(this.offset);
      this.offset += 4;
      return v;
    },
    read(size) {
      const v = b.subarray(this.offset, this.offset + size);
      this.offset += size;
      return v;
    },
    align(n) {
      this.offset = Math.ceil(this.offset / n) * n;
    },
  };
  const v = new PackedQuaternionVector(reader);
  assert.equal(v.data.length, 4);
  assert.equal(reader.offset, 12);
  assert.equal(reader.readUInt32(), 0x12345678);
});
