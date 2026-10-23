//! OCR language packs. English ships with the app; the others are tesseract.js's
//! official "best_int" models, downloaded only when the user asks for one, checked
//! against the size and SHA-256 pinned below, and kept in <app data>/ocr-lang/.
//! The web side reads a pack back as bytes and hands it to tesseract directly,
//! so nothing is fetched from inside the webview (its CSP has no network).

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// The package version the bundled English model comes from (package.json).
const DATA_VERSION: &str = "1.0.0";

pub struct Pack {
    pub code: &'static str,
    pub name: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// Pinned packs: code, name, exact size in bytes, SHA-256 of the .gz.
pub const PACKS: &[Pack] = &[
    Pack {
        code: "fra",
        name: "French",
        size: 707_406,
        sha256: "d611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255",
    },
    Pack {
        code: "spa",
        name: "Spanish",
        size: 2_100_190,
        sha256: "40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb",
    },
    Pack {
        code: "deu",
        name: "German",
        size: 1_333_102,
        sha256: "306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b",
    },
    Pack {
        code: "ita",
        name: "Italian",
        size: 1_660_998,
        sha256: "f702fcfad297ce028ede3626d1467b67939f23ff23595f9badd54681cf25a4d3",
    },
    Pack {
        code: "por",
        name: "Portuguese",
        size: 1_392_239,
        sha256: "dacebc1386ddaaf8389f81094236cca0d690897cde693d48cbdaa881c86e2b4c",
    },
    Pack {
        code: "nld",
        name: "Dutch",
        size: 3_005_696,
        sha256: "a2d904b6ddc4feb0d31ecfcd7361a554102e7aa2e278c54f4fc029e0d0815571",
    },
    Pack {
        code: "pol",
        name: "Polish",
        size: 2_642_356,
        sha256: "a20fdec4ff99d8f8e84c708da3e42a4e935c26863055a0ed88aef5c66a59b91b",
    },
    Pack {
        code: "rus",
        name: "Russian",
        size: 2_679_598,
        sha256: "f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a",
    },
    Pack {
        code: "ukr",
        name: "Ukrainian",
        size: 2_114_206,
        sha256: "ea2789a0ad99ff84bfd252a7410a1e8661a7bc5acaa41573d23b54b71446aa4c",
    },
    Pack {
        code: "pan",
        name: "Punjabi (Gurmukhi)",
        size: 1_396_216,
        sha256: "10624ae040eb967316fcb1a1843421786a48542b22ef2fdd50afc00de58d27b5",
    },
    Pack {
        code: "hin",
        name: "Hindi",
        size: 1_389_692,
        sha256: "f3b6a0d320df38d886178cdd727b90dbf9df3db053adb32bd9cf73f0463cda07",
    },
    Pack {
        code: "ara",
        name: "Arabic",
        size: 1_661_906,
        sha256: "f4746c44b02342dd5b3d4f0198000f47d7c49f1a229e63e0f436c0592dcd9639",
    },
    Pack {
        code: "heb",
        name: "Hebrew",
        size: 580_576,
        sha256: "9c70b524200dae77fb25e3567566eee600ccbcae9aeb89722990ccae0e84e805",
    },
    Pack {
        code: "chi_sim",
        name: "Chinese (Simplified)",
        size: 1_718_768,
        sha256: "b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c",
    },
    Pack {
        code: "jpn",
        name: "Japanese",
        size: 2_030_256,
        sha256: "2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88",
    },
    Pack {
        code: "kor",
        name: "Korean",
        size: 1_572_336,
        sha256: "78c21276ab14c9bb734d83be1055d9fe5469a4e7e977c51ad385be5737e61126",
    },
    Pack {
        code: "vie",
        name: "Vietnamese",
        size: 1_423_003,
        sha256: "2284f610f262a1b19ec8df9f196b9ff6ce38ddb4a66329e998941df4b8961c8d",
    },
    Pack {
        code: "tha",
        name: "Thai",
        size: 896_631,
        sha256: "4550a5505184d1b79cf10416d5b19e643001d95411d5e717954dd26feef3ae74",
    },
];

#[derive(serde::Serialize)]
pub struct PackInfo {
    pub code: &'static str,
    pub name: &'static str,
    pub size: u64,
    pub installed: bool,
}

pub fn find(code: &str) -> Result<&'static Pack, String> {
    PACKS
        .iter()
        .find(|p| p.code == code)
        .ok_or_else(|| format!("no OCR language '{code}'"))
}

pub fn url(p: &Pack) -> String {
    format!(
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/{c}@{v}/4.0.0_best_int/{c}.traineddata.gz",
        c = p.code,
        v = DATA_VERSION
    )
}

pub fn dir(app_data: &Path) -> Result<PathBuf, String> {
    let d = app_data.join("ocr-lang");
    fs::create_dir_all(&d).map_err(|e| format!("can't create {}: {e}", d.display()))?;
    Ok(d)
}

fn file(dir: &Path, p: &Pack) -> PathBuf {
    dir.join(format!("{}.traineddata.gz", p.code))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Bytes are the pinned pack: exact size and hash.
pub fn verify(p: &Pack, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != p.size || sha256_hex(bytes) != p.sha256 {
        return Err(format!(
            "the {} language pack didn't match its checksum - not saved",
            p.name
        ));
    }
    Ok(())
}

pub fn list(dir: &Path) -> Vec<PackInfo> {
    PACKS
        .iter()
        .map(|p| PackInfo {
            code: p.code,
            name: p.name,
            size: p.size,
            installed: file(dir, p).is_file(),
        })
        .collect()
}

/// Saves verified bytes (via a .part file, so a half-written pack never counts).
pub fn save(dir: &Path, p: &Pack, bytes: &[u8]) -> Result<(), String> {
    verify(p, bytes)?;
    let target = file(dir, p);
    let tmp = target.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| format!("can't write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &target).map_err(|e| format!("can't save {}: {e}", target.display()))
}

/// A saved pack, checked again on the way out (a damaged file would crash OCR).
pub fn read(dir: &Path, p: &Pack) -> Result<Vec<u8>, String> {
    let bytes = fs::read(file(dir, p))
        .map_err(|_| format!("the {} language pack isn't downloaded", p.name))?;
    verify(p, &bytes)?;
    Ok(bytes)
}

pub fn remove(dir: &Path, p: &Pack) -> Result<(), String> {
    match fs::remove_file(file(dir, p)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("can't remove the {} pack: {e}", p.name)),
    }
}

/// Downloads one pack (size-capped before reading the body) and saves it.
pub async fn download(client: &reqwest::Client, dir: &Path, p: &Pack) -> Result<(), String> {
    let resp = client
        .get(url(p))
        .send()
        .await
        .map_err(|e| format!("couldn't download the {} pack: {e}", p.name))?;
    if !resp.status().is_success() {
        return Err(format!(
            "couldn't download the {} pack (HTTP {})",
            p.name,
            resp.status().as_u16()
        ));
    }
    if resp.content_length().is_some_and(|n| n != p.size) {
        return Err(format!(
            "the {} pack has an unexpected size - not saved",
            p.name
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("the {} pack download broke off: {e}", p.name))?;
    save(dir, p, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("dfocr-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn codes_unique_and_hashes_well_formed() {
        let mut seen = std::collections::HashSet::new();
        for p in PACKS {
            assert!(seen.insert(p.code), "duplicate {}", p.code);
            assert_eq!(p.sha256.len(), 64);
            assert!(p.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(p.size > 100_000 && p.size < 20_000_000);
            assert!(url(p).starts_with("https://cdn.jsdelivr.net/npm/@tesseract.js-data/"));
        }
    }

    #[test]
    fn wrong_bytes_are_never_saved() {
        let d = tmp();
        let p = find("fra").unwrap();
        assert!(save(&d, p, b"not a language pack").is_err());
        assert!(!list(&d).iter().any(|i| i.installed));
        assert!(read(&d, p).is_err());
        // a damaged file on disk is refused when read back
        fs::write(file(&d, p), b"damaged").unwrap();
        assert!(read(&d, p).is_err());
        remove(&d, p).unwrap();
        remove(&d, p).unwrap(); // already gone is fine
        assert!(find("xx").is_err());
    }
}
