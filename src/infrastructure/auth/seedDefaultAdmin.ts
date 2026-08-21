import {
  getDb,
  type SqliteRow,
} from "@/infrastructure/local/sqlite/sqliteClient";
import {
  generateOfflinePasswordSalt,
  getOfflinePasswordIterations,
  hashOfflinePassword,
} from "./offlinePassword";

const DEFAULT_ADMIN_ID = "default_admin_contact_autoecolenaffeti_tn";
const DEFAULT_ADMIN_EMAIL = "contact@autoecolenaffeti.tn";
const DEFAULT_ADMIN_PASSWORD = "Hadhoud/11051952*";
const DEFAULT_ADMIN_NAME = "Admin";

interface DefaultAdminRow extends SqliteRow {
  id: unknown;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function ensureDefaultAdminUser() {
  const email = normalizeEmail(DEFAULT_ADMIN_EMAIL);
  const db = await getDb();
  const existingRows = await db.query<DefaultAdminRow>(
    `
      SELECT id
      FROM local_users
      WHERE email = ?
      LIMIT 1
    `,
    [email],
  );

  if (existingRows.length > 0) {
    console.info("Default admin already exists");
    return { created: false };
  }

  const now = new Date().toISOString();
  const salt = generateOfflinePasswordSalt();
  const iterations = getOfflinePasswordIterations();
  const passwordHash = await hashOfflinePassword(DEFAULT_ADMIN_PASSWORD, salt, iterations);

  const result = await db.execute(
    `
      INSERT INTO local_users (
        id,
        email,
        name,
        role,
        company_id,
        company_name,
        is_active,
        offline_enabled,
        password_hash,
        password_salt,
        password_iterations,
        display_password,
        phone,
        phone_normalized,
        seeded,
        last_online_login_at,
        created_at,
        updated_at,
        sync_status,
        pending_sync,
        sync_action,
        deleted_at
      ) VALUES (?, ?, ?, 'admin', NULL, NULL, 1, 1, ?, ?, ?, '', '', '', 0, NULL, ?, ?, 'local', 0, 'none', NULL)
      ON CONFLICT(email) DO NOTHING
    `,
    [
      DEFAULT_ADMIN_ID,
      email,
      DEFAULT_ADMIN_NAME,
      passwordHash,
      salt,
      iterations,
      now,
      now,
    ],
  );

  if (result.rowsAffected === 0) {
    console.info("Default admin already exists");
    return { created: false };
  }

  console.info("Default admin created");
  return { created: true };
}
