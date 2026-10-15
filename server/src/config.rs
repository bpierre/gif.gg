use std::{collections::HashMap, path::PathBuf};

#[derive(Clone, Debug)]
pub struct Config {
    pub data_dir: PathBuf,
    pub database_path: PathBuf,
    pub gifs_dir: PathBuf,
    pub debug: bool,
    pub version: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::load(&std::env::vars().collect())
    }

    pub fn load(env: &HashMap<String, String>) -> Result<Self, String> {
        let configured = env
            .get("DATA_DIR")
            .map(|v| v.trim())
            .filter(|v| !v.is_empty());
        let production = env.get("NODE_ENV").is_some_and(|v| v == "production");
        if production && configured.is_none() {
            return Err("DATA_DIR must point to gif.gg's persistent data directory".into());
        }
        let path = configured
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("gifgg-development"));
        let data_dir = std::path::absolute(path).map_err(|error| error.to_string())?;
        Ok(Self {
            database_path: data_dir.join("gifgg.sqlite"),
            gifs_dir: data_dir.join("gifs"),
            data_dir,
            debug: !production,
            version: env
                .get("APP_VERSION")
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
                .unwrap_or("1")
                .into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_contract() {
        let config = Config::load(&HashMap::new()).unwrap();
        assert_eq!(
            config.data_dir,
            std::env::temp_dir().join("gifgg-development")
        );
        assert!(config.debug);
        assert!(Config::load(&HashMap::from([("NODE_ENV".into(), "production".into())])).is_err());
        let config = Config::load(&HashMap::from([
            ("NODE_ENV".into(), "production".into()),
            ("DATA_DIR".into(), " ./persistent-data ".into()),
            ("APP_VERSION".into(), " release-42 ".into()),
        ]))
        .unwrap();
        assert_eq!(
            config.database_path,
            std::env::current_dir()
                .unwrap()
                .join("persistent-data/gifgg.sqlite")
        );
        assert_eq!(config.version, "release-42");
        assert!(!config.debug);
    }
}
