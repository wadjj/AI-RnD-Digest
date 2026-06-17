import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("digest prompt requires empty sections to be skipped silently", () => {
  const prompt = readFileSync(new URL("../prompts/digest-intro.md", import.meta.url), "utf8");
  const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");

  assert.match(prompt, /Skip empty sections silently/);
  assert.match(prompt, /Do not write placeholder text/);
  assert.match(skill, /Empty sections must be skipped silently/);
});
