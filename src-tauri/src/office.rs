//! Word / Excel / PowerPoint (and OpenDocument) → PDF, using what the user
//! already has: Microsoft Office on Windows (through its own "Save as PDF"),
//! otherwise LibreOffice on any system. DeskFolio ships neither.
//!
//! The file path reaches PowerShell only through environment variables,
//! never inside the script text, so a strange file name can't run code.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Word,
    Excel,
    PowerPoint,
}

pub fn kind_of(path: &Path) -> Option<Kind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "doc" | "docx" | "docm" | "rtf" | "odt" | "txt" => Kind::Word,
        "xls" | "xlsx" | "xlsm" | "csv" | "ods" => Kind::Excel,
        "ppt" | "pptx" | "pptm" | "odp" => Kind::PowerPoint,
        _ => return None,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct Converters {
    /// Microsoft Office apps found (Windows only): "word", "excel", "powerpoint".
    pub office: Vec<String>,
    /// LibreOffice's soffice program, if found.
    pub libreoffice: Option<String>,
}

pub fn available() -> Converters {
    Converters {
        office: office_apps(),
        libreoffice: find_soffice().map(|p| p.display().to_string()),
    }
}

#[cfg(windows)]
fn office_apps() -> Vec<String> {
    // Registered COM servers: HKCR\Word.Application\CLSID etc.
    use std::os::windows::process::CommandExt;
    [
        ("word", "Word.Application"),
        ("excel", "Excel.Application"),
        ("powerpoint", "PowerPoint.Application"),
    ]
    .iter()
    .filter(|(_, prog)| {
        Command::new("reg")
            .args(["query", &format!("HKCR\\{prog}\\CLSID")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
    .map(|(name, _)| (*name).to_string())
    .collect()
}

#[cfg(not(windows))]
fn office_apps() -> Vec<String> {
    Vec::new()
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn find_soffice() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var) {
                candidates.push(
                    PathBuf::from(dir)
                        .join("LibreOffice")
                        .join("program")
                        .join("soffice.exe"),
                );
            }
        }
    } else if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from(
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        ));
    }
    let names: &[&str] = if cfg!(windows) {
        &["soffice.exe"]
    } else {
        &["soffice", "libreoffice"]
    };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for n in names {
                candidates.push(dir.join(n));
            }
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Wait for a child process, killing it after `limit`.
fn wait_limited(
    mut child: std::process::Child,
    limit: Duration,
) -> Result<std::process::Output, String> {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().map_err(|e| e.to_string()),
            Ok(None) if start.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "the converter took longer than {} seconds and was stopped",
                    limit.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

const LIMIT: Duration = Duration::from_secs(180);

#[cfg(windows)]
const OFFICE_PS: &str = r#"
$ErrorActionPreference = 'Stop'
$in = $env:DF_IN; $out = $env:DF_OUT
switch ($env:DF_KIND) {
  'word' {
    $app = New-Object -ComObject Word.Application
    try {
      $app.Visible = $false; $app.DisplayAlerts = 0
      $doc = $app.Documents.Open($in, $false, $true, $false)
      $doc.ExportAsFixedFormat($out, 17)
      $doc.Close(0)
    } finally { $app.Quit() }
  }
  'excel' {
    $app = New-Object -ComObject Excel.Application
    try {
      $app.Visible = $false; $app.DisplayAlerts = $false
      $book = $app.Workbooks.Open($in, 0, $true)
      $book.ExportAsFixedFormat(0, $out)
      $book.Close($false)
    } finally { $app.Quit() }
  }
  'powerpoint' {
    $app = New-Object -ComObject PowerPoint.Application
    try {
      $pres = $app.Presentations.Open($in, -1, 0, 0)
      $pres.SaveAs($out, 32)
      $pres.Close()
    } finally { $app.Quit() }
  }
}
"#;

/// The path with forward slashes turned into backslashes.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_path(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\")
}

#[cfg(windows)]
fn with_office(input: &Path, out: &Path, kind: Kind) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let k = match kind {
        Kind::Word => "word",
        Kind::Excel => "excel",
        Kind::PowerPoint => "powerpoint",
    };
    let child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            OFFICE_PS,
        ])
        // Word refuses "C:/x/y.docx": give Office plain backslash paths.
        .env("DF_IN", windows_path(input))
        .env("DF_OUT", windows_path(out))
        .env("DF_KIND", k)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("can't start PowerShell: {e}"))?;
    let o = wait_limited(child, LIMIT)?;
    if o.status.success() && out.is_file() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&o.stderr);
        let first = err
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("no details");
        Err(format!(
            "Microsoft Office couldn't convert it ({})",
            first.trim()
        ))
    }
}

fn with_libreoffice(soffice: &Path, input: &Path, work: &Path) -> Result<PathBuf, String> {
    // Own profile folder, so a LibreOffice window the user has open doesn't
    // block the conversion.
    let profile = work.join("lo-profile");
    let profile_url = format!(
        "file:///{}",
        profile
            .display()
            .to_string()
            .replace('\\', "/")
            .trim_start_matches('/')
    );
    let mut cmd = Command::new(soffice);
    cmd.arg(format!("-env:UserInstallation={profile_url}"))
        .args([
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
        ])
        .arg(work)
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("can't start LibreOffice: {e}"))?;
    let o = wait_limited(child, LIMIT)?;
    let stem = input.file_stem().ok_or("the file has no name")?;
    let out = work.join(stem).with_extension("pdf");
    if out.is_file() {
        Ok(out)
    } else {
        let err = String::from_utf8_lossy(&o.stderr);
        Err(format!(
            "LibreOffice couldn't convert it ({})",
            err.trim().lines().next().unwrap_or("no details")
        ))
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Convert an Office file to PDF and return the PDF bytes.
pub fn convert(input: &Path) -> Result<Vec<u8>, String> {
    let kind = kind_of(input)
        .ok_or("DeskFolio can convert Word, Excel, PowerPoint and OpenDocument files.")?;
    if !input.is_file() {
        return Err(format!("{} wasn't found.", input.display()));
    }
    let work = std::env::temp_dir().join(format!(
        "deskfolio-office-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&work).map_err(|e| format!("can't make a work folder: {e}"))?;
    let result = (|| {
        let mut errors = Vec::new();
        #[cfg(windows)]
        {
            let app = match kind {
                Kind::Word => "word",
                Kind::Excel => "excel",
                Kind::PowerPoint => "powerpoint",
            };
            if office_apps().iter().any(|a| a == app) {
                let out = work.join("out.pdf");
                match with_office(input, &out, kind) {
                    Ok(()) => return std::fs::read(&out).map_err(|e| e.to_string()),
                    Err(e) => errors.push(e),
                }
            }
        }
        #[cfg(not(windows))]
        let _ = kind;
        if let Some(soffice) = find_soffice() {
            match with_libreoffice(&soffice, input, &work) {
                Ok(out) => return std::fs::read(out).map_err(|e| e.to_string()),
                Err(e) => errors.push(e),
            }
        }
        if errors.is_empty() {
            Err("Converting Office files needs Microsoft Office or the free LibreOffice (libreoffice.org) on this computer.".into())
        } else {
            Err(errors.join("; "))
        }
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_by_extension() {
        assert_eq!(kind_of(Path::new("a/Report.DOCX")), Some(Kind::Word));
        assert_eq!(kind_of(Path::new("b.ods")), Some(Kind::Excel));
        assert_eq!(kind_of(Path::new("deck.pptx")), Some(Kind::PowerPoint));
        assert_eq!(kind_of(Path::new("photo.jpg")), None);
        assert_eq!(kind_of(Path::new("noext")), None);
    }

    #[test]
    fn office_gets_backslash_paths() {
        assert_eq!(
            windows_path(Path::new("C:/Users/me/My Report.docx")),
            r"C:\Users\me\My Report.docx"
        );
        assert_eq!(windows_path(Path::new(r"C:\a\b.xlsx")), r"C:\a\b.xlsx");
    }

    #[test]
    fn refuses_other_files_and_missing_files() {
        assert!(convert(Path::new("x.jpg"))
            .unwrap_err()
            .contains("Word, Excel"));
        assert!(convert(Path::new("definitely-missing-file.docx"))
            .unwrap_err()
            .contains("wasn't found"));
    }

    #[test]
    fn detection_does_not_fail() {
        // Whatever this machine has, asking must not panic or hang.
        let c = available();
        if !cfg!(windows) {
            assert!(c.office.is_empty());
        }
    }

    #[test]
    fn slow_converters_are_stopped() {
        let cmd = if cfg!(windows) {
            Command::new("powershell.exe")
                .args(["-NoProfile", "-Command", "Start-Sleep 30"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        } else {
            Command::new("sleep")
                .arg("30")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        };
        let start = Instant::now();
        let err = wait_limited(cmd.unwrap(), Duration::from_secs(1)).unwrap_err();
        assert!(err.contains("stopped"));
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    /// Real conversion; needs LibreOffice, so CI runs it on Linux with
    /// `cargo test -- --ignored` after installing LibreOffice Writer.
    #[test]
    #[ignore]
    fn converts_a_text_file_with_libreoffice() {
        let dir =
            std::env::temp_dir().join(format!("deskfolio-office-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("Hello world.txt");
        std::fs::write(&input, "Hello from DeskFolio.\nSecond line.\n").unwrap();
        let pdf = convert(&input).expect("conversion");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(pdf.starts_with(b"%PDF-"), "not a PDF");
        assert!(pdf.len() > 500);
    }
}
