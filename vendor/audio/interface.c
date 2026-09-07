#include <stdlib.h>
#include <string.h>
#include <vorbis/vorbisfile.h>
#define DR_MP3_IMPLEMENTATION
#define DR_MP3_NO_STDIO
#define DR_MP3_NO_SIMD
#include "dr_mp3.h"

typedef struct {
    drmp3 mp3;
    OggVorbis_File vorbis;
    const unsigned char *data;
    size_t size, position;
    int type, channels, rate;
} Audio;
static size_t memory_read(void *out, size_t size, size_t count, void *user) {
    Audio *a = user;
    if (!size) return 0;
    size_t n = (a->size - a->position) / size;
    if (n > count) n = count;
    memcpy(out, a->data + a->position, n * size);
    a->position += n * size;
    return n;
}
static int memory_seek(void *user, ogg_int64_t offset, int whence) {
    Audio *a = user;
    ogg_int64_t base = whence == SEEK_SET ? 0 : whence == SEEK_CUR ? a->position : a->size;
    if (offset < -base || offset > (ogg_int64_t)a->size - base) return -1;
    a->position = base + offset;
    return 0;
}
static long memory_tell(void *user) { return ((Audio *)user)->position; }
Audio *audio_open(const unsigned char *data, int size, int type) {
    Audio *a = calloc(1, sizeof(Audio));
    if (!a) return NULL;
    a->type = type;
    if (type == 1) {
        if (!drmp3_init_memory(&a->mp3, data, size, NULL)) { free(a); return NULL; }
        a->channels = a->mp3.channels; a->rate = a->mp3.sampleRate;
    } else {
        a->data = data; a->size = size;
        ov_callbacks callbacks = { memory_read, memory_seek, NULL, memory_tell };
        if (ov_open_callbacks(a, &a->vorbis, NULL, 0, callbacks)) { free(a); return NULL; }
        vorbis_info *info = ov_info(&a->vorbis, -1);
        a->channels = info->channels; a->rate = info->rate;
    }
    return a;
}
int audio_channels(Audio *a) { return a->channels; }
int audio_rate(Audio *a) { return a->rate; }
int audio_read(Audio *a, short *out, int frames) {
    if (a->type == 1) return (int)drmp3_read_pcm_frames_s16(&a->mp3, frames, out);
    int stream;
    long n = ov_read(&a->vorbis, (char *)out, frames * a->channels * 2, 0, 2, 1, &stream);
    return n < 0 ? -1 : n / (a->channels * 2);
}
void audio_close(Audio *a) {
    if (a->type == 1) drmp3_uninit(&a->mp3); else ov_clear(&a->vorbis);
    free(a);
}
