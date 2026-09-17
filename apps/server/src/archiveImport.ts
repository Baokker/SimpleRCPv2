import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { isIgnoredPath } from "./workspacePolicy.js";

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_COUNT = 50_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

export async function extractZipArchive({
  archive,
  destination
}: {
  archive: Buffer;
  destination: string;
}) {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("ZIP archive exceeds the 200 MiB limit");
  }

  const zip = await openZip(archive);
  try {
    const entries = await readEntries(zip);
    let declaredBytes = 0;
    let filteredEntries = 0;
    const accepted: Entry[] = [];

    for (const entry of entries) {
      validateEntry(entry);
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > MAX_TOTAL_BYTES) {
        throw new Error("ZIP archive exceeds the 1 GiB extracted size limit");
      }
      if (entry.uncompressedSize > MAX_FILE_BYTES) {
        throw new Error("ZIP entry exceeds the 128 MiB file limit");
      }
      if (isIgnoredPath(entry.fileName)) {
        filteredEntries += 1;
        continue;
      }
      accepted.push(entry);
    }

    await fsPromises.mkdir(destination, { recursive: true });
    let extractedBytes = 0;
    for (const entry of accepted) {
      const targetPath = resolveArchivePath(destination, entry.fileName);
      if (entry.fileName.endsWith("/")) {
        await fsPromises.mkdir(targetPath, { recursive: true });
        continue;
      }
      await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
      const input = await openEntryStream(zip, entry);
      const countBytes = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          extractedBytes += chunk.byteLength;
          if (extractedBytes > MAX_TOTAL_BYTES) {
            callback(new Error("ZIP archive exceeds the 1 GiB extracted size limit"));
            return;
          }
          callback(null, chunk);
        }
      });
      await pipeline(input, countBytes, fs.createWriteStream(targetPath, { flags: "wx" }));
    }

    return { filteredEntries };
  } finally {
    zip.close();
  }
}

function openZip(archive: Buffer) {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(
      archive,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, zip) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(zip);
      }
    );
  });
}

function readEntries(zip: ZipFile) {
  return new Promise<Entry[]>((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on("entry", (entry) => {
      entries.push(entry);
      if (entries.length > MAX_ENTRY_COUNT) {
        reject(new Error("ZIP archive exceeds the 50000 entry limit"));
        return;
      }
      zip.readEntry();
    });
    zip.once("error", reject);
    zip.once("end", () => resolve(entries));
    zip.readEntry();
  });
}

function validateEntry(entry: Entry) {
  const entryPath = entry.fileName;
  if (
    !entryPath ||
    entryPath.includes("\\") ||
    entryPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(entryPath) ||
    entryPath.split("/").includes("..")
  ) {
    throw new Error("ZIP archive contains an invalid path");
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  const isDirectory = entryPath.endsWith("/");
  if (
    fileType !== 0 &&
    fileType !== 0o100000 &&
    !(isDirectory && fileType === 0o040000)
  ) {
    throw new Error("ZIP archive contains an unsupported entry type");
  }
}

function resolveArchivePath(destination: string, entryPath: string) {
  const resolved = path.resolve(destination, entryPath);
  const prefix = `${path.resolve(destination)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error("ZIP archive contains an invalid path");
  }
  return resolved;
}

function openEntryStream(zip: ZipFile, entry: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stream);
    });
  });
}
