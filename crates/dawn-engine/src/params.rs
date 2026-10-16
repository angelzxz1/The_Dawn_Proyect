//! Effect parameters as the studio keeps them: a value per key, like the
//! web app's `Record<string, number>` (the keys in each effect's
//! `index.ts`).

use std::collections::{BTreeMap, HashMap};
use std::hash::BuildHasher;

/// Somewhere an effect's parameter values can be looked up by key.
pub trait ParamSource {
    /// The value of `key`, if it's set.
    fn param(&self, key: &str) -> Option<f64>;

    /// The value of `key`, or `default` when it isn't set.
    fn param_or(&self, key: &str, default: f64) -> f64 {
        self.param(key).unwrap_or(default)
    }
}

impl<S: BuildHasher> ParamSource for HashMap<String, f64, S> {
    fn param(&self, key: &str) -> Option<f64> {
        self.get(key).copied()
    }
}

impl ParamSource for BTreeMap<String, f64> {
    fn param(&self, key: &str) -> Option<f64> {
        self.get(key).copied()
    }
}

impl ParamSource for [(&str, f64)] {
    fn param(&self, key: &str) -> Option<f64> {
        self.iter().find(|(k, _)| *k == key).map(|&(_, v)| v)
    }
}

impl<const N: usize> ParamSource for [(&str, f64); N] {
    fn param(&self, key: &str) -> Option<f64> {
        self.as_slice().param(key)
    }
}
