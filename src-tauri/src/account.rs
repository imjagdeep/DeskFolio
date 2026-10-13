//! The optional DeskLab account: sign in, devices, password, delete.
//! Same file in every DeskLab app.
//!
//! All calls to desklab-api happen here, so the page never sees a token.
//! The refresh token (and the email) live in the OS credential store
//! (Windows Credential Manager / macOS Keychain), one entry per app; the
//! short-lived access token stays in memory. Refreshes run one at a time:
//! the server signs a device out if an old refresh token is ever reused.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::async_runtime::Mutex;

pub const API: &str = "https://desklab-api.jaggi.cc";
const SERVICE: &str = "DeskLab";
const OFFLINE: &str = "Couldn't reach DeskLab. Check your internet connection and try again.";

#[derive(Serialize, Deserialize, Clone)]
struct Stored {
    refresh: String,
    email: String,
}

#[derive(Deserialize)]
struct Tokens {
    access: String,
    refresh: String,
    expires_in: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct User {
    pub id: String,
    pub email: String,
    pub has_password: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Device {
    pub id: String,
    pub app: String,
    pub os: String,
    pub name: String,
    pub created_at: String,
    pub last_seen_at: String,
    pub this_device: bool,
}

/// What the page shows.
#[derive(Serialize, Default)]
pub struct Status {
    pub signed_in: bool,
    pub email: Option<String>,
    /// Signed in, but the server couldn't be reached just now.
    pub offline: bool,
    pub user: Option<User>,
    pub devices: Vec<Device>,
}

#[derive(Deserialize)]
struct Me {
    user: User,
    devices: Vec<Device>,
}

pub struct Account {
    app: &'static str,
    client: reqwest::Client,
    /// Access token and when it stops working; also serialises refreshes.
    access: Mutex<Option<(String, Instant)>>,
}

/// The server's `{ "error": "…" }`, or a plain message for its status.
fn api_error(status: u16, body: &str) -> String {
    #[derive(Deserialize)]
    struct E {
        error: String,
    }
    match serde_json::from_str::<E>(body) {
        Ok(e) if !e.error.is_empty() => e.error,
        _ if status == 429 => "Too many tries. Wait a few minutes, then try again.".into(),
        _ => format!("DeskLab answered with an error ({status}). Try again in a minute."),
    }
}

fn keychain(app: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, app)
        .map_err(|e| format!("the system keychain is not available: {e}"))
}

fn load(app: &str) -> Result<Option<Stored>, String> {
    match keychain(app)?.get_password() {
        Ok(s) => Ok(serde_json::from_str(&s).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("couldn't read the sign-in from the keychain: {e}")),
    }
}

fn save(app: &str, s: &Stored) -> Result<(), String> {
    let json = serde_json::to_string(s).map_err(|e| e.to_string())?;
    keychain(app)?
        .set_password(&json)
        .map_err(|e| format!("couldn't save the sign-in to the keychain: {e}"))
}

fn forget(app: &str) -> Result<(), String> {
    match keychain(app)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "couldn't remove the sign-in from the keychain: {e}"
        )),
    }
}

/// This computer, as the account's device list shows it.
fn device(app: &str) -> serde_json::Value {
    let name = gethostname::gethostname().to_string_lossy().into_owned();
    serde_json::json!({ "app": app, "os": std::env::consts::OS, "name": name })
}

impl Account {
    pub fn new(app: &'static str) -> Result<Account, String> {
        // reqwest's rustls needs a crypto provider; the updater installs the
        // same one, so whoever comes first wins and the other is a no-op.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(format!("DeskLab {app}"))
            .build()
            .map_err(|e| format!("cannot start the network client: {e}"))?;
        Ok(Account {
            app,
            client,
            access: Mutex::new(None),
        })
    }

    async fn post(
        &self,
        path: &str,
        body: serde_json::Value,
        token: Option<&str>,
    ) -> Result<String, String> {
        self.send(reqwest::Method::POST, path, Some(body), token)
            .await
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
        token: Option<&str>,
    ) -> Result<String, String> {
        let mut req = self.client.request(method, format!("{API}{path}"));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(|_| OFFLINE.to_string())?;
        let status = res.status().as_u16();
        let text = res.text().await.map_err(|_| OFFLINE.to_string())?;
        if (200..300).contains(&status) {
            Ok(text)
        } else {
            Err(format!("{status}:{}", api_error(status, &text)))
        }
    }

    /// Keep a fresh sign-in: refresh token to the keychain, access to memory.
    async fn keep(&self, t: Tokens, email: &str) -> Result<(), String> {
        save(
            self.app,
            &Stored {
                refresh: t.refresh,
                email: email.to_string(),
            },
        )?;
        let until = Instant::now() + Duration::from_secs(t.expires_in.saturating_sub(30));
        *self.access.lock().await = Some((t.access, until));
        Ok(())
    }

    /// A working access token, refreshing if needed (one refresh at a time).
    async fn token(&self, force: bool) -> Result<String, String> {
        let mut slot = self.access.lock().await;
        if !force {
            if let Some((t, until)) = slot.as_ref() {
                if Instant::now() < *until {
                    return Ok(t.clone());
                }
            }
        }
        let Some(stored) = load(self.app)? else {
            return Err("401:Not signed in.".into());
        };
        match self
            .post(
                "/v1/auth/refresh",
                serde_json::json!({ "refresh": stored.refresh }),
                None,
            )
            .await
        {
            Ok(text) => {
                let t: Tokens = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                save(
                    self.app,
                    &Stored {
                        refresh: t.refresh,
                        email: stored.email,
                    },
                )?;
                let until = Instant::now() + Duration::from_secs(t.expires_in.saturating_sub(30));
                *slot = Some((t.access.clone(), until));
                Ok(t.access)
            }
            Err(e) if e.starts_with("401:") => {
                // The server ended this sign-in (signed out elsewhere, or deleted).
                *slot = None;
                forget(self.app)?;
                Err(e)
            }
            Err(e) => Err(e),
        }
    }

    /// A signed-in call; on 401 the token is refreshed once and the call retried.
    async fn authed(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<String, String> {
        let t = self.token(false).await?;
        match self
            .send(method.clone(), path, body.clone(), Some(&t))
            .await
        {
            Err(e) if e.starts_with("401:") => {
                let t = self.token(true).await?;
                self.send(method, path, body, Some(&t)).await
            }
            other => other,
        }
    }

    pub async fn status(&self) -> Result<Status, String> {
        let Some(stored) = load(self.app)? else {
            return Ok(Status::default());
        };
        match self.authed(reqwest::Method::GET, "/v1/me", None).await {
            Ok(text) => {
                let me: Me = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                Ok(Status {
                    signed_in: true,
                    email: Some(me.user.email.clone()),
                    offline: false,
                    user: Some(me.user),
                    devices: me.devices,
                })
            }
            Err(e) if e.starts_with("401:") => Ok(Status::default()),
            Err(_) => Ok(Status {
                signed_in: true,
                email: Some(stored.email),
                offline: true,
                ..Status::default()
            }),
        }
    }

    pub async fn send_code(&self, email: &str) -> Result<(), String> {
        self.post("/v1/auth/code", serde_json::json!({ "email": email }), None)
            .await
            .map(|_| ())
    }

    pub async fn verify(&self, email: &str, code: &str) -> Result<(), String> {
        let text = self
            .post(
                "/v1/auth/verify",
                serde_json::json!({ "email": email, "code": code, "device": device(self.app) }),
                None,
            )
            .await?;
        self.keep(
            serde_json::from_str(&text).map_err(|e| e.to_string())?,
            email,
        )
        .await
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<(), String> {
        let text = self
            .post("/v1/auth/login", serde_json::json!({ "email": email, "password": password, "device": device(self.app) }), None)
            .await?;
        self.keep(
            serde_json::from_str(&text).map_err(|e| e.to_string())?,
            email,
        )
        .await
    }

    /// Sign out here. Forgets the sign-in even if the server can't be reached.
    pub async fn logout(&self) -> Result<(), String> {
        if let Ok(t) = self.token(false).await {
            if let Err(e) = self
                .post("/v1/auth/logout", serde_json::json!({}), Some(&t))
                .await
            {
                tracing::warn!("signing out on the server failed (forgotten here anyway): {e}");
            }
        }
        *self.access.lock().await = None;
        forget(self.app)
    }

    pub async fn set_password(&self, password: &str, current: Option<&str>) -> Result<(), String> {
        let body = serde_json::json!({ "password": password, "current": current });
        self.authed(reqwest::Method::PUT, "/v1/me/password", Some(body))
            .await
            .map(|_| ())
    }

    pub async fn remove_password(&self) -> Result<(), String> {
        self.authed(reqwest::Method::DELETE, "/v1/me/password", None)
            .await
            .map(|_| ())
    }

    pub async fn sign_out_device(&self, id: &str) -> Result<(), String> {
        if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
            return Err("unknown device".into());
        }
        self.authed(reqwest::Method::DELETE, &format!("/v1/devices/{id}"), None)
            .await
            .map(|_| ())
    }

    /// Delete the account and everything stored for it, then forget it here.
    pub async fn delete(&self, confirm: &str) -> Result<(), String> {
        self.authed(
            reqwest::Method::DELETE,
            "/v1/me",
            Some(serde_json::json!({ "confirm": confirm })),
        )
        .await?;
        *self.access.lock().await = None;
        forget(self.app)
    }
}

/// "401:Not signed in." → "Not signed in." (the status code is for this file only).
pub fn plain(e: String) -> String {
    match e.split_once(':') {
        Some((code, msg)) if code.len() == 3 && code.chars().all(|c| c.is_ascii_digit()) => {
            msg.to_string()
        }
        _ => e,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_read_plainly() {
        assert_eq!(
            api_error(401, r#"{"error":"That code isn't right."}"#),
            "That code isn't right."
        );
        assert!(api_error(429, "").starts_with("Too many tries"));
        assert!(api_error(500, "<html>").contains("(500)"));
        assert_eq!(plain("401:Not signed in.".into()), "Not signed in.");
        assert_eq!(plain(OFFLINE.into()), OFFLINE);
        assert_eq!(plain("12:30 is fine".into()), "12:30 is fine");
    }

    #[test]
    fn stored_sign_in_round_trips() {
        let s = Stored {
            refresh: "r".into(),
            email: "a@b.co".into(),
        };
        let back: Stored = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(
            (back.refresh, back.email),
            ("r".to_string(), "a@b.co".to_string())
        );
    }
}
