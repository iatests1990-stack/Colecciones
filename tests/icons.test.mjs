import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import * as fs from "node:fs";
import zlib from "zlib";

const ICON_SIZES = [16, 32, 48, 128];

describe("Icon PNG validation", () => {
  for (const size of ICON_SIZES) {
    it(`icon${size}.png has valid PNG signature`, () => {
      const path = `icons/icon${size}.png`;
      const buf = fs.readFileSync(path);

      // 8-byte PNG signature
      const signature = buf.slice(0, 8).toString("latin1");
      assert.strictEqual(signature, "\x89PNG\r\n\x1a\n", `Invalid PNG signature in ${path}`);
    });

    it(`icon${size}.png has IHDR chunk with length 13`, () => {
      const path = `icons/icon${size}.png`;
      const buf = fs.readFileSync(path);

      let offset = 8; // after signature

      // Read first chunk
      const chunkType = buf.slice(offset + 4, offset + 8).toString("utf8");
      assert.strictEqual(chunkType, "IHDR", `First chunk should be IHDR in ${path}`);

      const chunkLength = buf.readUInt32BE(offset);
      assert.strictEqual(chunkLength, 13, `IHDR chunk length should be 13 in ${path}`);
    });

    it(`icon${size}.png has IDAT chunk`, () => {
      const path = `icons/icon${size}.png`;
      const buf = fs.readFileSync(path);

      let offset = 8; // after signature

      let foundIDAT = false;
      // Read chunks until IEND
      while (offset < buf.length - 8) {
        const chunkLength = buf.readUInt32BE(offset);
        const chunkType = buf.slice(offset + 4, offset + 8).toString("utf8");

        if (chunkType === "IDAT") {
          foundIDAT = true;
          // Verify zlib.inflate can decompress it
          const idatData = buf.slice(offset + 8, offset + 8 + chunkLength);
          try {
            zlib.inflateSync(idatData);
          } catch (e) {
            assert.fail(`Failed to inflate IDAT in ${path}: ${e.message}`);
          }
          break;
        } else if (chunkType === "IEND") {
          break;
        }

        offset += 12 + chunkLength; // 4 (length) + 4 (type) + data + 4 (crc)
      }
      assert.ok(foundIDAT, `IDAT chunk not found in ${path}`);
    });

    it(`icon${size}.png ends with zero-length IEND chunk`, () => {
      const path = `icons/icon${size}.png`;
      const buf = fs.readFileSync(path);

      let offset = 8; // after signature
      let lastChunkEnd = -1;

      // Read chunks until end
      while (offset < buf.length - 8) {
        const chunkLength = buf.readUInt32BE(offset);
        const chunkType = buf.slice(offset + 4, offset + 8).toString("utf8");

        if (chunkType === "IEND") {
          // IEND should have length 0
          assert.strictEqual(chunkLength, 0, `IEND chunk length should be 0 in ${path}`);
          lastChunkEnd = offset;
          break;
        }

        offset += 12 + chunkLength; // 4 (length) + 4 (type) + data + 4 (crc)
      }

      // Verify we found IEND
      assert.ok(lastChunkEnd >= 0, `IEND chunk not found in ${path}`);
    });

    it(`icon${size}.png decompresses to expected size`, () => {
      const path = `icons/icon${size}.png`;
      const buf = fs.readFileSync(path);

      let offset = 8; // after signature
      let foundIDAT = false;
      let idatData = Buffer.alloc(0);

      // Read chunks until IEND
      while (offset < buf.length - 8) {
        const chunkLength = buf.readUInt32BE(offset);
        const chunkType = buf.slice(offset + 4, offset + 8).toString("utf8");

        if (chunkType === "IDAT") {
          foundIDAT = true;
          idatData = buf.slice(offset + 8, offset + 8 + chunkLength);
          break;
        } else if (chunkType === "IEND") {
          break;
        }

        offset += 12 + chunkLength;
      }

      assert.ok(foundIDAT, `IDAT chunk not found in ${path}`);

      // Decompress and verify size
      const decompressed = zlib.inflateSync(idatData);
      // Each row: 1 filter byte + 3 bytes per pixel (RGB)
      // height rows = height * (1 + 3 * width) bytes
      const expectedSize = size * (1 + 3 * size);
      assert.strictEqual(decompressed.length, expectedSize, `Decompressed size ${decompressed.length} should be ${expectedSize} for icon${size}.png`);
    });
  }
});