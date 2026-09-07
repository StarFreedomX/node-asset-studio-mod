import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { LoadingManager, Texture } from "three";
// Decode the complete FBX in a separate implementation. Image loading is disabled
// so this headless test checks geometry/animation without a browser DOM/network.
export function readFbx(data) {
  const previous = globalThis.window,
    urls = [];
  globalThis.window = {
    URL: {
      createObjectURL(blob) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      },
    },
  };
  const manager = new LoadingManager();
  manager.addHandler(/.*/, {
    path: "",
    setPath(p) {
      this.path = p;
      return this;
    },
    load() {
      return new Texture();
    },
  });
  try {
    return new FBXLoader(manager).parse(Uint8Array.from(data).buffer, "");
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}
