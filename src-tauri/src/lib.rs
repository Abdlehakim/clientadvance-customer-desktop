use lettre::{
  message::Mailbox,
  transport::smtp::authentication::Credentials,
  Message,
  SmtpTransport,
  Transport,
};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{
  backup::Backup,
  params_from_iter,
  types::{Value as SqlValue, ValueRef},
  Connection,
};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::{
  collections::HashMap,
  env,
  fs,
  path::{Path, PathBuf},
  process::Command,
  sync::Mutex,
  time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const DATABASE_FILE_NAME: &str = "gestion-facile.db";
const DATABASE_BACKUP_FILE_NAME: &str = "gestion-facile.backup.sqlite";
const DATABASE_CONFIG_FILE_NAME: &str = "database-location.json";
const DEVICE_IDENTITY_FILE_NAME: &str = "device-identity.json";
const DATABASE_TEMP_FILE_NAME: &str = "gestion-facile.db.tmp";
const DATABASE_DEFAULT_FOLDER_NAME: &str = "Gestion Facile";
const TRIAL_SIGNUP_URL: &str =
  "https://clientadvance.smartwebify.com/signup";
#[cfg(debug_assertions)]
const DEVTOOLS_F12_HOTKEY_SCRIPT: &str = r#"
;(function () {
  document.addEventListener(
    'keydown',
    function (event) {
      if (event.repeat || event.code !== 'F12') {
        return
      }

      event.preventDefault()
      window.__TAURI_INTERNALS__?.invoke('plugin:webview|internal_toggle_devtools')
    },
    true
  )
})()
"#;
const SQLITE_SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  nom_complet TEXT NOT NULL,
  telephone TEXT NOT NULL DEFAULT '',
  adresse TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  cin TEXT NOT NULL DEFAULT '',
  cin_issued_at TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  remote_updated_at TEXT,
  pending_sync INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  montant REAL NOT NULL,
  date_paiement TEXT NOT NULL,
  heure_paiement TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  remote_updated_at TEXT,
  pending_sync INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS admin_settings (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL DEFAULT '',
  admin_whatsapp TEXT NOT NULL DEFAULT '',
  notification_retention_days INTEGER NOT NULL DEFAULT 30,
  setup_completed INTEGER NOT NULL DEFAULT 0,
  server_mode TEXT NOT NULL DEFAULT 'with-server',
  notification_delivery_mode TEXT NOT NULL DEFAULT 'backend',
  smtp_provider_type TEXT NOT NULL DEFAULT 'gmail',
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_username TEXT NOT NULL DEFAULT '',
  smtp_password_configured INTEGER NOT NULL DEFAULT 0,
  smtp_secure INTEGER NOT NULL DEFAULT 1,
  smtp_from_email TEXT NOT NULL DEFAULT '',
  smtp_from_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  remote_updated_at TEXT,
  pending_sync INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'synced'
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  pending_sync INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  payment_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  pending_sync INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  company_id TEXT,
  company_name TEXT,
  account_expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  offline_enabled INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 120000,
  display_password TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_normalized TEXT NOT NULL DEFAULT '',
  seeded INTEGER NOT NULL DEFAULT 0,
  last_online_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local',
  pending_sync INTEGER NOT NULL DEFAULT 0,
  sync_action TEXT NOT NULL DEFAULT 'none',
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_state (key, value, updated_at)
VALUES ('last_sync', NULL, CURRENT_TIMESTAMP);
"#;

#[derive(Default)]
struct DatabaseAccessState {
  sqlite_lock: Mutex<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateStatus {
  current_version: String,
  update_available: bool,
  available_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteStatement {
  sql: String,
  #[serde(default)]
  params: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SqliteDatabaseInfo {
  path: String,
  directory: String,
  is_custom: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SqliteDatabaseBackupInfo {
  path: String,
  directory: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SqliteExecuteResult {
  rows_affected: usize,
  last_insert_rowid: i64,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseLocationConfig {
  #[serde(default)]
  custom_directory: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentityConfig {
  #[serde(default)]
  install_device_secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeDatabaseLocationRequest {
  folder_path: String,
  #[serde(default)]
  replace_existing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeDatabaseLocationResult {
  location: SqliteDatabaseInfo,
  replaced_existing: bool,
  requires_confirmation: bool,
}

#[derive(Debug)]
struct SmtpEmailRequest {
  host: String,
  port: u16,
  username: String,
  password: String,
  secure: bool,
  from_email: String,
  from_name: String,
  to: String,
  subject: String,
  body: String,
}

fn invalid_smtp_field(field: &str, message: &str) -> String {
  format!("Champ SMTP invalide : {field} {message}")
}

fn read_required_smtp_string(
  payload: &serde_json::Map<String, JsonValue>,
  field: &str,
) -> Result<String, String> {
  let Some(value) = payload.get(field) else {
    return Err(invalid_smtp_field(field, "est requis."));
  };

  let JsonValue::String(value) = value else {
    return Err(invalid_smtp_field(field, "doit être une chaîne."));
  };

  let normalized = value.trim().to_string();

  if normalized.is_empty() {
    return Err(invalid_smtp_field(field, "ne peut pas être vide."));
  }

  Ok(normalized)
}

fn read_optional_smtp_string(
  payload: &serde_json::Map<String, JsonValue>,
  field: &str,
) -> Result<String, String> {
  let Some(value) = payload.get(field) else {
    return Ok(String::new());
  };

  let JsonValue::String(value) = value else {
    return Err(invalid_smtp_field(field, "doit être une chaîne."));
  };

  Ok(value.trim().to_string())
}

fn read_required_smtp_port(
  payload: &serde_json::Map<String, JsonValue>,
  field: &str,
) -> Result<u16, String> {
  let Some(value) = payload.get(field) else {
    return Err(invalid_smtp_field(field, "est requis."));
  };

  let JsonValue::Number(number) = value else {
    return Err(invalid_smtp_field(field, "doit être un nombre entier."));
  };

  let Some(port) = number.as_u64().and_then(|value| u16::try_from(value).ok()) else {
    return Err(invalid_smtp_field(field, "doit être un nombre entier valide."));
  };

  if port == 0 {
    return Err(invalid_smtp_field(field, "doit être supérieur à 0."));
  }

  Ok(port)
}

fn read_required_smtp_bool(
  payload: &serde_json::Map<String, JsonValue>,
  field: &str,
) -> Result<bool, String> {
  let Some(value) = payload.get(field) else {
    return Err(invalid_smtp_field(field, "est requis."));
  };

  let JsonValue::Bool(value) = value else {
    return Err(invalid_smtp_field(field, "doit être un booléen."));
  };

  Ok(*value)
}

fn parse_smtp_email_request(request: JsonValue) -> Result<SmtpEmailRequest, String> {
  let JsonValue::Object(payload) = request else {
    return Err("Payload SMTP invalide : request doit être un objet.".to_string());
  };

  let host = read_required_smtp_string(&payload, "host")?;
  let port = read_required_smtp_port(&payload, "port")?;
  let username = read_required_smtp_string(&payload, "username")?;
  let secure = read_required_smtp_bool(&payload, "secure")?;
  let from_email = read_required_smtp_string(&payload, "fromEmail")?;
  let from_name = read_optional_smtp_string(&payload, "fromName")?;
  let to = read_required_smtp_string(&payload, "to")?;
  let subject = read_optional_smtp_string(&payload, "subject")?;
  let body = read_optional_smtp_string(&payload, "body")?;
  let mut password = read_required_smtp_string(&payload, "password")?;

  if password == "********" {
    return Err(invalid_smtp_field("password", "ne peut pas être un masque."));
  }

  if host.eq_ignore_ascii_case("smtp.gmail.com") {
    password.retain(|character| !character.is_whitespace());

    if password.is_empty() {
      return Err(invalid_smtp_field("password", "Gmail ne peut pas être vide."));
    }
  }

  Ok(SmtpEmailRequest {
    host,
    port,
    username,
    password,
    secure,
    from_email,
    from_name,
    to,
    subject,
    body,
  })
}

fn build_smtp_email_request_payload(
  host: JsonValue,
  port: JsonValue,
  username: JsonValue,
  password: JsonValue,
  secure: JsonValue,
  from_email: JsonValue,
  from_name: JsonValue,
  to: JsonValue,
  subject: JsonValue,
  body: JsonValue,
) -> JsonValue {
  let mut payload = serde_json::Map::new();
  payload.insert("host".to_string(), host);
  payload.insert("port".to_string(), port);
  payload.insert("username".to_string(), username);
  payload.insert("password".to_string(), password);
  payload.insert("secure".to_string(), secure);
  payload.insert("fromEmail".to_string(), from_email);
  payload.insert("fromName".to_string(), from_name);
  payload.insert("to".to_string(), to);
  payload.insert("subject".to_string(), subject);
  payload.insert("body".to_string(), body);
  JsonValue::Object(payload)
}

fn legacy_database_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path().app_data_dir().map_err(|error| error.to_string())
}

fn legacy_database_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(legacy_database_dir(app)?.join(DATABASE_FILE_NAME))
}

fn documents_database_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let documents_dir = app
    .path()
    .document_dir()
    .map_err(|error| error.to_string())?;
  let database_dir = documents_dir.join(DATABASE_DEFAULT_FOLDER_NAME);

  fs::create_dir_all(&database_dir).map_err(|error| error.to_string())?;

  Ok(database_dir)
}

fn migrate_legacy_database_if_needed(
  app: &AppHandle,
  target_directory: &Path,
) -> Result<PathBuf, String> {
  let target_path = target_directory.join(DATABASE_FILE_NAME);

  if target_path.exists() {
    return Ok(target_directory.to_path_buf());
  }

  let legacy_path = legacy_database_path(app)?;

  if !legacy_path.exists() {
    return Ok(target_directory.to_path_buf());
  }

  let temporary_target_path = target_directory.join(DATABASE_TEMP_FILE_NAME);
  remove_file_if_exists(&temporary_target_path)?;

  let migration_result = (|| -> Result<(), String> {
    let source_connection = Connection::open(&legacy_path).map_err(|error| error.to_string())?;
    copy_sqlite_database(&source_connection, &temporary_target_path)?;
    verify_sqlite_database(&temporary_target_path)?;
    fs::rename(&temporary_target_path, &target_path).map_err(|error| error.to_string())?;
    verify_sqlite_database(&target_path)?;
    Ok(())
  })();

  match migration_result {
    Ok(()) => Ok(target_directory.to_path_buf()),
    Err(error) => {
      let _ = remove_file_if_exists(&temporary_target_path);
      eprintln!(
        "Failed to migrate legacy SQLite database from '{}' to '{}': {}",
        legacy_path.display(),
        target_path.display(),
        error
      );

      Ok(
        legacy_path
          .parent()
          .map(Path::to_path_buf)
          .unwrap_or_else(|| target_directory.to_path_buf()),
      )
    }
  }
}

fn default_database_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let documents_dir = match documents_database_dir(app) {
    Ok(path) => path,
    Err(error) => {
      eprintln!(
        "Failed to resolve Documents database directory, falling back to legacy AppData path: {}",
        error
      );
      return legacy_database_dir(app);
    }
  };

  migrate_legacy_database_if_needed(app, &documents_dir)
}

fn database_config_path(app: &AppHandle) -> Result<PathBuf, String> {
  let config_dir = app
    .path()
    .app_config_dir()
    .map_err(|error| error.to_string())?;

  fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;

  Ok(config_dir.join(DATABASE_CONFIG_FILE_NAME))
}

fn read_database_location_config(app: &AppHandle) -> DatabaseLocationConfig {
  let Ok(path) = database_config_path(app) else {
    return DatabaseLocationConfig::default();
  };

  if !path.exists() {
    return DatabaseLocationConfig::default();
  }

  let content = match fs::read_to_string(path) {
    Ok(value) => value,
    Err(_) => return DatabaseLocationConfig::default(),
  };

  serde_json::from_str(&content).unwrap_or_default()
}

fn write_database_location_config(
  app: &AppHandle,
  config: &DatabaseLocationConfig,
) -> Result<(), String> {
  let path = database_config_path(app)?;
  let custom_directory = config
    .custom_directory
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty());

  if let Some(directory) = custom_directory {
    let serialized = serde_json::to_vec_pretty(&DatabaseLocationConfig {
      custom_directory: Some(directory.to_string()),
    })
    .map_err(|error| error.to_string())?;

    fs::write(path, serialized).map_err(|error| error.to_string())?;
    return Ok(());
  }

  if path.exists() {
    fs::remove_file(path).map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn device_identity_config_path(app: &AppHandle) -> Result<PathBuf, String> {
  let config_dir = app
    .path()
    .app_config_dir()
    .map_err(|error| error.to_string())?;

  fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;

  Ok(config_dir.join(DEVICE_IDENTITY_FILE_NAME))
}

fn generate_install_device_secret() -> String {
  let mut bytes = [0_u8; 32];
  OsRng.fill_bytes(&mut bytes);
  bytes
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>()
}

fn normalize_install_device_secret(value: &str) -> Option<String> {
  let normalized = value.trim().to_lowercase();
  (!normalized.is_empty()).then_some(normalized)
}

fn app_identifier(app: &AppHandle) -> String {
  let identifier = app.config().identifier.trim();

  if identifier.is_empty() {
    "com.gestionfacile.desktop".to_string()
  } else {
    identifier.to_string()
  }
}

fn build_device_id(app: &AppHandle, install_device_secret: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(install_device_secret.as_bytes());
  hasher.update(b":");
  hasher.update(app_identifier(app).as_bytes());
  hasher.update(b":");
  hasher.update(env::consts::OS.as_bytes());
  hasher.update(b":");
  hasher.update(env::consts::ARCH.as_bytes());

  hasher
    .finalize()
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>()
}

fn read_device_identity_config(app: &AppHandle) -> Option<DeviceIdentityConfig> {
  let Ok(path) = device_identity_config_path(app) else {
    return None;
  };

  if !path.exists() {
    return None;
  }

  let content = fs::read_to_string(path).ok()?;
  serde_json::from_str(&content).ok()
}

fn write_device_identity_config(
  app: &AppHandle,
  config: &DeviceIdentityConfig,
) -> Result<(), String> {
  let path = device_identity_config_path(app)?;
  let serialized = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;

  fs::write(path, serialized).map_err(|error| error.to_string())
}

fn get_or_create_install_device_secret(app: &AppHandle) -> Result<String, String> {
  if let Some(config) = read_device_identity_config(app) {
    if let Some(secret) = normalize_install_device_secret(&config.install_device_secret) {
      return Ok(secret);
    }
  }

  let install_device_secret = generate_install_device_secret();

  // TODO: move this install secret to OS secure storage before production.
  write_device_identity_config(
    app,
    &DeviceIdentityConfig {
      install_device_secret: install_device_secret.clone(),
    },
  )?;

  Ok(install_device_secret)
}

fn normalize_path(path: &Path) -> PathBuf {
  fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn paths_match(left: &Path, right: &Path) -> bool {
  normalize_path(left) == normalize_path(right)
}

fn is_database_file_path(path: &Path) -> bool {
  path
    .file_name()
    .and_then(|file_name| file_name.to_str())
    .map(|file_name| file_name.eq_ignore_ascii_case(DATABASE_FILE_NAME))
    .unwrap_or(false)
}

fn existing_parent_directory(path: &Path) -> Option<PathBuf> {
  path
    .parent()
    .filter(|parent| parent.exists() && parent.is_dir())
    .map(Path::to_path_buf)
}

fn resolve_saved_custom_database_directory(custom_path: &Path) -> Option<PathBuf> {
  if custom_path.exists() {
    if custom_path.is_dir() {
      return Some(custom_path.to_path_buf());
    }

    if custom_path.is_file() || is_database_file_path(custom_path) {
      return existing_parent_directory(custom_path);
    }

    return None;
  }

  if is_database_file_path(custom_path) {
    return existing_parent_directory(custom_path);
  }

  existing_parent_directory(custom_path)?;
  fs::create_dir_all(custom_path).ok()?;

  custom_path.is_dir().then(|| custom_path.to_path_buf())
}

fn resolve_database_directory(app: &AppHandle) -> Result<(PathBuf, bool), String> {
  let default_directory = default_database_dir(app)?;
  let config = read_database_location_config(app);
  let custom_directory = config
    .custom_directory
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty());

  let Some(custom_directory) = custom_directory else {
    return Ok((default_directory, false));
  };

  let custom_path = PathBuf::from(custom_directory);

  if !custom_path.is_absolute() {
    return Ok((default_directory, false));
  }

  let Some(custom_path) = resolve_saved_custom_database_directory(&custom_path) else {
    eprintln!(
      "Saved SQLite database location '{}' is unavailable; using default location '{}'.",
      custom_path.display(),
      default_directory.display()
    );
    return Ok((default_directory, false));
  };

  if paths_match(&custom_path, &default_directory) {
    return Ok((default_directory, false));
  }

  Ok((custom_path, true))
}

fn database_info(app: &AppHandle) -> Result<SqliteDatabaseInfo, String> {
  let (directory, is_custom) = resolve_database_directory(app)?;

  Ok(SqliteDatabaseInfo {
    path: directory.join(DATABASE_FILE_NAME).to_string_lossy().into_owned(),
    directory: directory.to_string_lossy().into_owned(),
    is_custom,
  })
}

fn database_info_for_path(app: &AppHandle, path: &Path) -> Result<SqliteDatabaseInfo, String> {
  let mut info = database_info(app)?;

  info.path = path.to_string_lossy().into_owned();

  if let Some(directory) = path.parent() {
    info.directory = directory.to_string_lossy().into_owned();
  }

  Ok(info)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
  let (directory, _is_custom) = resolve_database_directory(app)?;

  fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

  Ok(directory.join(DATABASE_FILE_NAME))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
  if path.exists() {
    fs::remove_file(path).map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn copy_file(source: &Path, target: &Path) -> Result<(), String> {
  remove_file_if_exists(target)?;
  fs::copy(source, target).map_err(|error| error.to_string())?;
  Ok(())
}

fn copy_sqlite_database(source: &Connection, target: &Path) -> Result<(), String> {
  let mut destination = Connection::open(target).map_err(|error| error.to_string())?;
  let backup = Backup::new(source, &mut destination).map_err(|error| error.to_string())?;

  backup
    .run_to_completion(64, Duration::from_millis(10), None)
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn verify_sqlite_database(path: &Path) -> Result<(), String> {
  if !path.exists() {
    return Err("Copied SQLite database file was not created.".to_string());
  }

  let connection = Connection::open(path).map_err(|error| error.to_string())?;

  connection
    .query_row("SELECT 1", [], |_row| Ok(()))
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn database_backup_file_name() -> String {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or(0);

  format!("gestion-facile.backup.{timestamp}.sqlite")
}

fn list_table_columns(connection: &Connection, table_name: &str) -> Result<Vec<String>, String> {
  let pragma = format!("PRAGMA table_info({table_name})");
  let mut statement = connection
    .prepare(&pragma)
    .map_err(|error| error.to_string())?;
  let rows = statement
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|error| error.to_string())?;
  let mut columns = Vec::new();

  for row in rows {
    columns.push(row.map_err(|error| error.to_string())?);
  }

  Ok(columns)
}

fn add_column_if_missing(
  connection: &Connection,
  table_name: &str,
  column_name: &str,
  definition: &str,
) -> Result<bool, String> {
  let columns = list_table_columns(connection, table_name)?;

  if columns.iter().any(|column| column == column_name) {
    return Ok(false);
  }

  let alter_statement =
    format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}");

  connection
    .execute(&alter_statement, [])
    .map_err(|error| error.to_string())?;

  Ok(true)
}

fn ensure_schema_upgrades(connection: &Connection) -> Result<(), String> {
  add_column_if_missing(
    connection,
    "clients",
    "cin_issued_at",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "clients",
    "birth_date",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  let setup_completed_added = add_column_if_missing(
    connection,
    "admin_settings",
    "setup_completed",
    "INTEGER NOT NULL DEFAULT 1",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "notification_retention_days",
    "INTEGER NOT NULL DEFAULT 30",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "server_mode",
    "TEXT NOT NULL DEFAULT 'with-server'",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "notification_delivery_mode",
    "TEXT NOT NULL DEFAULT 'backend'",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_provider_type",
    "TEXT NOT NULL DEFAULT 'gmail'",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_host",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_port",
    "INTEGER NOT NULL DEFAULT 587",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_username",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_password_configured",
    "INTEGER NOT NULL DEFAULT 0",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_secure",
    "INTEGER NOT NULL DEFAULT 1",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_from_email",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "admin_settings",
    "smtp_from_name",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "company_id",
    "TEXT",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "company_name",
    "TEXT",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "account_expires_at",
    "TEXT",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "offline_enabled",
    "INTEGER NOT NULL DEFAULT 1",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "display_password",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "phone",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "phone_normalized",
    "TEXT NOT NULL DEFAULT ''",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "last_online_login_at",
    "TEXT",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "sync_status",
    "TEXT NOT NULL DEFAULT 'local'",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "pending_sync",
    "INTEGER NOT NULL DEFAULT 0",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "sync_action",
    "TEXT NOT NULL DEFAULT 'none'",
  )?;
  add_column_if_missing(
    connection,
    "local_users",
    "deleted_at",
    "TEXT",
  )?;
  if setup_completed_added {
    connection
      .execute(
        "
          INSERT OR IGNORE INTO admin_settings (
            id,
            admin_email,
            admin_whatsapp,
            notification_retention_days,
            setup_completed,
            server_mode,
            notification_delivery_mode,
            smtp_provider_type,
            smtp_host,
            smtp_port,
            smtp_username,
            smtp_password_configured,
            smtp_secure,
            smtp_from_email,
            smtp_from_name,
            updated_at,
            updated_by,
            remote_updated_at,
            pending_sync,
            sync_status
          ) VALUES (
            'settings_default',
            '',
            '',
            30,
            1,
            'with-server',
            'backend',
            'gmail',
            '',
            587,
            '',
            0,
            1,
            '',
            '',
            CURRENT_TIMESTAMP,
            '',
            NULL,
            0,
            'synced'
          )
        ",
        [],
      )
      .map_err(|error| error.to_string())?;
  }

  connection
    .execute(
      "
        UPDATE admin_settings
        SET server_mode = CASE
          WHEN notification_delivery_mode = 'desktop-email' THEN 'without-server'
          ELSE 'with-server'
        END
      ",
      [],
    )
    .map_err(|error| error.to_string())?;
  connection
    .execute(
      "
        UPDATE admin_settings
        SET notification_delivery_mode = CASE
          WHEN server_mode = 'without-server' THEN 'desktop-email'
          ELSE 'backend'
        END
      ",
      [],
    )
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn open_database(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
  let path = database_path(app)?;
  let connection = Connection::open(&path).map_err(|error| error.to_string())?;

  connection
    .execute_batch(SQLITE_SCHEMA)
    .map_err(|error| error.to_string())?;
  ensure_schema_upgrades(&connection)?;

  Ok((connection, path))
}

#[cfg(target_os = "windows")]
fn open_path_in_file_explorer(path: &Path) -> Result<(), String> {
  Command::new("explorer")
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_path_in_file_explorer(path: &Path) -> Result<(), String> {
  let status = Command::new("open")
    .arg(path)
    .status()
    .map_err(|error| error.to_string())?;

  if status.success() {
    Ok(())
  } else {
    Err(format!(
      "Failed to open database directory (exit code {:?}).",
      status.code()
    ))
  }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path_in_file_explorer(path: &Path) -> Result<(), String> {
  let status = Command::new("xdg-open")
    .arg(path)
    .status()
    .map_err(|error| error.to_string())?;

  if status.success() {
    Ok(())
  } else {
    Err(format!(
      "Failed to open database directory (exit code {:?}).",
      status.code()
    ))
  }
}

fn json_to_sql_value(value: JsonValue) -> Result<SqlValue, String> {
  match value {
    JsonValue::Null => Ok(SqlValue::Null),
    JsonValue::Bool(inner) => Ok(SqlValue::Integer(if inner { 1 } else { 0 })),
    JsonValue::Number(inner) => {
      if let Some(value) = inner.as_i64() {
        Ok(SqlValue::Integer(value))
      } else if let Some(value) = inner.as_u64() {
        let converted =
          i64::try_from(value).map_err(|_| "SQLite integer parameter is out of range".to_string())?;
        Ok(SqlValue::Integer(converted))
      } else if let Some(value) = inner.as_f64() {
        Ok(SqlValue::Real(value))
      } else {
        Err("Unsupported SQLite numeric parameter".to_string())
      }
    }
    JsonValue::String(inner) => Ok(SqlValue::Text(inner)),
    JsonValue::Array(_) | JsonValue::Object(_) => {
      Err("SQLite parameters must be scalar values".to_string())
    }
  }
}

fn row_value_to_json(value: ValueRef<'_>) -> JsonValue {
  match value {
    ValueRef::Null => JsonValue::Null,
    ValueRef::Integer(inner) => json!(inner),
    ValueRef::Real(inner) => json!(inner),
    ValueRef::Text(inner) => JsonValue::String(String::from_utf8_lossy(inner).into_owned()),
    ValueRef::Blob(inner) => JsonValue::Array(inner.iter().map(|byte| json!(byte)).collect()),
  }
}

#[tauri::command]
fn sqlite_init(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
) -> Result<SqliteDatabaseInfo, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;
  let (_connection, path) = open_database(&app)?;

  database_info_for_path(&app, &path)
}

#[tauri::command]
fn sqlite_execute(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
  statement: SqliteStatement,
) -> Result<SqliteExecuteResult, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;
  let (connection, _path) = open_database(&app)?;
  let params = statement
    .params
    .into_iter()
    .map(json_to_sql_value)
    .collect::<Result<Vec<_>, _>>()?;
  let rows_affected = connection
    .execute(&statement.sql, params_from_iter(params.iter()))
    .map_err(|error| error.to_string())?;

  Ok(SqliteExecuteResult {
    rows_affected,
    last_insert_rowid: connection.last_insert_rowid(),
  })
}

#[tauri::command]
fn sqlite_query(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
  statement: SqliteStatement,
) -> Result<Vec<HashMap<String, JsonValue>>, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;
  let (connection, _path) = open_database(&app)?;
  let params = statement
    .params
    .into_iter()
    .map(json_to_sql_value)
    .collect::<Result<Vec<_>, _>>()?;
  let mut prepared = connection
    .prepare(&statement.sql)
    .map_err(|error| error.to_string())?;
  let column_names = prepared
    .column_names()
    .into_iter()
    .map(|value| value.to_string())
    .collect::<Vec<_>>();
  let mut rows = prepared
    .query(params_from_iter(params.iter()))
    .map_err(|error| error.to_string())?;
  let mut results = Vec::new();

  while let Some(row) = rows.next().map_err(|error| error.to_string())? {
    let mut entry = HashMap::new();

    for (index, column_name) in column_names.iter().enumerate() {
      let value = row
        .get_ref(index)
        .map(row_value_to_json)
        .map_err(|error| error.to_string())?;

      entry.insert(column_name.clone(), value);
    }

    results.push(entry);
  }

  Ok(results)
}

#[tauri::command]
fn get_database_location(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
) -> Result<SqliteDatabaseInfo, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;

  let (_connection, path) = open_database(&app)?;
  database_info_for_path(&app, &path)
}

#[tauri::command]
fn backup_database(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
) -> Result<SqliteDatabaseBackupInfo, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;
  let (connection, path) = open_database(&app)?;
  let directory = path
    .parent()
    .ok_or_else(|| "Database directory not found.".to_string())?
    .to_path_buf();
  let backup_path = directory.join(database_backup_file_name());

  copy_sqlite_database(&connection, &backup_path)?;
  verify_sqlite_database(&backup_path)?;

  Ok(SqliteDatabaseBackupInfo {
    path: backup_path.to_string_lossy().into_owned(),
    directory: directory.to_string_lossy().into_owned(),
  })
}

#[tauri::command]
fn open_database_location(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
) -> Result<SqliteDatabaseInfo, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;
  let (_connection, path) = open_database(&app)?;
  let info = database_info_for_path(&app, &path)?;
  let directory = PathBuf::from(&info.directory);

  fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
  open_path_in_file_explorer(&directory)?;

  Ok(info)
}

#[tauri::command]
fn choose_database_folder(app: AppHandle) -> Result<Option<String>, String> {
  let info = database_info(&app)?;
  let directory = PathBuf::from(info.directory);

  Ok(
    FileDialog::new()
      .set_directory(directory)
      .pick_folder()
      .map(|path| path.to_string_lossy().into_owned()),
  )
}

#[tauri::command]
fn get_or_create_device_id(app: AppHandle) -> Result<String, String> {
  let install_device_secret = get_or_create_install_device_secret(&app)?;
  Ok(build_device_id(&app, &install_device_secret))
}

#[tauri::command]
fn change_database_location(
  app: AppHandle,
  state: State<'_, DatabaseAccessState>,
  request: ChangeDatabaseLocationRequest,
) -> Result<ChangeDatabaseLocationResult, String> {
  let _guard = state
    .sqlite_lock
    .lock()
    .map_err(|_| "Database access lock poisoned.".to_string())?;
  let folder_path = request.folder_path.trim();

  if folder_path.is_empty() {
    return Err("Database directory is required.".to_string());
  }

  let target_directory = PathBuf::from(folder_path);

  if !target_directory.is_absolute() {
    return Err("Database directory must be absolute.".to_string());
  }

  fs::create_dir_all(&target_directory).map_err(|error| error.to_string())?;

  let default_directory = default_database_dir(&app)?;
  let is_custom = !paths_match(&target_directory, &default_directory);
  let next_location = SqliteDatabaseInfo {
    path: target_directory.join(DATABASE_FILE_NAME).to_string_lossy().into_owned(),
    directory: target_directory.to_string_lossy().into_owned(),
    is_custom,
  };

  let (source_connection, current_path) = open_database(&app)?;
  let target_path = target_directory.join(DATABASE_FILE_NAME);

  if paths_match(&current_path, &target_path) {
    write_database_location_config(
      &app,
      &DatabaseLocationConfig {
        custom_directory: if is_custom {
          Some(target_directory.to_string_lossy().into_owned())
        } else {
          None
        },
      },
    )?;

    return Ok(ChangeDatabaseLocationResult {
      location: next_location,
      replaced_existing: false,
      requires_confirmation: false,
    });
  }

  let target_exists = target_path.exists();

  if target_exists && !request.replace_existing {
    return Ok(ChangeDatabaseLocationResult {
      location: next_location,
      replaced_existing: false,
      requires_confirmation: true,
    });
  }

  let temporary_target_path = target_directory.join(DATABASE_TEMP_FILE_NAME);
  let backup_path = target_directory.join(DATABASE_BACKUP_FILE_NAME);

  remove_file_if_exists(&temporary_target_path)?;
  copy_sqlite_database(&source_connection, &temporary_target_path)?;
  verify_sqlite_database(&temporary_target_path)?;

  if target_exists {
    copy_file(&target_path, &backup_path)?;
    remove_file_if_exists(&target_path)?;
  }

  if let Err(error) = fs::rename(&temporary_target_path, &target_path) {
    if target_exists && backup_path.exists() && !target_path.exists() {
      let _ = copy_file(&backup_path, &target_path);
    }

    let _ = remove_file_if_exists(&temporary_target_path);
    return Err(error.to_string());
  }

  verify_sqlite_database(&target_path)?;
  write_database_location_config(
    &app,
    &DatabaseLocationConfig {
      custom_directory: if is_custom {
        Some(target_directory.to_string_lossy().into_owned())
      } else {
        None
      },
    },
  )?;

  Ok(ChangeDatabaseLocationResult {
    location: next_location,
    replaced_existing: target_exists,
    requires_confirmation: false,
  })
}

#[tauri::command]
fn send_smtp_email(
  host: JsonValue,
  port: JsonValue,
  username: JsonValue,
  password: JsonValue,
  secure: JsonValue,
  from_email: JsonValue,
  from_name: JsonValue,
  to: JsonValue,
  subject: JsonValue,
  body: JsonValue,
) -> Result<(), String> {
  let request = parse_smtp_email_request(build_smtp_email_request_payload(
    host,
    port,
    username,
    password,
    secure,
    from_email,
    from_name,
    to,
    subject,
    body,
  ))?;
  let host = request.host.trim();
  let from_email = request.from_email.trim();
  let to = request.to.trim();

  if host.is_empty() {
    return Err("Hôte SMTP manquant.".to_string());
  }

  if request.port == 0 {
    return Err("Port SMTP invalide.".to_string());
  }

  if from_email.is_empty() || to.is_empty() {
    return Err("Adresse email manquante.".to_string());
  }

  let from_header = if request.from_name.trim().is_empty() {
    from_email.to_string()
  } else {
    format!("{} <{}>", request.from_name.trim(), from_email)
  };
  let from_mailbox: Mailbox = from_header
    .parse::<Mailbox>()
    .map_err(|error| error.to_string())?;
  let to_mailbox: Mailbox = to
    .parse::<Mailbox>()
    .map_err(|error| error.to_string())?;

  let email = Message::builder()
    .from(from_mailbox)
    .to(to_mailbox)
    .subject(request.subject)
    .body(request.body)
    .map_err(|error| error.to_string())?;

  let mut transport_builder = if request.secure {
    SmtpTransport::relay(host)
      .map_err(|error| error.to_string())?
      .port(request.port)
  } else if request.port == 587 {
    SmtpTransport::starttls_relay(host)
      .map_err(|error| error.to_string())?
      .port(request.port)
  } else {
    SmtpTransport::builder_dangerous(host).port(request.port)
  };

  if !request.username.trim().is_empty() || !request.password.is_empty() {
    transport_builder = transport_builder.credentials(Credentials::new(
      request.username.trim().to_string(),
      request.password,
    ));
  }

  transport_builder
    .build()
    .send(&email)
    .map_err(|error| error.to_string())?;

  Ok(())
}

#[tauri::command]
fn open_trial_signup_page(app: AppHandle) -> Result<(), String> {
  app
    .opener()
    .open_url(TRIAL_SIGNUP_URL, None::<&str>)
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_desktop_update(app: AppHandle) -> Result<DesktopUpdateStatus, String> {
  let current_version = app.package_info().version.to_string();
  let update = app
    .updater()
    .map_err(|error| format!("Unable to initialize desktop updater: {error}"))?
    .check()
    .await
    .map_err(|error| format!("Unable to check for desktop updates: {error}"))?;

  Ok(DesktopUpdateStatus {
    current_version,
    update_available: update.is_some(),
    available_version: update.map(|available_update| available_update.version.to_string()),
  })
}

#[tauri::command]
async fn install_desktop_update(app: AppHandle) -> Result<(), String> {
  let update = app
    .updater()
    .map_err(|error| format!("Unable to initialize desktop updater: {error}"))?
    .check()
    .await
    .map_err(|error| format!("Unable to check for desktop updates: {error}"))?;

  if let Some(update) = update {
    update
      .download_and_install(|_, _| {}, || {})
      .await
      .map_err(|error| format!("Unable to install desktop update: {error}"))?;
  }

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(debug_assertions)]
  let mut builder = tauri::Builder::default();
  #[cfg(not(debug_assertions))]
  let builder = tauri::Builder::default();

  #[cfg(debug_assertions)]
  {
    builder = builder.append_invoke_initialization_script(DEVTOOLS_F12_HOTKEY_SCRIPT);
  }

  builder
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(DatabaseAccessState::default())
    .invoke_handler(tauri::generate_handler![
      sqlite_init,
      sqlite_execute,
      sqlite_query,
      get_database_location,
      backup_database,
      open_database_location,
      choose_database_folder,
      get_or_create_device_id,
      change_database_location,
      send_smtp_email,
      open_trial_signup_page,
      check_desktop_update,
      install_desktop_update,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
