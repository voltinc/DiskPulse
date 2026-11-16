//! The canonical scan result. It lives in Rust and is queried in small pages.

use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;
use std::path::PathBuf;

use crate::errors::{CoreError, Result};
use crate::models::*;
use crate::storage::{self, CATEGORY_COUNT};

pub struct ScanTree {
    pub root_path: PathBuf,
    pub nodes: Vec<Node>,
    /// CSR adjacency: children of `i` are `child_ids[child_start[i]..child_start[i + 1]]`,
    /// pre-sorted by logical size (largest first).
    child_start: Vec<u32>,
    child_ids: Vec<u32>,
    child_counts: Vec<u32>,
    pub started_at: i64,
    pub duration_ms: u64,
    pub issues: Vec<ScanIssue>,
    pub errors_count: u64,
    pub stayed_on_filesystem: bool,
}

fn cmp_ci(a: &str, b: &str) -> Ordering {
    a.chars().flat_map(char::to_lowercase).cmp(b.chars().flat_map(char::to_lowercase))
}

impl ScanTree {
    /// Build the tree from raw nodes. `nodes[0]` must be the root; every parent id must be
    /// smaller than the ids of its children (guaranteed by the scanner's id allocation).
    pub fn from_nodes(root_path: PathBuf, mut nodes: Vec<Node>) -> ScanTree {
        let n = nodes.len();

        // Roll sizes and counts up from the leaves; children always have larger ids than parents.
        let mut dir_idx = vec![u32::MAX; n];
        let mut dir_total = 0usize;
        for (i, nd) in nodes.iter().enumerate() {
            if nd.kind == NodeKind::Directory {
                dir_idx[i] = dir_total as u32;
                dir_total += 1;
            }
        }
        let mut acc: Vec<[u64; CATEGORY_COUNT]> = vec![[0; CATEGORY_COUNT]; dir_total];
        for i in (1..n).rev() {
            let parent = nodes[i].parent as usize;
            if parent >= n {
                continue;
            }
            let (size, allocated, fc, dc, kind) = {
                let nd = &nodes[i];
                (nd.size, nd.allocated, nd.file_count, nd.dir_count, nd.kind)
            };
            let pidx = dir_idx[parent] as usize;
            match kind {
                NodeKind::File => {
                    let cat = storage::category_of(storage::extension_of(&nodes[i].name)) as usize;
                    if let Some(slot) = acc.get_mut(pidx) {
                        slot[cat] += size;
                    }
                }
                NodeKind::Directory => {
                    let cidx = dir_idx[i] as usize;
                    let child_acc = acc[cidx];
                    nodes[i].dominant = argmax(&child_acc);
                    if let Some(slot) = acc.get_mut(pidx) {
                        for k in 0..CATEGORY_COUNT {
                            slot[k] += child_acc[k];
                        }
                    }
                }
            }
            let p = &mut nodes[parent];
            p.size += size;
            p.allocated += allocated;
            p.file_count += fc;
            p.dir_count += dc + u32::from(kind == NodeKind::Directory);
        }
        if let Some(first) = acc.first() {
            if n > 0 {
                nodes[0].dominant = argmax(first);
            }
        }

        // Children in CSR layout.
        let mut child_counts = vec![0u32; n];
        for nd in nodes.iter().skip(1) {
            if (nd.parent as usize) < n {
                child_counts[nd.parent as usize] += 1;
            }
        }
        let mut child_start = vec![0u32; n + 1];
        for i in 0..n {
            child_start[i + 1] = child_start[i] + child_counts[i];
        }
        let mut cursor: Vec<u32> = child_start[..n].to_vec();
        let mut child_ids = vec![0u32; child_start[n] as usize];
        for (i, nd) in nodes.iter().enumerate().skip(1) {
            let p = nd.parent as usize;
            if p < n {
                child_ids[cursor[p] as usize] = i as u32;
                cursor[p] += 1;
            }
        }
        for p in 0..n {
            let (s, e) = (child_start[p] as usize, child_start[p + 1] as usize);
            if e - s > 1 {
                child_ids[s..e].sort_unstable_by(|&a, &b| {
                    let (na, nb) = (&nodes[a as usize], &nodes[b as usize]);
                    nb.size.cmp(&na.size).then_with(|| na.name.cmp(&nb.name))
                });
            }
        }

        ScanTree {
            root_path,
            nodes,
            child_start,
            child_ids,
            child_counts,
            started_at: 0,
            duration_ms: 0,
            issues: Vec::new(),
            errors_count: 0,
            stayed_on_filesystem: true,
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Checked lookup for ids that come from outside (the UI).
    pub fn get(&self, id: u32) -> Option<&Node> {
        self.nodes.get(id as usize).filter(|n| !n.is_removed())
    }

    /// Unchecked lookup for ids that were produced by this tree.
    pub fn node(&self, id: u32) -> &Node {
        &self.nodes[id as usize]
    }

    pub fn raw_children(&self, id: u32) -> &[u32] {
        let (s, e) = (self.child_start[id as usize] as usize, self.child_start[id as usize + 1] as usize);
        &self.child_ids[s..e]
    }

    pub fn live_children(&self, id: u32) -> impl Iterator<Item = u32> + '_ {
        self.raw_children(id).iter().copied().filter(move |&c| !self.nodes[c as usize].is_removed())
    }

    pub fn path_of(&self, id: u32) -> PathBuf {
        let mut parts: Vec<&str> = Vec::new();
        let mut cur = id;
        while cur != 0 && cur != NO_PARENT {
            let n = &self.nodes[cur as usize];
            parts.push(&n.name);
            cur = n.parent;
        }
        let mut p = self.root_path.clone();
        for part in parts.iter().rev() {
            p.push(part);
        }
        p
    }

    pub fn relative_path_of(&self, id: u32) -> String {
        let mut parts: Vec<&str> = Vec::new();
        let mut cur = id;
        while cur != 0 && cur != NO_PARENT {
            let n = &self.nodes[cur as usize];
            parts.push(&n.name);
            cur = n.parent;
        }
        parts.reverse();
        parts.join(std::path::MAIN_SEPARATOR_STR)
    }

    /// Root-to-node chain (inclusive), used for breadcrumbs.
    pub fn ancestors(&self, id: u32) -> Vec<u32> {
        let mut chain = vec![id];
        let mut cur = self.nodes[id as usize].parent;
        while cur != NO_PARENT {
            chain.push(cur);
            cur = self.nodes[cur as usize].parent;
        }
        chain.reverse();
        chain
    }

    pub fn is_in_subtree(&self, id: u32, ancestor: u32) -> bool {
        let mut cur = id;
        while cur != NO_PARENT {
            if cur == ancestor {
                return true;
            }
            cur = self.nodes[cur as usize].parent;
        }
        false
    }

    pub fn summary(&self, id: u32) -> NodeSummary {
        let n = self.node(id);
        let ext = if n.kind == NodeKind::File {
            storage::extension_of(&n.name).map(|e| e.to_ascii_lowercase())
        } else {
            None
        };
        let category = match n.kind {
            NodeKind::File => storage::category_of(storage::extension_of(&n.name)),
            NodeKind::Directory => n.dominant,
        };
        let percent = if n.parent == NO_PARENT {
            100.0
        } else {
            let p = self.node(n.parent);
            if p.size == 0 {
                0.0
            } else {
                (n.size as f64 / p.size as f64 * 100.0) as f32
            }
        };
        NodeSummary {
            id,
            parent_id: (n.parent != NO_PARENT).then_some(n.parent),
            name: n.name.to_string(),
            path: self.path_of(id).display().to_string(),
            relative_path: self.relative_path_of(id),
            kind: n.kind,
            size: n.size,
            allocated: n.allocated,
            file_count: n.file_count,
            dir_count: n.dir_count,
            modified: (n.modified != 0).then_some(n.modified),
            extension: ext,
            category,
            is_symlink: n.is_symlink(),
            accessible: n.is_accessible(),
            child_count: self.child_counts[id as usize],
            percent_of_parent: percent,
        }
    }

    pub fn children_page(
        &self,
        id: u32,
        offset: usize,
        limit: usize,
        key: SortKey,
        dir: SortDir,
        filter: Option<&str>,
    ) -> Result<ChildrenPage> {
        self.get(id).ok_or_else(|| CoreError::NotFound(format!("node {id}")))?;
        let mut ids: Vec<u32> = self.live_children(id).collect();
        if let Some(f) = filter.map(str::trim).filter(|f| !f.is_empty()) {
            let needle = f.to_lowercase();
            ids.retain(|&c| self.nodes[c as usize].name.to_lowercase().contains(&needle));
        }
        // The stored order is already "size, descending".
        if !(key == SortKey::Size && dir == SortDir::Desc) {
            ids.sort_by(|&a, &b| {
                let (x, y) = (&self.nodes[a as usize], &self.nodes[b as usize]);
                let ord = match key {
                    SortKey::Name => cmp_ci(&x.name, &y.name),
                    SortKey::Type => {
                        let kx = (x.kind == NodeKind::File, storage::extension_of(&x.name).unwrap_or(""));
                        let ky = (y.kind == NodeKind::File, storage::extension_of(&y.name).unwrap_or(""));
                        kx.0.cmp(&ky.0).then_with(|| cmp_ci(kx.1, ky.1))
                    }
                    SortKey::Size => x.size.cmp(&y.size),
                    SortKey::Allocated => x.allocated.cmp(&y.allocated),
                    SortKey::Files => x.file_count.cmp(&y.file_count),
                    SortKey::Modified => x.modified.cmp(&y.modified),
                };
                let ord = if dir == SortDir::Desc { ord.reverse() } else { ord };
                ord.then_with(|| cmp_ci(&x.name, &y.name))
            });
        }
        let total = ids.len() as u32;
        let items = ids.into_iter().skip(offset).take(limit).map(|c| self.summary(c)).collect();
        Ok(ChildrenPage { total, items })
    }

    /// All live file ids below `scope` (whole scan when `None` or the root).
    pub fn file_ids(&self, scope: Option<u32>) -> Vec<u32> {
        match scope {
            None | Some(0) => (1..self.nodes.len() as u32)
                .filter(|&i| {
                    let n = &self.nodes[i as usize];
                    n.kind == NodeKind::File && !n.is_removed()
                })
                .collect(),
            Some(dir) => {
                let Some(start) = self.get(dir) else { return Vec::new() };
                if start.kind == NodeKind::File {
                    return vec![dir];
                }
                let mut out = Vec::new();
                let mut stack = vec![dir];
                while let Some(cur) = stack.pop() {
                    for c in self.live_children(cur) {
                        if self.nodes[c as usize].kind == NodeKind::File {
                            out.push(c);
                        } else {
                            stack.push(c);
                        }
                    }
                }
                out
            }
        }
    }

    fn descendant_ids(&self, scope: Option<u32>) -> Vec<u32> {
        match scope {
            None | Some(0) => (1..self.nodes.len() as u32).filter(|&i| !self.nodes[i as usize].is_removed()).collect(),
            Some(dir) => {
                let mut out = Vec::new();
                let mut stack = vec![dir];
                while let Some(cur) = stack.pop() {
                    for c in self.live_children(cur) {
                        out.push(c);
                        if self.nodes[c as usize].kind == NodeKind::Directory {
                            stack.push(c);
                        }
                    }
                }
                out
            }
        }
    }

    /// Bounded top-K by logical size; never sorts the full file list.
    pub fn largest_files(&self, scope: Option<u32>, k: usize) -> Vec<u32> {
        let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::with_capacity(k + 1);
        for id in self.file_ids(scope) {
            heap.push(Reverse((self.nodes[id as usize].size, id)));
            if heap.len() > k {
                heap.pop();
            }
        }
        let mut out: Vec<(u64, u32)> = heap.into_iter().map(|Reverse(x)| x).collect();
        out.sort_by(|a, b| b.cmp(a));
        out.into_iter().map(|(_, id)| id).collect()
    }

    /// Case-insensitive name search over files and folders, largest matches first.
    pub fn search(&self, query: &str, scope: Option<u32>, limit: usize) -> Vec<u32> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::with_capacity(limit + 1);
        for id in self.descendant_ids(scope) {
            let n = &self.nodes[id as usize];
            if n.name.to_lowercase().contains(&needle) {
                heap.push(Reverse((n.size, id)));
                if heap.len() > limit {
                    heap.pop();
                }
            }
        }
        let mut out: Vec<(u64, u32)> = heap.into_iter().map(|Reverse(x)| x).collect();
        out.sort_by(|a, b| b.cmp(a));
        out.into_iter().map(|(_, id)| id).collect()
    }

    /// Remove a node (and its subtree) from the in-memory result after it was trashed.
    /// Returns the logical and allocated bytes that were released.
    pub fn remove_node(&mut self, id: u32) -> Result<(u64, u64)> {
        if id == 0 {
            return Err(CoreError::Invalid("the scan root cannot be removed".into()));
        }
        let Some(n) = self.get(id) else {
            return Err(CoreError::NotFound(format!("node {id}")));
        };
        let (size, allocated, fc, dc, kind, parent) =
            (n.size, n.allocated, n.file_count, n.dir_count, n.kind, n.parent);
        let dir_inc = u32::from(kind == NodeKind::Directory);
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            self.nodes[cur as usize].flags |= FLAG_REMOVED;
            if self.nodes[cur as usize].kind == NodeKind::Directory {
                let (s, e) = (self.child_start[cur as usize] as usize, self.child_start[cur as usize + 1] as usize);
                stack.extend_from_slice(&self.child_ids[s..e]);
            }
        }
        let mut cur = parent;
        while cur != NO_PARENT {
            let a = &mut self.nodes[cur as usize];
            a.size = a.size.saturating_sub(size);
            a.allocated = a.allocated.saturating_sub(allocated);
            a.file_count = a.file_count.saturating_sub(fc);
            a.dir_count = a.dir_count.saturating_sub(dc + dir_inc);
            cur = a.parent;
        }
        if parent != NO_PARENT {
            let c = &mut self.child_counts[parent as usize];
            *c = c.saturating_sub(1);
        }
        Ok((size, allocated))
    }
}

fn argmax(values: &[u64; CATEGORY_COUNT]) -> u8 {
    let mut best = storage::OTHER as usize;
    let mut best_val = 0u64;
    for (i, &v) in values.iter().enumerate() {
        if v > best_val {
            best = i;
            best_val = v;
        }
    }
    best as u8
}
