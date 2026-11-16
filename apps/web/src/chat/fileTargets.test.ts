import { describe, expect, it } from "bun:test";
import {
	mentionBrowses,
	mentionLookup,
	mentionSearchQuery,
	supportsMentionSearch,
	workspaceFileTarget,
} from "./fileTargets";

describe("mentionLookup", () => {
	it("splits a typed @-path into the folder to list and the name prefix, either separator", () => {
		expect(mentionLookup("src\\Comp")).toEqual({ dir: "src", prefix: "comp" });
		expect(mentionLookup("src/components/")).toEqual({ dir: "src/components", prefix: "" });
		expect(mentionLookup(".\\docs\\RE")).toEqual({ dir: "docs", prefix: "re" });
		expect(mentionLookup("READ")).toEqual({ dir: "", prefix: "read" });
	});
});

describe("mentionBrowses", () => {
	it("browses a folder only for a bare @ or a query that ends at a separator", () => {
		for (const query of ["", "./", "src/", "src\\", "src\\components\\"]) {
			expect(mentionBrowses(query)).toBe(true);
		}
		for (const query of ["a", "ah", "src/Comp", "src/components/button"]) {
			expect(mentionBrowses(query)).toBe(false);
		}
	});
});

describe("mentionSearchQuery", () => {
	it("hands the host the wire's separator, so a typed backslash still ranks the same path", () => {
		expect(mentionSearchQuery("src\\components\\but")).toBe("src/components/but");
		expect(mentionSearchQuery("./apps/web")).toBe("apps/web");
	});
});

describe("supportsMentionSearch", () => {
	it("needs a v124 host and keeps older ones on the level-by-level listing", () => {
		expect(supportsMentionSearch(124)).toBe(true);
		expect(supportsMentionSearch(130)).toBe(true);
		expect(supportsMentionSearch(123)).toBe(false);
		expect(supportsMentionSearch(null)).toBe(false);
		expect(supportsMentionSearch(undefined)).toBe(false);
	});
});

describe("workspaceFileTarget", () => {
	it("canonicalizes only paths contained by the active worktree", () => {
		for (const [path, root, expected] of [
			["module-a/../README.md", "/repo", "README.md"],
			["/repo/module-a/SPEC.md", "/repo", "module-a/SPEC.md"],
			["C:\\repo\\module-a\\SPEC.md", "C:\\repo", "module-a/SPEC.md"],
			["/repo-other/SPEC.md", "/repo", null],
			["../outside.md", "/repo", null],
			["https://example.com/a.md", "/repo", null],
			["file:///repo/a.md", "/repo", null],
			["", "/repo", null],
		] as const) {
			expect(workspaceFileTarget(path, root)).toBe(expected);
		}
	});
});
