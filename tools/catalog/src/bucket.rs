use std::time::Duration;

use anyhow::{Context, Result, bail};
use rusty_s3::{Credentials, S3Action, UrlStyle};
use url::Url;

/// Audio and covers never change under the same name: clients cache them for a year.
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// catalog.json changes in place, so clients only keep it for five minutes.
pub const SHORT_LIVED: &str = "public, max-age=300";

const SIGNATURE_LIFETIME: Duration = Duration::from_secs(600);

pub struct Upload {
    pub key: String,
    pub body: Vec<u8>,
    pub content_type: &'static str,
    pub cache_control: &'static str,
}

impl Upload {
    pub fn describe(&self) -> String {
        format!(
            "{} ({} KiB, {}, {})",
            self.key,
            self.body.len().div_ceil(1024),
            self.content_type,
            self.cache_control
        )
    }
}

pub struct Bucket {
    bucket: rusty_s3::Bucket,
    credentials: Credentials,
}

impl Bucket {
    pub fn from_env() -> Result<Bucket> {
        let var = |name: &str| {
            std::env::var(name).with_context(|| format!("{name} is not set (in the environment or in .env)"))
        };
        let jurisdiction = std::env::var("R2_JURISDICTION").ok().filter(|value| !value.is_empty());
        Bucket::new(
            &var("R2_ACCOUNT_ID")?,
            jurisdiction.as_deref(),
            var("R2_BUCKET")?,
            Credentials::new(var("R2_ACCESS_KEY_ID")?, var("R2_SECRET_ACCESS_KEY")?),
        )
    }

    fn new(account: &str, jurisdiction: Option<&str>, name: String, credentials: Credentials) -> Result<Bucket> {
        let endpoint = match jurisdiction {
            Some(jurisdiction) => format!("https://{account}.{jurisdiction}.r2.cloudflarestorage.com"),
            None => format!("https://{account}.r2.cloudflarestorage.com"),
        };
        let endpoint: Url = endpoint.parse().with_context(|| format!("R2 endpoint {endpoint}"))?;
        let bucket = rusty_s3::Bucket::new(endpoint, UrlStyle::Path, name, "auto")?;
        Ok(Bucket { bucket, credentials })
    }

    pub fn exists(&self, key: &str) -> Result<bool> {
        let url = self
            .bucket
            .head_object(Some(&self.credentials), key)
            .sign(SIGNATURE_LIFETIME);
        let response = ureq::head(url.as_str())
            .config()
            .http_status_as_error(false)
            .build()
            .call()
            .with_context(|| format!("looking up {key} on the bucket"))?;
        match response.status().as_u16() {
            200 => Ok(true),
            404 => Ok(false),
            status => bail!("looking up {key} on the bucket: HTTP {status}"),
        }
    }

    pub fn put(&self, upload: &Upload) -> Result<()> {
        let mut response = ureq::put(self.put_url(upload).as_str())
            .config()
            .http_status_as_error(false)
            .build()
            .header("cache-control", upload.cache_control)
            .header("content-type", upload.content_type)
            .send(&upload.body[..])
            .with_context(|| format!("uploading {}", upload.key))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.body_mut().read_to_string().unwrap_or_default();
            bail!("uploading {}: HTTP {status}\n{body}", upload.key);
        }
        Ok(())
    }

    fn put_url(&self, upload: &Upload) -> Url {
        let mut action = self.bucket.put_object(Some(&self.credentials), &upload.key);
        action.headers_mut().insert("cache-control", upload.cache_control);
        action.headers_mut().insert("content-type", upload.content_type);
        action.sign(SIGNATURE_LIFETIME)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uploads_sign_their_cache_and_content_headers_against_the_jurisdiction_endpoint() {
        let credentials = Credentials::new("key", "secret");
        let bucket = Bucket::new("account", Some("eu"), "chillflow-audio".into(), credentials).unwrap();
        let upload = Upload {
            key: "night-drive.mp3".into(),
            body: Vec::new(),
            content_type: "audio/mpeg",
            cache_control: IMMUTABLE,
        };

        let url = bucket.put_url(&upload);
        let signed_headers = url
            .query_pairs()
            .find(|(name, _)| name == "X-Amz-SignedHeaders")
            .unwrap()
            .1;
        assert_eq!(url.host_str(), Some("account.eu.r2.cloudflarestorage.com"));
        assert_eq!(url.path(), "/chillflow-audio/night-drive.mp3");
        assert_eq!(signed_headers, "cache-control;content-type;host");
    }
}
