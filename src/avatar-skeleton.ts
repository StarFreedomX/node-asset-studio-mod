import type { GlbBuilder } from "./model.js";
/** Rebuild missing nodes from the Avatar's serialized default pose and TOS paths. */
export function restoreAvatarSkeleton(
  builder: GlbBuilder,
  paths: Map<string, number>,
  avatar: any,
): Map<number, number> {
  const constant = avatar?.avatar,
    skeleton = constant?.avatarSkeleton,
    pose = constant?.defaultPose?.transforms;
  if (
    !skeleton ||
    !pose ||
    pose.length > 100000 ||
    skeleton.id.length !== pose.length ||
    skeleton.nodes.length !== pose.length
  )
    throw Error("Avatar skeleton/default pose mismatch");
  const names = new Map<number, string>();
  for (const pair of avatar.tos ?? []) {
    if (names.has(pair.key) && names.get(pair.key) !== pair.value)
      throw Error("Ambiguous Avatar path hash");
    names.set(pair.key, pair.value);
  }
  const g = builder.document,
    hashes = new Map<number, number>(),
    byIndex: number[] = [],
    root = paths.get("");
  if (root === undefined) throw Error("Missing model root");
  const vec = (v: any) => [v.x, v.y, v.z];
  for (let i = 0; i < pose.length; i++) {
    const hash = skeleton.id[i],
      path = names.get(hash);
    if (hashes.has(hash)) throw Error("Duplicate Avatar bone hash");
    if (path === undefined) throw Error("Missing Avatar TOS path " + hash);
    if (i === 0) {
      byIndex.push(root);
      hashes.set(hash, root);
      continue;
    }
    const parent = skeleton.nodes[i].parentID;
    if (!Number.isInteger(parent) || parent < 0 || parent >= i)
      throw Error("Avatar skeleton is not in parent-first order");
    let node = paths.get(path),
      name = path.split("/").at(-1)!;
    if (node === undefined) {
      const matches = [...paths].filter(
        ([p, n]) => p && g.nodes[n].name === name,
      );
      if (matches.length > 1) throw Error("Ambiguous stripped bone " + name);
      if (matches.length === 1) {
        node = matches[0][1];
        paths.delete(matches[0][0]);
      }
    }
    if (node === undefined) {
      node = g.nodes.length;
      g.nodes.push({ name });
    }
    const t = pose[i],
      n = g.nodes[node];
    n.translation = [-t.t.x, t.t.y, t.t.z];
    n.rotation = [t.q.x, -t.q.y, -t.q.z, t.q.w];
    n.scale = vec(t.s);
    for (const existing of g.nodes)
      if (existing.children)
        existing.children = existing.children.filter(
          (id: number) => id !== node,
        );
    (g.nodes[byIndex[parent]].children ??= []).push(node);
    paths.set(path, node);
    byIndex.push(node);
    hashes.set(hash, node);
  }
  return hashes;
}
