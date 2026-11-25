/// Repository serving channel changelogs, CLI archives and user feedback.
pub const RELEASE_REPO: &str = match option_env!("AGENTERO_RELEASE_REPO") {
    Some(repository) => repository,
    None => "YanleiZhao-lab/Agentero",
};
