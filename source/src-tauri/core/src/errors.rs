use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("operation cancelled")]
    Cancelled,
    #[error("I/O error at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{0}")]
    Invalid(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("could not move to trash: {0}")]
    Trash(String),
    #[error("export failed: {0}")]
    Export(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;

impl CoreError {
    pub fn io(path: &Path, source: std::io::Error) -> Self {
        CoreError::Io { path: path.display().to_string(), source }
    }
}
