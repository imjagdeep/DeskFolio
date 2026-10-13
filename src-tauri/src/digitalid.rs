//! Digital IDs for signing: reading and writing .pfx / .p12 files (including
//! the older 3DES/RC2 kind Windows exports), and the folder where DeskFolio
//! keeps saved IDs. The IDs themselves are stored by the web side, already
//! encrypted with the ID's password; nothing here keeps a key in the clear.

use p12_keystore::{
    Certificate, KeyStore, KeyStoreEntry, Pkcs12ImportPolicy, PrivateKey, PrivateKeyChain,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq)]
pub struct IdParts {
    /// Signer's certificate, DER.
    pub cert: Vec<u8>,
    /// Issuer certificates, nearest first, DER.
    pub chain: Vec<Vec<u8>>,
    /// Private key, PKCS#8 DER.
    pub pkcs8: Vec<u8>,
}

/// Read a .pfx/.p12: the first private key with its certificates.
pub fn import(data: &[u8], password: &str) -> Result<IdParts, String> {
    let store =
        KeyStore::from_pkcs12(data, password, Pkcs12ImportPolicy::Relaxed).map_err(|e| {
            let msg = e.to_string();
            if msg.to_lowercase().contains("mac")
                || msg.to_lowercase().contains("password")
                || msg.to_lowercase().contains("decrypt")
            {
                "That password doesn't open this digital ID.".to_string()
            } else {
                format!("This file isn't a digital ID DeskFolio can read ({msg}).")
            }
        })?;
    let (_, chain) = store.private_key_chain().ok_or(
        "This file has no private key, so it can't be used to sign (it may be a certificate only).",
    )?;
    let certs = chain.certs();
    let first = certs
        .first()
        .ok_or("This digital ID has a key but no certificate.")?;
    Ok(IdParts {
        cert: first.as_der().to_vec(),
        chain: certs.iter().skip(1).map(|c| c.as_der().to_vec()).collect(),
        pkcs8: chain.key().as_der().to_vec(),
    })
}

/// Write a .pfx protected with `password` (AES-256, HMAC-SHA256).
pub fn export(parts: &IdParts, password: &str, alias: &str) -> Result<Vec<u8>, String> {
    if password.len() < 6 {
        return Err("Use a password of at least 6 characters for the exported file.".into());
    }
    let key = PrivateKey::from_der(&parts.pkcs8)
        .map_err(|e| format!("the private key is damaged: {e}"))?;
    let mut certs = vec![Certificate::from_der(&parts.cert)
        .map_err(|e| format!("the certificate is damaged: {e}"))?];
    for c in &parts.chain {
        certs.push(
            Certificate::from_der(c).map_err(|e| format!("a chain certificate is damaged: {e}"))?,
        );
    }
    let mut store = KeyStore::new();
    store.add_entry(
        alias,
        KeyStoreEntry::PrivateKeyChain(PrivateKeyChain::new(alias.as_bytes(), key, certs)),
    );
    store
        .writer(password)
        .write()
        .map_err(|e| format!("couldn't write the digital ID: {e}"))
}

/// The folder for saved IDs (created if needed).
pub fn ids_dir(app_data: &Path) -> Result<PathBuf, String> {
    let dir = app_data.join("digital-ids");
    fs::create_dir_all(&dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Names DeskFolio itself gives saved IDs: "id-" + hex + ".json".
pub fn valid_id_file(name: &str) -> bool {
    name.len() <= 80
        && name.starts_with("id-")
        && name.ends_with(".json")
        && name[3..name.len() - 5]
            .chars()
            .all(|c| c.is_ascii_hexdigit())
}

pub fn list(dir: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(|e| format!("can't read {}: {e}", dir.display()))? {
        let name = e
            .map_err(|e| e.to_string())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if valid_id_file(&name) {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    if !valid_id_file(name) {
        return Err("not a saved digital ID".into());
    }
    fs::remove_file(dir.join(name)).map_err(|e| format!("couldn't delete the digital ID: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Throwaway test IDs made with OpenSSL (test-data/): one modern (AES-256),
    // one in the older 3DES form Windows uses; password test-pass-123.
    const AES: &[u8] = include_bytes!("../test-data/test-id-aes.pfx");
    const DES3: &[u8] = include_bytes!("../test-data/test-id-3des.pfx");
    const CERT: &[u8] = include_bytes!("../test-data/test-cert.der");
    const KEY: &[u8] = include_bytes!("../test-data/test-key.p8");

    #[test]
    fn imports_modern_and_older_windows_files() {
        for data in [AES, DES3] {
            let parts = import(data, "test-pass-123").unwrap();
            assert_eq!(parts.cert, CERT);
            assert_eq!(parts.pkcs8, KEY);
            assert!(parts.chain.is_empty());
        }
    }

    #[test]
    fn wrong_password_is_said_plainly() {
        assert!(import(AES, "nope").unwrap_err().contains("password"));
    }

    #[test]
    fn export_then_import_round_trip() {
        let parts = IdParts {
            cert: CERT.to_vec(),
            chain: vec![],
            pkcs8: KEY.to_vec(),
        };
        let pfx = export(&parts, "another-pass", "Alex").unwrap();
        assert_eq!(import(&pfx, "another-pass").unwrap(), parts);
    }

    #[test]
    fn valid_names_only() {
        assert!(valid_id_file("id-0a1b2c.json"));
        assert!(!valid_id_file("../secrets.json"));
        assert!(!valid_id_file("id-xyz.json"));
        assert!(!valid_id_file("id-00.txt"));
    }

    #[test]
    fn rejects_garbage_and_short_passwords() {
        assert!(import(b"not a pfx", "x").is_err());
        let parts = IdParts {
            cert: CERT.to_vec(),
            chain: vec![],
            pkcs8: KEY.to_vec(),
        };
        assert!(export(&parts, "123", "x")
            .unwrap_err()
            .contains("6 characters"));
    }

    #[test]
    fn folder_list_and_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = ids_dir(tmp.path()).unwrap();
        fs::write(dir.join("id-ab12.json"), b"{}").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        assert_eq!(list(&dir).unwrap(), vec!["id-ab12.json".to_string()]);
        assert!(delete(&dir, "notes.txt").is_err());
        delete(&dir, "id-ab12.json").unwrap();
        assert!(list(&dir).unwrap().is_empty());
    }
}
