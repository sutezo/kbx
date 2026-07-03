// Generates PWA icons (a simple keyhole mark) as PNGs without any
// image library, using a minimal hand-rolled PNG encoder on top of zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');

const BG = [15, 23, 42]; // slate-950
const FG = [129, 140, 248]; // indigo-400

/** CRC32 as required by the PNG chunk format. */
function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) {
			crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBytes = Buffer.from(type, 'ascii');
	const body = Buffer.concat([typeBytes, data]);
	const out = Buffer.alloc(8 + data.length + 4);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), 8 + data.length);
	return out;
}

/** Encodes an RGB pixel function into a PNG buffer. */
function encodePng(size, pixelAt) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: truecolor

	const raw = Buffer.alloc(size * (1 + size * 3));
	for (let y = 0; y < size; y++) {
		const row = y * (1 + size * 3);
		raw[row] = 0; // filter: none
		for (let x = 0; x < size; x++) {
			const [r, g, b] = pixelAt(x / size, y / size);
			const p = row + 1 + x * 3;
			raw[p] = r;
			raw[p + 1] = g;
			raw[p + 2] = b;
		}
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** Keyhole mark: a circle plus a widening stem, centered. */
function keyhole(u, v) {
	const dx = u - 0.5;
	const circle = Math.hypot(dx, v - 0.4) < 0.13;
	const stem = v >= 0.4 && v <= 0.68 && Math.abs(dx) < 0.05 + (v - 0.4) * 0.18;
	return circle || stem ? FG : BG;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size] of [
	['icon-192.png', 192],
	['icon-512.png', 512],
	['apple-touch-icon.png', 180]
]) {
	writeFileSync(join(OUT_DIR, name), encodePng(size, keyhole));
	console.log(`wrote static/${name}`);
}
