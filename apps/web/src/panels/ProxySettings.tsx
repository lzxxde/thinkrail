import type { HostProxyIssueCode, HostProxyStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { getTransport } from "@/transport";
import {
	draftFromProxy,
	EMPTY_PROXY_DRAFT,
	type ProxyDraft,
	proxyDraftChanged,
	proxyFromDraft,
} from "./proxyDraft";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

const INPUT_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default placeholder:text-text-muted focus-visible:border-control-border-active focus-visible:focus-ring";

const URL_PLACEHOLDER = "http://127.0.0.1:7890";
const NO_PROXY_PLACEHOLDER = "localhost,127.0.0.1";

const ISSUE_TEXT: Record<HostProxyIssueCode, MessageKey> = {
	invalidUrl: "settings.proxy.issue.invalidUrl",
	unsupportedScheme: "settings.proxy.issue.unsupportedScheme",
};

export interface ProxyFormProps {
	status: HostProxyStatus | "loading" | "failed";
	draft: ProxyDraft;
	issue: HostProxyIssueCode | undefined;
	saving: boolean;
	saveFailed: boolean;
	onChange: (draft: ProxyDraft) => void;
	onSave: () => void;
	onDiscard: () => void;
}

export function ProxyForm({
	status,
	draft,
	issue,
	saving,
	saveFailed,
	onChange,
	onSave,
	onDiscard,
}: ProxyFormProps) {
	const t = useT();
	if (status === "loading") return null;
	if (status === "failed") {
		return (
			<SettingsNotice variant="error" testId="settings-proxy-failed">
				<p>{t("settings.proxy.loadFailed")}</p>
			</SettingsNotice>
		);
	}
	const changed = proxyDraftChanged(draft, status);
	const effective = status.effective.httpsProxy;

	return (
		<div data-testid="settings-proxy" className="flex flex-col gap-16">
			<SettingsGroup
				title={t("settings.proxy.title")}
				description={t("settings.proxy.description")}
			>
				<fieldset
					disabled={saving}
					data-testid="settings-proxy-form"
					className="flex min-w-0 flex-col gap-16 px-12 py-12"
				>
					{status.restartRequired ? (
						<SettingsNotice variant="warning" testId="settings-proxy-restart">
							<p>{t("settings.proxy.restartRequired")}</p>
						</SettingsNotice>
					) : null}

					{status.launchOverridden.length > 0 ? (
						<SettingsNotice variant="warning" testId="settings-proxy-launch-overridden">
							<p>
								{t("settings.proxy.launchOverridden", {
									names: status.launchOverridden.join(", "),
								})}
							</p>
						</SettingsNotice>
					) : null}

					<div className="flex flex-col gap-4">
						<label htmlFor="settings-proxy-url" className="tr-text-ui text-text-default">
							{t("settings.proxy.url.label")}
						</label>
						<input
							id="settings-proxy-url"
							data-testid="settings-proxy-url"
							data-settings-draft-input
							aria-invalid={issue !== undefined}
							placeholder={URL_PLACEHOLDER}
							value={draft.url}
							onChange={(event) => onChange({ ...draft, url: event.currentTarget.value })}
							className={cn(INPUT_CLASS, issue && "border-feedback-error")}
						/>
						{issue ? (
							<p
								data-testid="settings-proxy-issue"
								className="tr-text-metadata text-feedback-error"
							>
								{t(ISSUE_TEXT[issue])}
							</p>
						) : null}
						<p className="tr-text-metadata text-text-muted">{t("settings.proxy.url.hint")}</p>
					</div>

					<div className="flex flex-col gap-4">
						<label htmlFor="settings-proxy-no-proxy" className="tr-text-ui text-text-default">
							{t("settings.proxy.noProxy.label")}
						</label>
						<input
							id="settings-proxy-no-proxy"
							data-testid="settings-proxy-no-proxy"
							data-settings-draft-input
							placeholder={NO_PROXY_PLACEHOLDER}
							value={draft.noProxy}
							onChange={(event) => onChange({ ...draft, noProxy: event.currentTarget.value })}
							className={INPUT_CLASS}
						/>
						<p className="tr-text-metadata text-text-muted">{t("settings.proxy.noProxy.hint")}</p>
					</div>

					{effective ? (
						<p className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted">
							<span className="shrink-0">{t("settings.proxy.effective")}</span>
							<code
								data-testid="settings-proxy-effective"
								className="min-w-0 truncate tr-code-text"
							>
								{effective}
							</code>
						</p>
					) : null}

					{saveFailed ? (
						<SettingsNotice variant="error" testId="settings-proxy-save-failed">
							<p>{t("settings.proxy.saveFailed")}</p>
						</SettingsNotice>
					) : null}

					<div className="flex justify-end gap-8">
						<Button
							variant="outline"
							data-testid="settings-proxy-discard"
							disabled={!changed || saving}
							onClick={onDiscard}
						>
							{t("settings.environment.discard")}
						</Button>
						<Button
							data-testid="settings-proxy-save"
							disabled={!changed || saving}
							onClick={onSave}
						>
							{t("common.save")}
						</Button>
					</div>
				</fieldset>
			</SettingsGroup>
		</div>
	);
}

export function ProxySettings() {
	const [status, setStatus] = useState<HostProxyStatus | "loading" | "failed">("loading");
	const [draft, setDraft] = useState<ProxyDraft>(EMPTY_PROXY_DRAFT);
	const [issue, setIssue] = useState<HostProxyIssueCode | undefined>(undefined);
	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);

	const adopt = (next: HostProxyStatus) => {
		setStatus(next);
		setDraft(draftFromProxy(next.stored));
		setIssue(undefined);
	};

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("proxy.get", {})
			.then((next) => {
				if (!cancelled) adopt(next);
			})
			.catch(() => !cancelled && setStatus("failed"));
		return () => {
			cancelled = true;
		};
	}, []);

	const save = () => {
		setSaving(true);
		setSaveFailed(false);
		getTransport()
			.request("proxy.update", { proxy: proxyFromDraft(draft) })
			.then((result) => {
				if (result.ok) adopt(result.status);
				else setIssue(result.code);
			})
			.catch(() => setSaveFailed(true))
			.finally(() => setSaving(false));
	};

	return (
		<ProxyForm
			status={status}
			draft={draft}
			issue={issue}
			saving={saving}
			saveFailed={saveFailed}
			onChange={(next) => {
				setDraft(next);
				setIssue(undefined);
			}}
			onSave={save}
			onDiscard={() => {
				if (typeof status === "object") adopt(status);
			}}
		/>
	);
}
