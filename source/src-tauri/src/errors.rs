use diskpulse_core::CoreError;
use serde::{Serialize, Serializer};

/// Error type returned to the UI: always a plain, human-readable sentence.
#[derive(Debug)]
pub struct CommandError(pub String);

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        CommandError(error.to_string())
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        CommandError(message.to_string())
    }
}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        CommandError(message)
    }
}

pub type CmdResult<T> = Result<T, CommandError>;
