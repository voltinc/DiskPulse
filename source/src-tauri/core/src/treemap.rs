//! Squarified treemap layout (Bruls, Huizing, van Wijk). Pure geometry: the UI only draws rectangles.

use serde::{Deserialize, Serialize};

use crate::errors::{CoreError, Result};
use crate::models::NodeKind;
use crate::storage;
use crate::tree::ScanTree;

const HEADER_HEIGHT: f32 = 18.0;
const MAX_ITEMS_PER_LEVEL: usize = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    Logical,
    Allocated,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreemapRect {
    pub id: u32,
    pub name: String,
    pub kind: NodeKind,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// 1 = direct child of the viewed folder.
    pub depth: u8,
    pub size: u64,
    pub allocated: u64,
    /// Share of the viewed folder, 0-100, using the requested metric.
    pub percent: f32,
    pub category: u8,
    /// Index of the depth-1 ancestor among its siblings; used for per-folder colouring.
    pub group: u32,
    pub file_count: u32,
    /// True when the rectangle contains nested rectangles and reserves a label strip at the top.
    pub header: bool,
}

fn worst(row: &[f64], scale: f64, sum: f64, side: f64) -> f64 {
    let (mut max, mut min) = (f64::MIN, f64::MAX);
    for &w in row {
        let a = w * scale;
        max = max.max(a);
        min = min.min(a);
    }
    let s2 = side * side;
    ((s2 * max) / (sum * sum)).max((sum * sum) / (s2 * min))
}

/// Lay out `weights` (descending, all > 0) inside `bounds`. `total` is the weight that fills the whole
/// rectangle, so a truncated list simply leaves the remainder empty.
pub fn squarify(weights: &[f64], total: f64, bounds: Rect) -> Vec<Rect> {
    let mut out = Vec::with_capacity(weights.len());
    if weights.is_empty() || total <= 0.0 || bounds.w <= 0.0 || bounds.h <= 0.0 {
        return out;
    }
    let scale = f64::from(bounds.w) * f64::from(bounds.h) / total;
    let (mut x, mut y, mut w, mut h) =
        (f64::from(bounds.x), f64::from(bounds.y), f64::from(bounds.w), f64::from(bounds.h));
    let mut i = 0;
    while i < weights.len() {
        let side = w.min(h);
        if side <= 0.0 {
            break;
        }
        let mut end = i + 1;
        let mut sum = weights[i] * scale;
        let mut best = worst(&weights[i..end], scale, sum, side);
        while end < weights.len() {
            let next_sum = sum + weights[end] * scale;
            let candidate = worst(&weights[i..=end], scale, next_sum, side);
            if candidate <= best {
                sum = next_sum;
                best = candidate;
                end += 1;
            } else {
                break;
            }
        }
        if w >= h {
            let col_w = sum / h;
            let mut cy = y;
            for &weight in &weights[i..end] {
                let item_h = weight * scale / col_w;
                out.push(Rect { x: x as f32, y: cy as f32, w: col_w as f32, h: item_h as f32 });
                cy += item_h;
            }
            x += col_w;
            w -= col_w;
        } else {
            let row_h = sum / w;
            let mut cx = x;
            for &weight in &weights[i..end] {
                let item_w = weight * scale / row_h;
                out.push(Rect { x: cx as f32, y: y as f32, w: item_w as f32, h: row_h as f32 });
                cx += item_w;
            }
            y += row_h;
            h -= row_h;
        }
        i = end;
    }
    out
}

fn weight(tree: &ScanTree, id: u32, metric: Metric) -> u64 {
    let n = tree.node(id);
    match metric {
        Metric::Logical => n.size,
        Metric::Allocated => n.allocated,
    }
}

struct Ctx<'a> {
    tree: &'a ScanTree,
    metric: Metric,
    max_depth: u8,
    view_total: f64,
}

fn place_children(ctx: &Ctx, parent: u32, bounds: Rect, depth: u8, group: u32, out: &mut Vec<TreemapRect>) {
    let mut items: Vec<(u32, u64)> =
        ctx.tree.live_children(parent).map(|c| (c, weight(ctx.tree, c, ctx.metric))).filter(|&(_, w)| w > 0).collect();
    items.sort_by_key(|item| std::cmp::Reverse(item.1));
    let level_total: f64 = items.iter().map(|&(_, w)| w as f64).sum();
    items.truncate(MAX_ITEMS_PER_LEVEL);
    let weights: Vec<f64> = items.iter().map(|&(_, w)| w as f64).collect();
    let rects = squarify(&weights, level_total, bounds);

    for (i, (&(id, w), rect)) in items.iter().zip(rects.iter()).enumerate() {
        if rect.w < 1.0 || rect.h < 1.0 {
            continue;
        }
        let node = ctx.tree.node(id);
        let g = if depth == 1 { i as u32 } else { group };
        let nests = node.kind == NodeKind::Directory
            && depth < ctx.max_depth
            && ctx.tree.live_children(id).next().is_some()
            && rect.w >= 60.0
            && rect.h >= HEADER_HEIGHT * 2.4;
        let category = match node.kind {
            NodeKind::File => storage::category_of(storage::extension_of(&node.name)),
            NodeKind::Directory => node.dominant,
        };
        out.push(TreemapRect {
            id,
            name: node.name.to_string(),
            kind: node.kind,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            depth,
            size: node.size,
            allocated: node.allocated,
            percent: if ctx.view_total > 0.0 { (w as f64 / ctx.view_total * 100.0) as f32 } else { 0.0 },
            category,
            group: g,
            file_count: node.file_count,
            header: nests,
        });
        if nests {
            let inner =
                Rect { x: rect.x + 2.0, y: rect.y + HEADER_HEIGHT, w: rect.w - 4.0, h: rect.h - HEADER_HEIGHT - 2.0 };
            place_children(ctx, id, inner, depth + 1, g, out);
        }
    }
}

/// Layout the children of `root` (and, up to `max_depth`, their children) into a `width` x `height` box.
/// Empty files and folders are skipped; rectangles thinner than one pixel are culled.
pub fn layout(
    tree: &ScanTree,
    root: u32,
    width: f32,
    height: f32,
    max_depth: u8,
    metric: Metric,
) -> Result<Vec<TreemapRect>> {
    if !width.is_finite() || !height.is_finite() || width < 1.0 || height < 1.0 {
        return Err(CoreError::Invalid("the treemap area must be at least 1x1 pixels".into()));
    }
    tree.get(root).ok_or_else(|| CoreError::NotFound(format!("node {root}")))?;
    let ctx = Ctx { tree, metric, max_depth: max_depth.clamp(1, 4), view_total: weight(tree, root, metric) as f64 };
    let mut out = Vec::new();
    place_children(&ctx, root, Rect { x: 0.0, y: 0.0, w: width, h: height }, 1, 0, &mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ScanOptions;
    use crate::scanner::scan;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn overlap(a: &Rect, b: &Rect) -> f32 {
        let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
        let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
        if w > 0.0 && h > 0.0 {
            w * h
        } else {
            0.0
        }
    }

    #[test]
    fn areas_are_proportional_inside_bounds_and_never_overlap() {
        let weights = [6.0, 6.0, 4.0, 3.0, 2.0, 2.0, 1.0];
        let bounds = Rect { x: 10.0, y: 20.0, w: 600.0, h: 400.0 };
        let rects = squarify(&weights, 24.0, bounds);
        assert_eq!(rects.len(), weights.len());
        let area = f64::from(bounds.w) * f64::from(bounds.h);
        for (r, w) in rects.iter().zip(weights) {
            let expected = w / 24.0 * area;
            let actual = f64::from(r.w) * f64::from(r.h);
            assert!((actual - expected).abs() / expected < 0.001, "{actual} vs {expected}");
            assert!(r.x >= bounds.x - 0.01 && r.y >= bounds.y - 0.01);
            assert!(r.x + r.w <= bounds.x + bounds.w + 0.01 && r.y + r.h <= bounds.y + bounds.h + 0.01);
        }
        for i in 0..rects.len() {
            for j in i + 1..rects.len() {
                assert!(overlap(&rects[i], &rects[j]) < 0.5, "{i} overlaps {j}");
            }
        }
    }

    #[test]
    fn degenerate_inputs_produce_no_rectangles() {
        let b = Rect { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        assert!(squarify(&[], 0.0, b).is_empty());
        assert!(squarify(&[1.0], 0.0, b).is_empty());
        assert!(squarify(&[1.0], 1.0, Rect { w: 0.0, ..b }).is_empty());
    }

    #[test]
    fn rectangles_stay_reasonably_square() {
        let weights: Vec<f64> = (1..=30).rev().map(f64::from).collect();
        let total: f64 = weights.iter().sum();
        let rects = squarify(&weights, total, Rect { x: 0.0, y: 0.0, w: 800.0, h: 500.0 });
        let worst_ratio = rects.iter().map(|r| (r.w / r.h).max(r.h / r.w)).fold(0.0f32, f32::max);
        assert!(worst_ratio < 6.0, "aspect ratio {worst_ratio}");
    }

    #[test]
    fn real_tree_layout_nests_children_and_skips_empty_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("big/inner")).unwrap();
        std::fs::create_dir_all(dir.path().join("empty")).unwrap();
        std::fs::write(dir.path().join("big/inner/a.bin"), vec![1u8; 60_000]).unwrap();
        std::fs::write(dir.path().join("big/b.bin"), vec![1u8; 30_000]).unwrap();
        std::fs::write(dir.path().join("c.bin"), vec![1u8; 10_000]).unwrap();
        let opts = ScanOptions { root: dir.path().to_path_buf(), threads: 2, cross_filesystems: true };
        let tree = scan(&opts, Arc::new(AtomicBool::new(false)), &|_| {}).unwrap();
        let rects = layout(&tree, 0, 800.0, 600.0, 2, Metric::Logical).unwrap();
        assert!(rects.iter().all(|r| r.name != "empty"));
        let big = rects.iter().find(|r| r.name == "big").unwrap();
        assert!(big.header && big.depth == 1);
        assert!((big.percent - 90.0).abs() < 0.1);
        let nested: Vec<_> = rects.iter().filter(|r| r.depth == 2).collect();
        assert!(!nested.is_empty());
        for r in nested {
            assert!(r.x >= big.x && r.y >= big.y + HEADER_HEIGHT - 0.01);
            assert!(r.x + r.w <= big.x + big.w + 0.01 && r.y + r.h <= big.y + big.h + 0.01);
            assert_eq!(r.group, big.group);
        }
        assert!(layout(&tree, 0, 0.0, 600.0, 2, Metric::Logical).is_err());
        assert!(layout(&tree, 9999, 100.0, 100.0, 1, Metric::Logical).is_err());
    }
}
