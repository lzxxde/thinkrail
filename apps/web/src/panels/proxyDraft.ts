import type { HostProxy, HostProxyStatus } from "@thinkrail/contracts";

export interface ProxyDraft {
	url: string;
	noProxy: string;
}

export const EMPTY_PROXY_DRAFT: ProxyDraft = { url: "", noProxy: "" };

export function draftFromProxy(proxy: HostProxy): ProxyDraft {
	return { url: proxy.url ?? "", noProxy: proxy.noProxy ?? "" };
}

export function proxyFromDraft(draft: ProxyDraft): HostProxy {
	const url = draft.url.trim();
	const noProxy = draft.noProxy.trim();
	return {
		...(url ? { url } : {}),
		...(noProxy ? { noProxy } : {}),
	};
}

export function proxyDraftChanged(draft: ProxyDraft, status: HostProxyStatus): boolean {
	const next = proxyFromDraft(draft);
	return next.url !== status.stored.url || next.noProxy !== status.stored.noProxy;
}
