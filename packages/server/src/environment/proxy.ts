import type {
	HostProxy,
	HostProxyIssueCode,
	HostProxyStatus,
	HostProxyUpdateResult,
} from "@thinkrail/contracts";
import { launchEnvKeys } from "@thinkrail/shared/shellEnv";
import { logger } from "../log";
import { loadHostProxy, saveHostProxy } from "../persistence";

const HTTP_PROXY = "HTTP_PROXY";
const HTTPS_PROXY = "HTTPS_PROXY";
const NO_PROXY = "NO_PROXY";

const log = logger("environment");

let applied: HostProxy = {};
let launchKeys: ReadonlySet<string> = new Set();
let platform: NodeJS.Platform = process.platform;

function nameKey(name: string): string {
	return platform === "win32" ? name.toUpperCase() : name;
}

function proxyIssue(proxy: HostProxy): HostProxyIssueCode | undefined {
	if (proxy.url === undefined) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(proxy.url);
	} catch {
		return "invalidUrl";
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "unsupportedScheme";
	return undefined;
}

function parseHostProxy(value: unknown): HostProxy {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid proxy record");
	}
	const { url, noProxy } = value as Record<string, unknown>;
	if (url !== undefined && typeof url !== "string") throw new Error("Invalid proxy record");
	if (noProxy !== undefined && typeof noProxy !== "string") throw new Error("Invalid proxy record");
	const trimmedUrl = url?.trim() ?? "";
	const trimmedNoProxy = noProxy?.trim() ?? "";
	return {
		...(trimmedUrl.length > 0 ? { url: trimmedUrl } : {}),
		...(trimmedNoProxy.length > 0 ? { noProxy: trimmedNoProxy } : {}),
	};
}

function sameProxy(a: HostProxy, b: HostProxy): boolean {
	return a.url === b.url && a.noProxy === b.noProxy;
}

function proxyOverrideNames(proxy: HostProxy): string[] {
	const names =
		proxy.url === undefined ? [] : [HTTP_PROXY, HTTPS_PROXY, ...(proxy.noProxy ? [NO_PROXY] : [])];
	return names.filter((name) => launchKeys.has(nameKey(name)));
}

/** Bun reads the proxy variables on every `fetch`, so boot only has to put them into the environment. */
export function applyHostProxy(options: { platform?: NodeJS.Platform } = {}): void {
	platform = options.platform ?? process.platform;
	const stored = loadHostProxy();
	applied = stored;
	launchKeys = new Set([...launchEnvKeys()].map(nameKey));
	const issue = proxyIssue(stored);
	if (issue) {
		log.warn(`stored proxy skipped: ${issue}`);
		return;
	}
	if (stored.url === undefined || launchKeys.has(nameKey(HTTPS_PROXY))) return;
	process.env[HTTPS_PROXY] = stored.url;
	if (!launchKeys.has(nameKey(HTTP_PROXY))) process.env[HTTP_PROXY] = stored.url;
	if (stored.noProxy && !launchKeys.has(nameKey(NO_PROXY))) process.env[NO_PROXY] = stored.noProxy;
}

export function hostProxyStatus(): HostProxyStatus {
	const stored = loadHostProxy();
	return {
		stored,
		restartRequired: !sameProxy(stored, applied),
		launchOverridden: proxyOverrideNames(stored),
		effective: {
			...(process.env[HTTP_PROXY] ? { httpProxy: process.env[HTTP_PROXY] } : {}),
			...(process.env[HTTPS_PROXY] ? { httpsProxy: process.env[HTTPS_PROXY] } : {}),
			...(process.env[NO_PROXY] ? { noProxy: process.env[NO_PROXY] } : {}),
		},
	};
}

export function updateHostProxy(value: unknown): HostProxyUpdateResult {
	const proxy = parseHostProxy(value);
	const code = proxyIssue(proxy);
	if (code) return { ok: false, code };
	saveHostProxy(proxy);
	return { ok: true, status: hostProxyStatus() };
}
