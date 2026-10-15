use crate::{
    config::Config,
    database::GifDatabase,
    html,
    id::{generate_id, ALPHABET},
    validation::{self, UploadError},
};
use axum::{
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, FromRequest, Multipart, Request, State},
    http::{header, Method, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use futures_util::StreamExt;
use rand::Rng;
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct App {
    config: Config,
    database: Arc<Mutex<GifDatabase>>,
    uploads: Arc<Semaphore>,
    public_dir: PathBuf,
}

impl App {
    pub fn new(config: Config, public_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&config.data_dir)?;
        std::fs::create_dir_all(&config.gifs_dir)?;
        let database = GifDatabase::open(&config.database_path)?;
        Ok(Self {
            config,
            database: Arc::new(Mutex::new(database)),
            uploads: Arc::new(Semaphore::new(2)),
            public_dir,
        })
    }

    pub fn router(self) -> Router {
        // Dispatch explicitly to retain the old 404s for unsupported methods,
        // encoded paths, and the restricted public-file allowlist.
        Router::new()
            .fallback(handle)
            .with_state(self)
            .layer(DefaultBodyLimit::max(validation::MAX_BODY_BYTES))
    }

    async fn route(
        &self,
        request: Request,
    ) -> Result<Response, Box<dyn std::error::Error + Send + Sync>> {
        if oversized_content_length(&request) {
            return Ok(upload_failure(UploadError::TooLarge));
        }
        let path = request.uri().path();
        let range = request
            .headers()
            .get(header::RANGE)
            .filter(|_| request.method() == Method::GET)
            .and_then(|value| value.to_str().ok());
        let get = matches!(*request.method(), Method::GET | Method::HEAD);
        if get && path == "/" {
            return Ok(html_response(html::main_page(&self.config), 200));
        }
        if request.method() == Method::POST && path == "/" {
            return Ok(self.upload(request).await);
        }
        if get && path == "/about" {
            return Ok(html_response(html::about(&self.config), 200));
        }
        if get && (path == "/favicon.png" || public_path(path)) {
            return Ok(
                existing_file(&self.public_dir.join(&path[1..]), self.config.debug, range)
                    .await?
                    .unwrap_or_else(|| self.not_found()),
            );
        }
        let gif_id = path
            .strip_prefix("/gifs/")
            .or_else(|| path.strip_prefix('/'))
            .and_then(|p| p.strip_suffix(".gif"))
            .filter(|id| valid_id(id));
        if get {
            if let Some(id) = gif_id {
                return Ok(existing_file(
                    &self.config.gifs_dir.join(format!("{id}.gif")),
                    false,
                    range,
                )
                .await?
                .unwrap_or_else(|| self.not_found()));
            }
            if let Some(id) = path.strip_prefix("/twitter-player/") {
                return Ok(
                    if valid_id(id) && self.config.gifs_dir.join(format!("{id}.gif")).exists() {
                        html_response(html::player(id), 200)
                    } else {
                        self.not_found()
                    },
                );
            }
            let id = &path[1..];
            if valid_id(id) {
                let database = self.database.clone();
                let candidate = id.to_owned();
                let exists = tokio::task::spawn_blocking(move || {
                    database.lock().unwrap().has_gif(&candidate)
                })
                .await??;
                if exists {
                    return Ok(html_response(html::gif(&self.config, id), 200));
                }
            }
        }
        Ok(self.not_found())
    }

    fn not_found(&self) -> Response {
        html_response(html::error(&self.config, 404), 404)
    }

    async fn upload(&self, request: Request) -> Response {
        let Ok(permit) = self.uploads.clone().try_acquire_owned() else {
            return upload_failure(UploadError::Busy);
        };
        let ip = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|value| value.0.ip().to_string());
        let bytes = match read_upload(request).await {
            Ok(bytes) => bytes,
            Err(error) => return upload_failure(error),
        };
        let app = self.clone();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        // The blocking job owns its permit even if the HTTP request is dropped.
        // Validation checks its own deadline; timing out a JoinHandle would leave
        // CPU work running and incorrectly release the upload slot.
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            validation::validate_before(&bytes, deadline)?;
            app.store(&bytes, ip.as_deref())
        })
        .await;
        match result {
            Ok(Ok(id)) => (
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!("/{id}"),
            )
                .into_response(),
            Ok(Err(error)) => upload_failure(error),
            Err(error) => {
                eprintln!("Upload worker failed: {error}");
                upload_failure(UploadError::Internal)
            }
        }
    }

    fn store(&self, bytes: &[u8], ip: Option<&str>) -> Result<String, UploadError> {
        let id;
        {
            let database = self.database.lock().map_err(|_| UploadError::Internal)?;
            let mut rng = rand::rngs::OsRng;
            id = generate_id(
                || rng.gen_range(0..ALPHABET.len()),
                |candidate| {
                    Ok(database
                        .has_gif(candidate)
                        .map_err(|_| UploadError::Internal)?
                        || self
                            .config
                            .gifs_dir
                            .join(format!("{candidate}.gif"))
                            .exists())
                },
            )?;
            let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            database.insert(&id, ip, &timestamp).map_err(|error| {
                eprintln!("Failed to store GIF metadata: {error}");
                UploadError::Internal
            })?;
        }
        let destination = self.config.gifs_dir.join(format!("{id}.gif"));
        if let Err(error) = std::fs::write(&destination, bytes) {
            eprintln!("Failed to store GIF: {error}");
            if let Ok(database) = self.database.lock() {
                if let Err(error) = database.delete(&id) {
                    eprintln!("Failed to roll back GIF metadata: {error}");
                }
            }
            if destination.exists() {
                if let Err(error) = std::fs::remove_file(destination) {
                    eprintln!("Failed to remove incomplete GIF: {error}");
                }
            }
            return Err(UploadError::Internal);
        }
        Ok(id)
    }
}

async fn handle(State(app): State<App>, request: Request) -> Response {
    match app.route(request).await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("Request failed: {error}");
            html_response(html::error(&app.config, 500), 500)
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn public_path(path: &str) -> bool {
    path.strip_prefix("/css/")
        .or_else(|| path.strip_prefix("/js/"))
        .is_some_and(|file| {
            !file.is_empty()
                && file
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        })
}

fn html_response(body: String, status: u16) -> Response {
    (
        StatusCode::from_u16(status).unwrap(),
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        body,
    )
        .into_response()
}

fn upload_failure(error: UploadError) -> Response {
    let status = match error {
        UploadError::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        UploadError::Busy | UploadError::Timeout => StatusCode::SERVICE_UNAVAILABLE,
        UploadError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::UNPROCESSABLE_ENTITY,
    };
    (
        status,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_TYPE, "application/json;charset=utf-8"),
        ],
        serde_json::json!({ "error": error }).to_string(),
    )
        .into_response()
}

async fn read_upload(request: Request) -> Result<Vec<u8>, UploadError> {
    let (parts, body) = request.into_parts();
    let read = async {
        let mut stream = body.into_data_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| UploadError::Invalid)?;
            if bytes.len() + chunk.len() > validation::MAX_BODY_BYTES {
                return Err(UploadError::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    };
    let bytes = tokio::time::timeout(Duration::from_secs(30), read)
        .await
        .map_err(|_| UploadError::Timeout)??;
    let request = Request::from_parts(parts, Body::from(bytes));
    let mut multipart = Multipart::from_request(request, &())
        .await
        .map_err(|_| UploadError::Invalid)?;
    let mut gif = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| UploadError::Invalid)?
    {
        if field.name() == Some("gif") {
            if gif.is_some() || field.file_name().is_none() {
                return Err(UploadError::Invalid);
            }
            gif = Some(
                field
                    .bytes()
                    .await
                    .map_err(|_| UploadError::Invalid)?
                    .to_vec(),
            );
        } else {
            field.bytes().await.map_err(|_| UploadError::Invalid)?;
        }
    }
    let bytes = gif.ok_or(UploadError::Invalid)?;
    Ok(bytes)
}

fn oversized_content_length(request: &Request) -> bool {
    request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|length| length > validation::MAX_BODY_BYTES as u64)
}

// Bun serves one valid byte range, ignores malformed/multiple ranges, and emits
// an empty 416 response for a syntactically valid but unsatisfiable range.
fn byte_range(value: &str, size: u64) -> Option<Result<(u64, u64), ()>> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let number = |text: &str| -> Option<u64> {
        if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
            None
        } else {
            text.parse().ok()
        }
    };
    if start.is_empty() {
        let count = number(end)?;
        return Some(if count == 0 || size == 0 {
            Err(())
        } else {
            Ok((size.saturating_sub(count), size - 1))
        });
    }
    let start = number(start)?;
    let end = if end.is_empty() {
        size.saturating_sub(1)
    } else {
        number(end)?
    };
    if end < start && start < size {
        return None;
    }
    if start >= size {
        return Some(Err(()));
    }
    Some(Ok((start, end.min(size - 1))))
}

async fn existing_file(
    path: &Path,
    disable_cache: bool,
    range: Option<&str>,
) -> std::io::Result<Option<Response>> {
    let mut file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = file.metadata().await?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let size = metadata.len();
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let content_type = match mime.essence_str() {
        "application/javascript" | "text/javascript" => "text/javascript;charset=utf-8".into(),
        value if value.starts_with("text/") => format!("{value};charset=utf-8"),
        value => value.to_owned(),
    };
    let requested = range.and_then(|value| byte_range(value, size));
    let (status, offset, length) = match requested {
        Some(Ok((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
        Some(Err(())) => (StatusCode::RANGE_NOT_SATISFIABLE, 0, 0),
        None => (StatusCode::OK, 0, size),
    };
    if offset != 0 {
        file.seek(std::io::SeekFrom::Start(offset)).await?;
    }
    let mut response =
        Body::from_stream(tokio_util::io::ReaderStream::new(file.take(length))).into_response();
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, length.into());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    if disable_cache {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    }
    if let Some(requested) = requested {
        let content_range = match requested {
            Ok((start, end)) => format!("bytes {start}-{end}/{size}"),
            Err(()) => format!("bytes */{size}"),
        };
        response
            .headers_mut()
            .insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
        response
            .headers_mut()
            .insert(header::CONTENT_RANGE, content_range.parse().unwrap());
    }
    Ok(Some(response))
}
