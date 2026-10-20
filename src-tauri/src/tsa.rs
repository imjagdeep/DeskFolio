//! Trusted timestamps for digital signatures (RFC 3161), only when the user turns
//! them on. The web side builds the request - a SHA-256 of the signature value and
//! a nonce, never the document - and checks the reply; this module only carries it
//! to one of a fixed list of public timestamp authorities. Any other address is
//! refused, so the app can't be talked into contacting arbitrary servers.

/// id, name shown in the app, URL.
pub const AUTHORITIES: &[(&str, &str, &str)] = &[
    ("digicert", "DigiCert", "http://timestamp.digicert.com"),
    ("sectigo", "Sectigo", "http://timestamp.sectigo.com"),
    ("freetsa", "FreeTSA", "https://freetsa.org/tsr"),
];

/// A timestamp request is a few hundred bytes; a reply with its certificates a few KB.
const MAX_REQUEST: usize = 4 * 1024;
const MAX_REPLY: usize = 64 * 1024;

pub fn url_of(id: &str) -> Result<&'static str, String> {
    AUTHORITIES
        .iter()
        .find(|(i, _, _)| *i == id)
        .map(|(_, _, u)| *u)
        .ok_or_else(|| format!("unknown timestamp service '{id}'"))
}

/// DER SEQUENCE, small enough to be a timestamp request.
pub fn check_request(body: &[u8]) -> Result<(), String> {
    if body.is_empty() || body.len() > MAX_REQUEST || body[0] != 0x30 {
        return Err("that isn't a timestamp request".into());
    }
    Ok(())
}

pub async fn request(client: &reqwest::Client, id: &str, body: Vec<u8>) -> Result<Vec<u8>, String> {
    let url = url_of(id)?;
    check_request(&body)?;
    let resp = client
        .post(url)
        .header("Content-Type", "application/timestamp-query")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("couldn't reach the timestamp service: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "the timestamp service answered HTTP {}",
            resp.status().as_u16()
        ));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX_REPLY) {
        return Err("the timestamp service's answer is too large".into());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("the timestamp answer broke off: {e}"))?;
    if bytes.len() > MAX_REPLY || bytes.first() != Some(&0x30) {
        return Err("the timestamp service didn't send a timestamp".into());
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_services() {
        assert_eq!(url_of("digicert").unwrap(), "http://timestamp.digicert.com");
        assert!(url_of("https://evil.example").is_err());
        assert!(url_of("").is_err());
    }

    #[test]
    fn request_shape_is_checked() {
        assert!(check_request(&[0x30, 0x03, 0x02, 0x01, 0x01]).is_ok());
        assert!(check_request(&[]).is_err());
        assert!(check_request(b"GET / HTTP/1.1").is_err());
        assert!(check_request(&vec![0x30; MAX_REQUEST + 1]).is_err());
    }
}
