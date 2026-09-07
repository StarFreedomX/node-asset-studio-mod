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

#include "bcn.h"
#include "pvrtc.h"
extern "C" int decode_extra_rgba(const uint8_t *input, int width, int height,
                                 int format, uint32_t *output) {
    int ok = 0;
    switch (format) {
        case 4: ok = decode_bc4(input, width, height, output); break;
        case 5: ok = decode_bc5(input, width, height, output); break;
        case 6: ok = decode_bc6(input, width, height, output); break;
        case 12: ok = decode_pvrtc(input, width, height, output, 1); break;
        case 14: ok = decode_pvrtc(input, width, height, output, 0); break;
    }
    if (!ok) return 0;
    auto bytes = reinterpret_cast<uint8_t *>(output);
    for (size_t i = 0; i < static_cast<size_t>(width) * height * 4; i += 4) {
        const uint8_t blue = bytes[i]; bytes[i] = bytes[i+2]; bytes[i+2] = blue;
    }
    return 1;
}
