import { useTranslation } from "react-i18next";
import { APP_ICON, APP_NAME } from "@/lib/core/branding";

export function WelcomeStep() {
	const { t } = useTranslation("onboarding");

	return (
		<div className="flex flex-col items-center gap-5 text-center">
			<img src={APP_ICON} alt="" aria-hidden className="size-24" />
			<div className="space-y-1.5">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("title", { appName: APP_NAME })}
				</h1>
				<p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
					{t("subtitle")}
				</p>
			</div>
		</div>
	);
}
