//! DiskPulse Pro core engine.
//!
//! This crate contains every piece of logic that does not need a GUI: the
//! parallel scanner, the in-memory scan tree, storage analysis, the squarified
//! treemap layout, duplicate detection, report export and safe file operations.
//! It is deliberately independent of Tauri so it can be unit-tested anywhere.

pub mod duplicates;
pub mod errors;
pub mod exporter;
pub mod filesystem;
pub mod models;
pub mod persist;
pub mod scanner;
pub mod storage;
pub mod tree;
pub mod treemap;

pub use errors::{CoreError, Result};
