//! Batch processing helpers for the web side: the PDFs in a folder, and an
//! output name that never overwrites an existing file.

use std::fs;
use std::path::{Path, PathBuf};

/// Most files one batch takes from a folder (a mistaken pick of a whole
/// drive shouldn't list forever).
pub const MAX_FILES: usize = 5000;

fn is_pdf(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

fn hidden(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('~')
}

/// PDFs in `dir` (and its subfolders when `recursive`), sorted, skipping
/// hidden files/folders and Office lock files. Stops at MAX_FILES.
pub fn list_pdfs(dir: &Path, recursive: bool) -> Result<Vec<PathBuf>, String> {
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let entries = match fs::read_dir(&d) {
            Ok(e) => e,
            // The chosen folder must be readable; unreadable subfolders are skipped.
            Err(e) if d == dir => return Err(format!("can't read {}: {e}", d.display())),
            Err(_) => continue,
        };
        let mut sub = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if hidden(&name) {
                continue;
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if recursive {
                    sub.push(path);
                }
            } else if kind.is_file() && is_pdf(&path) {
                out.push(path);
                if out.len() >= MAX_FILES {
                    out.sort();
                    return Ok(out);
                }
            }
        }
        sub.sort();
        stack.extend(sub.into_iter().rev());
    }
    out.sort();
    Ok(out)
}

/// `path` if nothing is there yet, otherwise "name (2).ext", "name (3).ext"...
pub fn free_path(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Ok(path.to_path_buf());
    }
    let dir = path.parent().ok_or_else(|| format!("{} has no folder", path.display()))?;
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 2..10_000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!("too many files named like {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_pdfs_sorted_with_and_without_subfolders() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        fs::create_dir(d.join("sub")).unwrap();
        fs::create_dir(d.join(".hidden")).unwrap();
        for f in ["b.pdf", "a.PDF", "notes.txt", "~$lock.pdf", "sub/c.pdf", ".hidden/x.pdf"] {
            fs::write(d.join(f), b"x").unwrap();
        }
        let names = |v: Vec<PathBuf>| v.iter().map(|p| p.strip_prefix(d).unwrap().to_string_lossy().replace('\\', "/")).collect::<Vec<_>>();
        assert_eq!(names(list_pdfs(d, false).unwrap()), ["a.PDF", "b.pdf"]);
        assert_eq!(names(list_pdfs(d, true).unwrap()), ["a.PDF", "b.pdf", "sub/c.pdf"]);
        assert!(list_pdfs(&d.join("missing"), false).is_err());
    }

    #[test]
    fn free_path_never_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("report (batch).pdf");
        assert_eq!(free_path(&p).unwrap(), p);
        fs::write(&p, b"x").unwrap();
        assert_eq!(free_path(&p).unwrap(), tmp.path().join("report (batch) (2).pdf"));
        fs::write(tmp.path().join("report (batch) (2).pdf"), b"x").unwrap();
        assert_eq!(free_path(&p).unwrap(), tmp.path().join("report (batch) (3).pdf"));
    }
}
