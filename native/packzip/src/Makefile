EXE		= packzip
CFLAGS	+= -s -O2 -fstack-protector-all
PREFIX	= /usr/local
BINDIR	= $(PREFIX)/bin
SRC		= $(EXE).c

all:
	$(CC) $(CFLAGS) -c libs/7z_advancecomp/*.cc
	$(CC) $(CFLAGS) -c libs/lzma/LzmaDec.c libs/lzma/Lzma2Dec.c libs/lzma/Bra86.c libs/lzma/LzFind.c libs/lzma/LzmaEnc.c libs/lzma/Lzma2Enc.c -D_7ZIP_ST -D_7Z_TYPES_
	$(CC) $(CFLAGS) -c libs/uberflate/uberflate.c
	$(CC) $(CFLAGS) -c compression/advancecomp.cpp
	$(CC) $(CFLAGS) -c compression/adler32.c
	$(CC) $(CFLAGS) -c libs/zopfli/*.c
	$(CC) $(SRC) $(CFLAGS) -o $(EXE) *.o -lstdc++ -lz -lm -static

install:
	install -m 755 -d $(BINDIR)
	install -m 755 $(EXE) $(BINDIR)/$(EXE)

.PHONY:
	install
