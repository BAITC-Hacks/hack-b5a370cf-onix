import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const plan = [
  { measureId: "M7", districtId: "nura" },
  { measureId: "M8", districtId: "nura" },
  { measureId: "M10", districtId: "nura" },
  { measureId: "M12" },
  { measureId: "M5", districtId: "saryarka" },
];

test("ошибка записи рейтинга не блокирует следующую отправку; проваленный стресс-тест не имеет worst", async () => {
  const originalDir = process.cwd();
  const tempDir = await mkdtemp(path.join(tmpdir(), "akim-leaderboard-"));
  const file = path.join(tempDir, "data", "leaderboard.json");
  try {
    process.chdir(tempDir);
    await mkdir(file, { recursive: true }); // Вместо файла существует каталог: запись закономерно ошибётся.
    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("isolated", tempDir);
    const { submitEntry, listEntries } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");

    await assert.rejects(submitEntry({ team: "Onix", decisions: plan }), { code: "EISDIR" });
    await rmdir(file);

    const result = await submitEntry({ team: "Onix", decisions: plan });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rank, 1);
    assert.ok(result.entry.failed > 0);
    assert.equal(result.entry.worst, null);
    assert.equal((await listEntries())[0].team, "Onix");
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(stored[0].worst, null);
  } finally {
    process.chdir(originalDir);
    await rm(tempDir, { recursive: true, force: true });
  }
});
