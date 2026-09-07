#include <stddef.h>
#include <stdint.h>
void *gif_alloc(size_t);
void gif_free(void *, size_t);
void *gif_realloc(void *, size_t, size_t);
#define MSF_GIF_MALLOC(ctx, size) gif_alloc(size)
#define MSF_GIF_REALLOC(ctx, ptr, oldSize, newSize) gif_realloc(ptr, oldSize, newSize)
#define MSF_GIF_FREE(ctx, ptr, size) gif_free(ptr, size)
#define MSF_GIF_IMPL
#include "msf_gif.h"

// One animation per instance. Workers own their instances and input buffer.
static MsfGifState state;
static MsfGifResult result;
static uint8_t *pixels;
static size_t pixel_size;
static int active;

void encoder_dispose(void) {
    if (active) {
        MsfGifResult unfinished = msf_gif_end(&state);
        msf_gif_free(unfinished);
    }
    active = 0;
    msf_gif_free(result);
    memset(&result, 0, sizeof(result));
    gif_free(pixels, pixel_size);
    pixels = NULL;
    pixel_size = 0;
}

int encoder_begin(int width, int height) {
    encoder_dispose();
    if (width < 1 || height < 1 || width > 65535 || height > 65535 ||
        (uint64_t)width * height > 16777216) return 0;
    pixel_size = (size_t)width * height * 4;
    pixels = gif_alloc(pixel_size);
    if (!pixels) return 0;
    active = msf_gif_begin(&state, width, height);
    if (!active) encoder_dispose();
    return active;
}

uint8_t *encoder_pixels(void) { return pixels; }

int encoder_frame(int delay) {
    if (!active || delay < 0 || delay > 65535) return 0;
    if (!msf_gif_frame(&state, pixels, delay, 16, 0)) {
        active = 0; // msf_gif frees its own state on failure.
        return 0;
    }
    return 1;
}

void *encoder_end(void) {
    if (!active || state.framesSubmitted == 0) return NULL;
    result = msf_gif_end(&state);
    active = 0;
    return result.data;
}

size_t encoder_size(void) { return result.dataSize; }
