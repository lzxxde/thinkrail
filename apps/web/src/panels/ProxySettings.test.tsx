import { expect, test } from "bun:test";
import type { HostProxyStatus } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { ProxyForm } from "./ProxySettings";
import { draftFromProxy, proxyDraftChanged, proxyFromDraft } from "./proxyDraft";

const STATUS: HostProxyStatus = {
	stored: { url: "http://127.0.0.1:7890", noProxy: "localhost" },
	restartRequired: false,
	launchOverridden: [],
	effective: { httpProxy: "http://127.0.0.1:7890", httpsProxy: "http://127.0.0.1:7890" },
};

const render = (
	status: Parameters<typeof ProxyForm>[0]["status"],
	draft: Parameters<typeof ProxyForm>[0]["draft"] = typeof status === "object"
		? draftFromProxy(status.stored)
		: { url: "", noProxy: "" },
	issue?: Parameters<typeof ProxyForm>[0]["issue"],
) =>
	renderToStaticMarkup(
		<TooltipProvider>
			<ProxyForm
				status={status}
				draft={draft}
				issue={issue}
				saving={false}
				saveFailed={false}
				onChange={() => {}}
				onSave={() => {}}
				onDiscard={() => {}}
			/>
		</TooltipProvider>,
	);

test("renders the stored proxy and what the host is actually using", () => {
	const markup = render(STATUS);
	expect(markup).toContain('value="http://127.0.0.1:7890"');
	expect(markup).toContain('value="localhost"');
	expect(markup).toContain("http://127.0.0.1:7890");
	expect(markup).not.toContain('data-testid="settings-proxy-restart"');
	expect(markup).toMatch(/data-testid="settings-proxy-save"[^>]*disabled/);
});

test("a pending restart and a launch override are shown", () => {
	const markup = render({ ...STATUS, restartRequired: true, launchOverridden: ["HTTPS_PROXY"] });
	expect(markup).toContain('data-testid="settings-proxy-restart"');
	expect(markup).toContain('data-testid="settings-proxy-launch-overridden"');
	expect(markup).toContain("HTTPS_PROXY");
});

test("an issue renders under the proxy address", () => {
	const markup = render(
		STATUS,
		{ url: "socks5://127.0.0.1:7891", noProxy: "" },
		"unsupportedScheme",
	);
	expect(markup).toContain('data-testid="settings-proxy-issue"');
	expect(markup).toContain("Only http:// proxies are supported");
	expect(markup).toMatch(/aria-invalid="true"/);
});

test("the draft drops blank fields and reports changes against the stored record", () => {
	expect(proxyFromDraft({ url: "  ", noProxy: " " })).toEqual({});
	expect(proxyFromDraft({ url: " http://h:1 ", noProxy: " localhost " })).toEqual({
		url: "http://h:1",
		noProxy: "localhost",
	});
	expect(proxyDraftChanged(draftFromProxy(STATUS.stored), STATUS)).toBe(false);
	expect(proxyDraftChanged({ url: "", noProxy: "localhost" }, STATUS)).toBe(true);
});
