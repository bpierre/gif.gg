all:
	bun run build

clean:
	bun run clean

.DEFAULT_GOAL := all

.PHONY: all clean
