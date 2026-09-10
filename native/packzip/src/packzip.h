#define real_calloc calloc
#define real_free   free



// from quickbms.c
enum {
    LZMA_FLAGS_NONE         = 0,
    LZMA_FLAGS_86_HEADER    = 1,
    LZMA_FLAGS_86_DECODER   = 2,
    LZMA_FLAGS_EFS          = 4,
    LZMA_FLAGS_PROP0        = 0x1000,
    LZMA_FLAGS_NOP
};



#ifdef __GNUG__
extern "C"
#endif
int advancecomp_rfc1950(unsigned char *in, int insz, unsigned char *out, int outsz, int store);

#ifdef __GNUG__
extern "C"
#endif
int advancecomp_deflate(unsigned char *in, int insz, unsigned char *out, int outsz, int store);

#ifdef __GNUG__
extern "C"
#endif
int advancecomp_lzma(unsigned char *in, int insz, unsigned char *out, int outsz, int lzma_flags, int store);

