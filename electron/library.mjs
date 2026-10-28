import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseSpec, SOURCE_URL } from "../shared/domain.mjs";

export async function archiveSpec(root, bytes, originalName) {
  const parsed = parseSpec(bytes.toString("utf8"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = sha256;
  const rawDir = path.join(root, "raw", id);
  await fs.mkdir(rawDir, { recursive: true });
  const rawPath = path.join(rawDir, "openapi.json");
  try {
    await fs.writeFile(rawPath, bytes, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const manifest = {
    id,
    sha256,
    importedAt: new Date().toISOString(),
    originalName: path.basename(originalName),
    sourceUrl: SOURCE_URL,
    sourceAttribution:
      "User-supplied file; origin not independently authenticated",
    title: parsed.title,
    version: parsed.version,
    format: parsed.format,
    bytes: bytes.length,
    operationCount: parsed.operations.length,
    schemaCount: Object.keys(parsed.schemas).length,
  };
  try {
    await fs.writeFile(
      path.join(rawDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const actualManifest = JSON.parse(
    await fs.readFile(path.join(rawDir, "manifest.json"), "utf8"),
  );
  await fs.mkdir(path.join(root, "derived"), { recursive: true });
  await fs.writeFile(
    path.join(root, "derived", `${id}.json`),
    JSON.stringify(
      {
        ...actualManifest,
        operations: parsed.operations.map(
          ({ operation, pathParameters, ...rest }) => rest,
        ),
        schemaNames: Object.keys(parsed.schemas),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await fs.writeFile(path.join(root, "current.json"), JSON.stringify({ id }), {
    mode: 0o600,
  });
  return actualManifest;
}

export async function loadLibrary(root) {
  try {
    const { id } = JSON.parse(
      await fs.readFile(path.join(root, "current.json"), "utf8"),
    );
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid library index.");
    const dir = path.join(root, "raw", id);
    const raw = await fs.readFile(path.join(dir, "openapi.json"));
    if (createHash("sha256").update(raw).digest("hex") !== id)
      throw new Error(
        "The raw specification checksum has changed. Reimport the original file.",
      );
    return {
      manifest: JSON.parse(
        await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
      ),
      ...parseSpec(raw.toString("utf8")),
    };
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
