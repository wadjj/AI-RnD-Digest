#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { deflateRawSync } from "zlib";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(ROOT_DIR, "dist", "ai-rnd-digest");
const SKILL_ARCHIVE = join(ROOT_DIR, "dist", "ai-rnd-digest.skill");
const FIXED_DOS_DATE = { time: 0, date: ((2026 - 1980) << 9) | (1 << 5) | 1 };

const PROMPTS = [
  "summarize-tweets.md",
  "digest-intro.md",
  "summarize-blogs.md",
  "summarize-podcast.md",
  "translate.md",
];

const ZIP_ENTRIES = [
  { name: "SKILL.md", path: join(DIST_DIR, "SKILL.md") },
  { name: "package.json", path: join(DIST_DIR, "package.json") },
  { name: "scripts/", directory: true },
  { name: "scripts/deliver.js", path: join(DIST_DIR, "scripts", "deliver.js") },
  { name: "scripts/prepare-digest.js", path: join(DIST_DIR, "scripts", "prepare-digest.js") },
  { name: "prompts/", directory: true },
  ...PROMPTS.map((filename) => ({
    name: `prompts/${filename}`,
    path: join(DIST_DIR, "prompts", filename),
  })),
  { name: "config/", directory: true },
  { name: "config/default-sources.json", path: join(DIST_DIR, "config", "default-sources.json") },
];

const SKILL_PACKAGE = {
  name: "ai-rnd-digest-skill",
  version: "0.1.0",
  private: true,
  type: "module",
  scripts: {
    "prepare-digest": "node scripts/prepare-digest.js",
    deliver: "node scripts/deliver.js",
  },
  engines: {
    node: ">=20",
  },
};

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
}

const CRC_TABLE = makeCrcTable();

function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function header(size) {
  return Buffer.alloc(size);
}

function localHeader(entry, nameBuffer) {
  const out = header(30);
  out.writeUInt32LE(0x04034b50, 0);
  out.writeUInt16LE(10, 4);
  out.writeUInt16LE(0, 6);
  out.writeUInt16LE(entry.method, 8);
  out.writeUInt16LE(FIXED_DOS_DATE.time, 10);
  out.writeUInt16LE(FIXED_DOS_DATE.date, 12);
  out.writeUInt32LE(entry.crc, 14);
  out.writeUInt32LE(entry.compressedSize, 18);
  out.writeUInt32LE(entry.uncompressedSize, 22);
  out.writeUInt16LE(nameBuffer.length, 26);
  out.writeUInt16LE(0, 28);
  return out;
}

function centralHeader(entry, nameBuffer, offset) {
  const out = header(46);
  out.writeUInt32LE(0x02014b50, 0);
  out.writeUInt16LE(0x031e, 4);
  out.writeUInt16LE(10, 6);
  out.writeUInt16LE(0, 8);
  out.writeUInt16LE(entry.method, 10);
  out.writeUInt16LE(FIXED_DOS_DATE.time, 12);
  out.writeUInt16LE(FIXED_DOS_DATE.date, 14);
  out.writeUInt32LE(entry.crc, 16);
  out.writeUInt32LE(entry.compressedSize, 20);
  out.writeUInt32LE(entry.uncompressedSize, 24);
  out.writeUInt16LE(nameBuffer.length, 28);
  out.writeUInt16LE(0, 30);
  out.writeUInt16LE(0, 32);
  out.writeUInt16LE(0, 34);
  out.writeUInt16LE(0, 36);
  out.writeUInt32LE(entry.directory ? 0x00100000 : 0, 38);
  out.writeUInt32LE(offset, 42);
  return out;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const out = header(22);
  out.writeUInt32LE(0x06054b50, 0);
  out.writeUInt16LE(0, 4);
  out.writeUInt16LE(0, 6);
  out.writeUInt16LE(entryCount, 8);
  out.writeUInt16LE(entryCount, 10);
  out.writeUInt32LE(centralSize, 12);
  out.writeUInt32LE(centralOffset, 16);
  out.writeUInt16LE(0, 20);
  return out;
}

async function copyIntoDist(source, target) {
  const destination = join(DIST_DIR, target);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(ROOT_DIR, source), destination);
}

async function rebuildDist() {
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  await copyIntoDist("SKILL.md", "SKILL.md");
  await writeFile(join(DIST_DIR, "package.json"), `${JSON.stringify(SKILL_PACKAGE, null, 2)}\n`);
  await copyIntoDist("scripts/deliver.js", "scripts/deliver.js");
  await copyIntoDist("scripts/prepare-digest.js", "scripts/prepare-digest.js");
  await copyIntoDist("config/default-sources.json", "config/default-sources.json");
  for (const filename of PROMPTS) {
    await copyIntoDist(`prompts/${filename}`, `prompts/${filename}`);
  }
}

async function writeZip() {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const item of ZIP_ENTRIES) {
    const source = item.directory ? Buffer.alloc(0) : await readFile(item.path);
    const data = item.directory ? source : deflateRawSync(source, { level: 9 });
    const nameBuffer = Buffer.from(item.name);
    const entry = {
      ...item,
      method: item.directory ? 0 : 8,
      crc: item.directory ? 0 : crc32(source),
      compressedSize: data.length,
      uncompressedSize: source.length,
    };
    const local = Buffer.concat([localHeader(entry, nameBuffer), nameBuffer, data]);
    const central = Buffer.concat([centralHeader(entry, nameBuffer, offset), nameBuffer]);

    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = endOfCentralDirectory(ZIP_ENTRIES.length, central.length, centralOffset);
  await writeFile(SKILL_ARCHIVE, Buffer.concat([...localParts, central, eocd]));
}

await rebuildDist();
await writeZip();
console.log(`Packaged ${SKILL_ARCHIVE}`);
