//! Reading and saving PDFs (and other documents) for the web side. Bytes
//! travel as raw IPC bodies, not JSON arrays, so a 100 MB file stays fast.
//! Saves go to a temporary file next to the target first and are then
//! renamed over it, so a crash never leaves half a PDF behind.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Largest file DeskFolio opens (keeps a mistaken pick of a huge file from
/// eating all memory).
pub const MAX_BYTES: u64 = 1_500_000_000;

pub fn read(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("can't open {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "{} is {:.1} GB; DeskFolio opens files up to {:.1} GB",
            path.display(),
            meta.len() as f64 / 1e9,
            MAX_BYTES as f64 / 1e9
        ));
    }
    fs::read(path).map_err(|e| format!("can't read {}: {e}", path.display()))
}

/// Write `data` to `path` safely: temp file in the same folder, flush, then
/// rename over the target.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .ok_or_else(|| format!("{} has no folder", path.display()))?;
    if !dir.is_dir() {
        return Err(format!("the folder {} doesn't exist", dir.display()));
    }
    let name = path
        .file_name()
        .ok_or_else(|| format!("{} has no file name", path.display()))?;
    let tmp: PathBuf = dir.join(format!(".{}.deskfolio-tmp", name.to_string_lossy()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("can't save {}: {e}", path.display()));
    }
    Ok(())
}

/// PDFs passed on the command line ("Open with DeskFolio", double-click,
/// drag onto the app icon).
pub fn paths_from_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_round_trip_and_no_temp_left() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("out.pdf");
        write_atomic(&p, b"%PDF-1.7 hello").unwrap();
        assert_eq!(read(&p).unwrap(), b"%PDF-1.7 hello");
        // Overwrite keeps working and leaves only the target.
        write_atomic(&p, b"%PDF-1.7 again").unwrap();
        assert_eq!(read(&p).unwrap(), b"%PDF-1.7 again");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn errors_are_plain_messages() {
        let d = tempfile::tempdir().unwrap();
        assert!(read(&d.path().join("missing.pdf")).unwrap_err().contains("can't open"));
        assert!(read(d.path()).unwrap_err().contains("not a file"));
        assert!(write_atomic(&d.path().join("nope").join("x.pdf"), b"x")
            .unwrap_err()
            .contains("doesn't exist"));
    }

    #[test]
    fn only_existing_files_from_args() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.pdf");
        fs::write(&p, b"x").unwrap();
        let args = vec![
            "deskfolio.exe".to_string(),
            "--flag".to_string(),
            p.to_string_lossy().into_owned(),
            d.path().join("gone.pdf").to_string_lossy().into_owned(),
        ];
        assert_eq!(paths_from_args(&args), vec![p]);
    }
}
