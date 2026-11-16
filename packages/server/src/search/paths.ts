import type { FileKind, MatchTerm, PathEntry } from "@thinkrail/contracts";
import { foldMatchText, matchFields } from "@thinkrail/contracts";
import type { IndexedFileList } from "./files";
import { type Deadline, isSubsequence } from "./hits";

const SCAN_CHECK_EVERY = 1_000;
/** Loose subsequence hits only fill a menu the gate did not fill; matching every one of them is not worth the scan. */
const PATH_LOOSE_CANDIDATES = 400;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const DIGIT = /\p{N}/u;

const PATH_FIELD = (path: string) => [{ key: "path", text: path, path: true }];

interface ListIndex {
	readonly folders: readonly string[];
	readonly foldedFolders: readonly string[];
	/** Each listed file's basename initials (`AxonHub` → `ah`), so an acronym is a cheap gate, not a full match. */
	readonly initials: readonly string[];
	readonly folderInitials: readonly string[];
}

const listIndexes = new WeakMap<IndexedFileList, ListIndex>();

function initialsOf(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	let initials = "";
	let previous = "";
	let wordStart = true;
	for (const char of base) {
		if (!WORD_CHAR.test(char)) {
			wordStart = true;
			previous = char;
			continue;
		}
		if (
			wordStart ||
			(UPPER.test(char) && LOWER.test(previous)) ||
			(DIGIT.test(char) && !DIGIT.test(previous))
		) {
			initials += char.toLowerCase();
		}
		wordStart = false;
		previous = char;
	}
	return initials;
}

/** Every folder above a listed file and every entry's initials, built once per loaded list and dropped with it. */
function indexOf(list: IndexedFileList): ListIndex {
	let index = listIndexes.get(list);
	if (!index) {
		const seen = new Set<string>();
		for (const path of list.paths) {
			for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
				const folder = path.slice(0, slash);
				if (seen.has(folder)) break;
				seen.add(folder);
			}
		}
		const folders = [...seen].sort();
		index = {
			folders,
			foldedFolders: folders.map((folder) => foldMatchText(folder)),
			initials: list.paths.map(initialsOf),
			folderInitials: folders.map(initialsOf),
		};
		listIndexes.set(list, index);
	}
	return index;
}

export interface PathSearchInput {
	readonly terms: readonly MatchTerm[];
	readonly limit: number;
	readonly deadline?: Deadline;
}

interface Gate {
	readonly text: string;
	readonly literal: boolean;
}

function compareEntries(a: PathEntry, b: PathEntry): number {
	return (
		a.tier - b.tier ||
		b.score - a.score ||
		a.path.length - b.path.length ||
		(a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
	);
}

/** A name's spelled-out initials are an acronym the matcher ranks highly, and a substring test cannot express it. */
function gatedIn(text: string, initials: string, gate: Gate): boolean {
	return text.includes(gate.text) || (!gate.literal && isSubsequence(initials, gate.text));
}

/**
 * Rank the whole worktree's files and folders for the composer's `@` menu: the shared matcher decides
 * the tier (so `ah` finds `packages/AxonHub` as an acronym, a real prefix still wins), and a cheap gate
 * keeps the full match off most of the list. A candidate that only matches as a loose subsequence — the
 * matcher's lowest tier — is consulted only when the gate found fewer than the menu can show, because
 * that fallback has to look at every entry.
 */
export function searchPaths(list: IndexedFileList, input: PathSearchInput): PathEntry[] {
	const gates = input.terms
		.map((term) => ({ text: foldMatchText(term.text), literal: term.literal }))
		.filter((gate) => gate.text !== "");
	if (gates.length === 0) return [];
	const index = indexOf(list);
	const hits: PathEntry[] = [];
	let scanned = 0;
	const expired = (): boolean => {
		scanned += 1;
		return scanned % SCAN_CHECK_EVERY === 0 && (input.deadline?.expired() ?? false);
	};
	const collect = (path: string, kind: FileKind): void => {
		const match = matchFields(input.terms, PATH_FIELD(path));
		if (!match) return;
		const slash = path.lastIndexOf("/");
		hits.push({
			path,
			name: slash === -1 ? path : path.slice(slash + 1),
			kind,
			tier: match.tier,
			score: match.score,
		});
	};
	const passes = (text: string, initials: string, loose: boolean): boolean => {
		if (!loose) return gates.every((gate) => gatedIn(text, initials, gate));
		return gates.every((gate) =>
			gate.literal ? text.includes(gate.text) : isSubsequence(text, gate.text),
		);
	};
	const scan = (loose: boolean, budget = Number.POSITIVE_INFINITY): boolean => {
		let taken = 0;
		const admit = (text: string, initials: string): boolean => {
			const strong = passes(text, initials, false);
			// The gated pass already ranked these; only entries it could not admit are still open.
			return loose ? !strong && passes(text, initials, true) : strong;
		};
		for (let position = 0; position < list.paths.length; position += 1) {
			if (expired()) return false;
			const text = list.folded[position] ?? "";
			if (!admit(text, index.initials[position] ?? "")) continue;
			collect(list.paths[position] ?? "", "file");
			taken += 1;
			if (taken >= budget) return true;
		}
		for (let position = 0; position < index.folders.length; position += 1) {
			if (expired()) return false;
			const text = index.foldedFolders[position] ?? "";
			if (!admit(text, index.folderInitials[position] ?? "")) continue;
			collect(index.folders[position] ?? "", "dir");
			taken += 1;
			if (taken >= budget) return true;
		}
		return true;
	};
	const complete = scan(false);
	if ((!complete || hits.length < input.limit) && !(input.deadline?.expired() ?? false)) {
		scan(true, PATH_LOOSE_CANDIDATES);
	}
	hits.sort(compareEntries);
	return hits.slice(0, input.limit);
}
