interface Pointer {
  fileID: number;
  pathID: bigint;
}
interface Container {
  key: string;
  value: { preloadIndex: number; preloadSize: number; asset?: Pointer };
}

/** AssetStudio assigns each preload reference to its last containing entry. */
export function buildContainerMap(
  preloadTable: Pointer[],
  containers: Container[],
) {
  const result = new Map<bigint, Container>();
  for (const container of containers) {
    const { preloadIndex: start, preloadSize: size } = container.value;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(size) ||
      start < 0 ||
      size < 0 ||
      start + size > preloadTable.length
    )
      throw new Error("Invalid AssetBundle preload range");
    for (let i = start; i < start + size; i++) {
      const pointer = preloadTable[i];
      if (pointer.fileID === 0) result.set(pointer.pathID, container);
    }
  }
  return result;
}
