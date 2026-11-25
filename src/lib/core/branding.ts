import appIcon from "@/assets/agenteroz-icon.svg";
import channel from "../../../research-channel.json";

export const APP_NAME = channel.displayName;
export const APP_SHORT_NAME = channel.shortName;
export const APP_ICON = appIcon;
export const APP_REPOSITORY =
	import.meta.env.VITE_AGENTERO_RELEASE_REPO || channel.repository;
export const APP_REPOSITORY_URL = `https://github.com/${APP_REPOSITORY}`;
export const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues/new`;
export const APP_UPSTREAM_URL = `https://github.com/${channel.upstreamRepository}`;
