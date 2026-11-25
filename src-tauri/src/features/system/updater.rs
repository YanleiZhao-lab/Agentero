use crate::core::release::RELEASE_REPO;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::{Error, UpdaterExt};

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const CHANGELOG_MAX_BYTES: usize = 1024 * 1024;
const CHANGELOG_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const BUNDLED_CHANGELOG: &[u8] = include_bytes!("../../../../src/lib/update/changelog.json");
static CHANGELOG_REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChangelogRequest {
    Cached,
    Refresh,
    Force,
}

#[derive(Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Changelog {
    schema_version: u32,
    releases: Vec<ChangelogRelease>,
}

#[derive(Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct ChangelogRelease {
    tag: String,
    release_date: String,
    summary: Option<ChangelogSummary>,
}

#[derive(Deserialize, Serialize, specta::Type)]
struct ChangelogSummary {
    en: String,
    #[serde(rename = "zh-CN")]
    zh_cn: String,
}

fn parse_changelog(bytes: &[u8]) -> Option<Changelog> {
    let mut changelog: Changelog = serde_json::from_slice(bytes).ok()?;
    if changelog.schema_version != 1 || changelog.releases.is_empty() {
        return None;
    }
    let mut tags = HashSet::new();
    let mut versions = Vec::with_capacity(changelog.releases.len());
    for release in changelog.releases.drain(..) {
        let version = stable_version(&release.tag)?;
        let date = chrono::NaiveDate::parse_from_str(&release.release_date, "%Y-%m-%d").ok()?;
        if !tags.insert(version.clone())
            || date.format("%Y-%m-%d").to_string() != release.release_date
            || release.summary.as_ref().is_some_and(|summary| {
                summary.en.trim().is_empty() || summary.zh_cn.trim().is_empty()
            })
        {
            return None;
        }
        versions.push((version, release));
    }
    versions.sort_unstable_by(|left, right| right.0.cmp(&left.0));
    versions.first()?.1.summary.as_ref()?;
    changelog.releases = versions.into_iter().map(|(_, release)| release).collect();
    Some(changelog)
}

fn read_changelog(path: &Path) -> Option<Changelog> {
    let metadata = path.metadata().ok()?;
    if metadata.len() > CHANGELOG_MAX_BYTES as u64 {
        return None;
    }
    parse_changelog(&std::fs::read(path).ok()?)
}

async fn download_changelog_body(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if chunk.len() > CHANGELOG_MAX_BYTES - bytes.len() {
            return Err("Changelog response exceeds the size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn stable_version(tag: &str) -> Option<semver::Version> {
    let version = semver::Version::parse(tag.strip_prefix('v')?).ok()?;
    (version.pre.is_empty() && version.build.is_empty()).then_some(version)
}

fn latest_version(changelog: &Changelog) -> Option<semver::Version> {
    stable_version(&changelog.releases.first()?.tag)
}

async fn download_changelog(
    client: &reqwest::Client,
    minimum: Option<semver::Version>,
) -> Result<(Vec<u8>, Changelog), String> {
    let url = format!("https://github.com/{RELEASE_REPO}/releases/latest/download/changelog.json");
    let bytes = download_changelog_body(client, &url).await?;
    let changelog = parse_changelog(&bytes).ok_or("Invalid channel changelog")?;
    if latest_version(&changelog) < minimum {
        return Err("Channel changelog is older than the current history".into());
    }
    Ok((bytes, changelog))
}

#[tauri::command]
#[specta::specta]
pub async fn app_changelog(
    app: tauri::AppHandle,
    request: ChangelogRequest,
) -> Result<Option<Changelog>, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("changelog.json");
    let bundled_version = parse_changelog(BUNDLED_CHANGELOG)
        .as_ref()
        .and_then(latest_version);
    if matches!(request, ChangelogRequest::Cached) {
        return Ok(read_changelog(&path).filter(|data| latest_version(data) >= bundled_version));
    }

    let _refresh = CHANGELOG_REFRESH.lock().await;
    if matches!(request, ChangelogRequest::Refresh)
        && path
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age < CHANGELOG_TTL)
    {
        if let Some(changelog) =
            read_changelog(&path).filter(|data| latest_version(data) >= bundled_version)
        {
            return Ok(Some(changelog));
        }
    }

    let client =
        agentero_core::http::client(Duration::from_secs(5)).map_err(|error| error.to_string())?;
    let minimum = bundled_version.max(read_changelog(&path).as_ref().and_then(latest_version));
    let (bytes, changelog) = download_changelog(&client, minimum).await?;
    if let Some(directory) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(directory)
            .and_then(|()| agentero_core::fs::atomic_write(&path, &bytes))
        {
            log::warn!("Failed to cache changelog: {error}");
        }
    }
    Ok(Some(changelog))
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    rid: ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn app_update_check<R: Runtime>(
    webview: Webview<R>,
    proxy: Option<String>,
    retry_on_timeout: bool,
) -> Result<Option<AppUpdate>, String> {
    let mut builder = webview.updater_builder().timeout(CHECK_TIMEOUT);
    if let Some(proxy) = proxy {
        builder = builder.proxy(tauri::Url::parse(&proxy).map_err(|error| error.to_string())?);
    }
    let updater = builder.build().map_err(|error| error.to_string())?;

    // The plugin's IPC error string loses reqwest's timeout cause.
    let mut result = updater.check().await;
    if retry_on_timeout && matches!(&result, Err(Error::Reqwest(error)) if error.is_timeout()) {
        log::info!("updater_check timed out; retrying once");
        result = updater.check().await;
    }

    Ok(result.map_err(|error| error.to_string())?.map(|update| {
        let current_version = update.current_version.clone();
        let version = update.version.clone();
        let body = update.body.clone();
        // Register the same native resource consumed by the updater plugin's download and install.
        let rid = webview.resources_table().add(update);
        AppUpdate {
            rid,
            current_version,
            version,
            body,
        }
    }))
}
