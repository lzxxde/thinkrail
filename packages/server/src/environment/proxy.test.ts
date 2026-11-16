import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyHostProxy, hostProxyStatus, updateHostProxy } from "./index";

const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "https_proxy", "no_proxy"];
const originalDataDir = process.env.THINKRAIL_DATA_DIR;
const original = new Map(PROXY_VARS.map((name) => [name, process.env[name]]));
let dataDir: string;

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[Symbol.for("thinkrail.shellEnv.launchKeys")];
	for (const name of PROXY_VARS) delete process.env[name];
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-proxy-data-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	applyHostProxy();
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	for (const [name, value] of original) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	if (originalDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = originalDataDir;
});

test("a missing or malformed proxy URL is refused and nothing is saved", () => {
	expect(updateHostProxy({ url: "127.0.0.1:7890" })).toEqual({ ok: false, code: "invalidUrl" });
	expect(updateHostProxy({ url: "socks5://127.0.0.1:7891" })).toEqual({
		ok: false,
		code: "unsupportedScheme",
	});
	expect(updateHostProxy({ url: "http://" })).toEqual({ ok: false, code: "invalidUrl" });
	expect(hostProxyStatus().stored).toEqual({});
});

test("a saved proxy lands in the environment at boot and reports what is in effect", () => {
	expect(
		updateHostProxy({ url: "http://127.0.0.1:7890", noProxy: "localhost, 10.0.0.0/8" }),
	).toMatchObject({
		ok: true,
	});
	expect(process.env.HTTPS_PROXY).toBeUndefined();
	expect(hostProxyStatus().restartRequired).toBe(true);
	applyHostProxy();
	expect(process.env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
	expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
	expect(process.env.NO_PROXY).toBe("localhost, 10.0.0.0/8");
	const status = hostProxyStatus();
	expect(status.restartRequired).toBe(false);
	expect(status.launchOverridden).toEqual([]);
	expect(status.effective).toEqual({
		httpProxy: "http://127.0.0.1:7890",
		httpsProxy: "http://127.0.0.1:7890",
		noProxy: "localhost, 10.0.0.0/8",
	});
});

test("clearing the URL turns the proxy off after the next boot", () => {
	updateHostProxy({ url: "http://127.0.0.1:7890" });
	applyHostProxy();
	expect(updateHostProxy({})).toMatchObject({ ok: true });
	expect(hostProxyStatus().restartRequired).toBe(true);
});

test("a proxy set by the launching environment wins and is reported", () => {
	updateHostProxy({ url: "http://127.0.0.1:7890" });
	process.env.HTTPS_PROXY = "http://launch:1";
	applyHostProxy();
	expect(process.env.HTTPS_PROXY).toBe("http://launch:1");
	expect(process.env.HTTP_PROXY).toBeUndefined();
	const status = hostProxyStatus();
	expect(status.launchOverridden).toEqual(["HTTPS_PROXY"]);
	expect(status.restartRequired).toBe(false);
});

test("the stored record is a 0600 file next to the data dir", () => {
	updateHostProxy({ url: "http://127.0.0.1:7890" });
	const file = join(dataDir, "proxy.json");
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ url: "http://127.0.0.1:7890" });
	expect(statSync(file).mode & 0o777).toBe(0o600);
});
