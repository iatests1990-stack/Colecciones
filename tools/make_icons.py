#!/usr/bin/env python3
"""Generate solid-color PNG icons using only Python stdlib (zlib, struct)."""

import struct
import zlib

COLOR = bytes.fromhex("0f6cbd")  # #0f6cbd blue


def make_png(width, height):
    """Create a solid-color PNG of the given dimensions."""
    # PNG signature
    png = b"\x89PNG\r\n\x1a\n"

    # IHDR chunk: width, height, bit_depth=8, color_type=2 (RGB)
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png += struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + \
        struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF)

    # IDAT chunk: filtered rows (filter byte 0 per row + RGB pixels)
    # Each row: filter byte (0) + width*3 RGB bytes
    scanlines = b""
    for _ in range(height):
        scanlines += b"\x00" + COLOR * width

    compressed = zlib.compress(scanlines)
    png += struct.pack(">I", len(compressed)) + b"IDAT" + compressed + \
        struct.pack(">I", zlib.crc32(b"IDAT" + compressed) & 0xFFFFFFFF)

    # IEND chunk
    png += struct.pack(">I", 0) + b"IEND" + \
        struct.pack(">I", zlib.crc32(b"IEND") & 0xFFFFFFFF)

    return png


def main():
    sizes = [16, 32, 48, 128]
    icons_dir = "icons"
    import os
    os.makedirs(icons_dir, exist_ok=True)

    for size in sizes:
        png_data = make_png(size, size)
        path = os.path.join(icons_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(png_data)
        print(f"Written {path}")


if __name__ == "__main__":
    main()