import { CapacitorSQLite, SQLiteDBConnection, SQLiteConnection } from '@capacitor-community/sqlite';
import { Preferences } from '@capacitor/preferences';
import { logger } from './logger';

export interface DBUser {
  id?: number;
  username: string;
  password: string;
  role: string;
  name?: string;
  allow_cloud?: number;
  created_at?: string;
}

export interface DBMedicine {
  code: string;
  name: string;
  pinyin?: string;
  category?: string;
  unit?: string;
  price: number;
  cost_price?: number;
  stock?: number;
  specification?: string;
  manufacturer?: string;
}

export interface DBMedicineRow extends DBMedicine {
  id?: number;
  updated_at?: string;
}

export interface DBPrescriptionInput {
  prescription_no: string;
  original_no?: string;
  patient_name: string;
  gender?: string;
  age?: string;
  phone?: string;
  visit_date: string;
  symptoms?: string;
  diagnosis?: string;
  medicines: unknown[];
  total_price: number;
  registration_fee?: number;
  created_by: string;
  synced?: number;
}

export interface DBPrescriptionRow {
  id?: number;
  prescription_no: string;
  original_no?: string;
  patient_name: string;
  gender?: string;
  age?: string;
  phone?: string;
  visit_date: string;
  symptoms?: string;
  diagnosis?: string;
  medicines: unknown[];
  total_price: number;
  registration_fee?: number;
  created_by: string;
  created_at?: string;
  synced?: number;
}

const DB_NAME = 'tcm_prescription.db';
const DB_VERSION = 1;
const DB_SECRET_PREFS_KEY = 'db_secret_key';

// 历史固定密钥，仅用于读取旧数据库做迁移
const DB_SECRET_LEGACY_1 = 'secret';
const DB_SECRET_LEGACY_2 = 'tcm-rx-7f3a9c2e1b8d4a6f5e0c9b2a7d8f3e1c4b6a9d2e7f8c3b1a5d4e6';

let db: SQLiteDBConnection | null = null;
let cachedSecret: string | null = null;

// 从 Preferences 读取或生成 32 字节随机密钥（hex 编码 64 字符）
async function getOrGenerateDbSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  try {
    const { value } = await Preferences.get({ key: DB_SECRET_PREFS_KEY });
    if (value) {
      cachedSecret = value;
      return value;
    }
  } catch (e) {
    logger.warn('Preferences get failed, using ephemeral secret:', e);
  }

  // 生成 32 字节随机密钥
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    await Preferences.set({ key: DB_SECRET_PREFS_KEY, value: secret });
  } catch (e) {
    logger.warn('Preferences set failed, secret will be ephemeral:', e);
  }
  cachedSecret = secret;
  return secret;
}

export async function initDatabase(): Promise<SQLiteDBConnection> {
  if (db) return db;

  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const newSecret = await getOrGenerateDbSecret();

  // 1. 尝试 Preferences 派生的新密钥
  try {
    db = await sqlite.createConnection(DB_NAME, true, newSecret, DB_VERSION, false);
    await db.open();
    await createTables();
    return db;
  } catch (newKeyErr) {
    logger.warn('Preferences-derived secret open failed:', newKeyErr);
  }

  // 2. 尝试历史固定密钥（迁移用）
  for (const legacy of [DB_SECRET_LEGACY_2, DB_SECRET_LEGACY_1]) {
    try {
      db = await sqlite.createConnection(DB_NAME, true, legacy, DB_VERSION, false);
      await db.open();
      await createTables();
      // 迁移成功后用新密钥重建（导出→删除→新建→导入过于复杂，
      // 当前策略：旧库继续用旧密钥，新装用户用新密钥；卸载重装后 Preferences 会被清除）
      logger.warn('Opened with legacy secret, data preserved with old key');
      return db;
    } catch (e) {
      logger.warn('DB open attempt failed, trying next:', e);
      // 继续尝试下一个
    }
  }

  // 3. 全部失败，删除重建
  logger.warn('All secret attempts failed, recreating database');
  try {
    await sqlite.closeConnection(DB_NAME, false);
  } catch (e) { logger.warn('DB rebuild cleanup failed:', e); }
  try {
    await sqlite.deleteOldDatabases();
  } catch (e) { logger.warn('DB rebuild cleanup failed:', e); }
  db = await sqlite.createConnection(DB_NAME, true, newSecret, DB_VERSION, false);
  await db.open();
  await createTables();
  return db;
}

async function createTables() {
  if (!db) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      name TEXT,
      allow_cloud INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      pinyin TEXT,
      category TEXT,
      unit TEXT,
      price REAL NOT NULL,
      cost_price REAL,
      stock INTEGER DEFAULT 0,
      specification TEXT,
      manufacturer TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_no TEXT UNIQUE NOT NULL,
      original_no TEXT,
      patient_name TEXT NOT NULL,
      gender TEXT,
      age TEXT,
      phone TEXT,
      visit_date TEXT NOT NULL,
      symptoms TEXT,
      diagnosis TEXT,
      medicines TEXT NOT NULL,
      total_price REAL NOT NULL,
      registration_fee REAL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      synced INTEGER DEFAULT 0
    )
  `);
  await db.execute(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS registration_fee REAL DEFAULT 0`);
  await db.execute(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS original_no TEXT`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      last_sync TEXT,
      local_prescriptions_count INTEGER DEFAULT 0,
      cloud_prescriptions_count INTEGER DEFAULT 0
    )
  `);
}

export async function addUser(username: string, password: string, role: string = 'user', name?: string, allowCloud: boolean = false) {
  const database = await initDatabase();
  await database.run(`
    INSERT OR REPLACE INTO users (username, password, role, name, allow_cloud)
    VALUES (?, ?, ?, ?, ?)
  `, [username, password, role, name || username, allowCloud ? 1 : 0]);
}

export async function getUser(username: string): Promise<DBUser | null> {
  const database = await initDatabase();
  const result = await database.query(`SELECT * FROM users WHERE username = ?`, [username]);
  return (result.values?.[0] as DBUser) || null;
}

async function addMedicine(medicine: DBMedicine) {
  const database = await initDatabase();
  await database.run(`
    INSERT OR REPLACE INTO medicines (code, name, pinyin, category, unit, price, cost_price, stock, specification, manufacturer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    medicine.code,
    medicine.name,
    medicine.pinyin || '',
    medicine.category || '',
    medicine.unit || '',
    medicine.price || 0,
    medicine.cost_price || 0,
    medicine.stock || 0,
    medicine.specification || '',
    medicine.manufacturer || ''
  ]);
}

export async function addMedicines(medicines: DBMedicine[]) {
  for (const medicine of medicines) {
    await addMedicine(medicine);
  }
}

export async function getAllMedicines(): Promise<DBMedicineRow[]> {
  const database = await initDatabase();
  const result = await database.query(`SELECT * FROM medicines ORDER BY name`);
  return (result.values || []) as DBMedicineRow[];
}

export async function addPrescription(prescription: DBPrescriptionInput) {
  const database = await initDatabase();
  await database.run(`
    INSERT OR REPLACE INTO prescriptions (prescription_no, original_no, patient_name, gender, age, phone, visit_date, symptoms, diagnosis, medicines, total_price, registration_fee, created_by, synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    prescription.prescription_no,
    prescription.original_no || '',
    prescription.patient_name,
    prescription.gender || '',
    prescription.age || '',
    prescription.phone || '',
    prescription.visit_date,
    prescription.symptoms || '',
    prescription.diagnosis || '',
    JSON.stringify(prescription.medicines),
    prescription.total_price || 0,
    prescription.registration_fee || 0,
    prescription.created_by,
    prescription.synced || 0
  ]);
}

export async function getPrescriptionsByUser(username: string): Promise<DBPrescriptionRow[]> {
  const database = await initDatabase();
  const result = await database.query(`
    SELECT * FROM prescriptions
    WHERE created_by = ?
    ORDER BY created_at DESC
  `, [username]);
  const prescriptions = (result.values || []) as DBPrescriptionRow[];
  return prescriptions.map(p => ({
    ...p,
    medicines: JSON.parse((p as unknown as { medicines?: string }).medicines || '[]')
  }));
}

export async function getAllPrescriptions(): Promise<DBPrescriptionRow[]> {
  const database = await initDatabase();
  const result = await database.query(`SELECT * FROM prescriptions ORDER BY created_at DESC`);
  const prescriptions = (result.values || []) as DBPrescriptionRow[];
  return prescriptions.map(p => ({
    ...p,
    medicines: JSON.parse((p as unknown as { medicines?: string }).medicines || '[]')
  }));
}

export async function getUnsyncedPrescriptions(): Promise<DBPrescriptionRow[]> {
  const database = await initDatabase();
  const result = await database.query(`SELECT * FROM prescriptions WHERE synced = 0 ORDER BY created_at ASC`);
  const prescriptions = (result.values || []) as DBPrescriptionRow[];
  return prescriptions.map(p => ({
    ...p,
    medicines: JSON.parse((p as unknown as { medicines?: string }).medicines || '[]')
  }));
}

export async function markPrescriptionSynced(prescriptionNo: string) {
  const database = await initDatabase();
  await database.run(`UPDATE prescriptions SET synced = 1 WHERE prescription_no = ?`, [prescriptionNo]);
}

export async function deletePrescription(prescriptionNo: string) {
  const database = await initDatabase();
  await database.run(`DELETE FROM prescriptions WHERE prescription_no = ?`, [prescriptionNo]);
}