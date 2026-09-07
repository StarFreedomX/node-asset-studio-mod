#include "astc.h"
#include <stddef.h>

// One call per image. Input and output are caller-owned WASM buffers.
extern "C" int decode_astc_rgba(const uint8_t *input, int width, int height,
                                int block, uint32_t *output) {
    if (!decode_astc(input, width, height, block, block, output)) return 0;
    auto bytes = reinterpret_cast<uint8_t *>(output);
    const size_t size = static_cast<size_t>(width) * height * 4;
    for (size_t i = 0; i < size; i += 4) {
        const uint8_t blue = bytes[i];
        bytes[i] = bytes[i + 2];
        bytes[i + 2] = blue;
    }
    return 1;
}
