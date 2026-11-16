import { describe, expect, it } from "bun:test";
import { MATCH_TIER, parseMatchTerms } from "@thinkrail/contracts";
import { indexFileList } from "./files";
import { searchPaths } from "./paths";

function search(paths: readonly string[], query: string, limit = 20) {
	return searchPaths(indexFileList({ paths, truncated: false }), {
		terms: parseMatchTerms(query),
		limit,
	});
}

const tree = [
	"packages/AxonHub/src/index.ts",
	"src/app/handler.ts",
	"docs/all-hands.md",
	"README.md",
];

describe("searchPaths", () => {
	it("finds a nested folder by its initials, so `ah` reaches packages/AxonHub without typing the path", () => {
		const [first] = search(tree, "ah");
		expect(first).toMatchObject({
			path: "packages/AxonHub",
			name: "AxonHub",
			kind: "dir",
			tier: MATCH_TIER.word,
		});
		expect(search(tree, "AH")[0]?.path).toBe("packages/AxonHub");
	});

	it("matches a name in any folder, not just the worktree root", () => {
		expect(search(tree, "readme")[0]).toMatchObject({
			path: "README.md",
			kind: "file",
			tier: MATCH_TIER.prefix,
		});
		expect(search(tree, "hands").map((entry) => entry.path)).toContain("docs/all-hands.md");
	});

	it("puts a typed prefix above the acronym that also matches", () => {
		const ranked = search(["packages/AxonHub", "src/ah-notes.md"], "ah");
		expect(ranked.map((entry) => entry.path)).toEqual(["src/ah-notes.md", "packages/AxonHub"]);
		expect(ranked[0]?.tier).toBe(MATCH_TIER.prefix);
		expect(ranked[1]?.tier).toBe(MATCH_TIER.word);
	});

	it("keeps the matcher's other tiers: an acronym, a substring and a loose subsequence", () => {
		expect(search(["src/big-ugly-tent.ts"], "but")[0]?.tier).toBe(MATCH_TIER.word);
		expect(search(["src/rebut.ts"], "but")[0]?.tier).toBe(MATCH_TIER.substring);
		expect(search(["src/bolt-on.ts"], "bton")[0]?.tier).toBe(MATCH_TIER.fuzzy);
	});

	it("offers the folders the file list only implies, exact and prefix first", () => {
		const ranked = search(["apps/web/src/a.ts"], "apps");
		expect(ranked.map((entry) => [entry.path, entry.kind])).toEqual([
			["apps", "dir"],
			["apps/web", "dir"],
			["apps/web/src", "dir"],
			["apps/web/src/a.ts", "file"],
		]);
		expect(ranked[0]?.tier).toBe(MATCH_TIER.exact);
	});

	it("prefers the shallower path when two entries match equally well", () => {
		expect(search(["a/readme.ts", "deep/deeper/readme.ts"], "readme").map((e) => e.path)).toEqual([
			"a/readme.ts",
			"deep/deeper/readme.ts",
		]);
	});

	it("caps the answer at the limit the menu asks for", () => {
		expect(search(["a.ts", "b.ts", "c.ts"], "ts", 2)).toHaveLength(2);
	});

	it("answers nothing for a blank query, leaving the bare @ to the folder listing", () => {
		expect(search(tree, "  ")).toEqual([]);
	});
});
