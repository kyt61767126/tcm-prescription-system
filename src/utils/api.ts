import { User, Prescription, Medicine, Formula, CloudUser } from '../types';
import { getErrorMessage } from './helpers';
import { logger } from './logger';
import {
  getAllMedicines as getLocalMedicines,
  addMedicines as saveLocalMedicines,
  getAllPrescriptions as getLocalPrescriptions,
  addPrescription as saveLocalPrescription,
  deletePrescription as deleteLocalPrescription,
  getPrescriptionsByUser as getLocalPrescriptionsByUser,
  addUser as saveLocalUser,
  getUser as getLocalUser,
  initDatabase,
  getUnsyncedPrescriptions,
  markPrescriptionSynced
} from './database';
import type { DBMedicine } from './database';

const DEFAULT_API_BASE = 'https://tcm-prescription-system.pages.dev/api';

function mapBackendRoleToFrontend(backendRole: string): 'globalAdmin' | 'admin' | 'user' {
  if (backendRole === 'platform_admin') return 'globalAdmin';
  if (backendRole === 'clinic_admin') return 'admin';
  if (backendRole === 'globalAdmin') return 'globalAdmin';
  if (backendRole === 'admin') return 'admin';
  return 'user';
}

function isAdminRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'globalAdmin';
}

interface RawMedicine {
  id?: number;
  name?: string;
  code?: string;
  unit?: string;
  dosage?: number;
  defaultDosage?: number;
  price?: number;
}

interface RawPrescription {
  id?: number;
  prescriptionNo?: string;
  prescription_no?: string;
  outpatientNo?: string;
  patientName?: string;
  patient_name?: string;
  name?: string;
  gender?: string;
  age?: string | number;
  phone?: string;
  visitDate?: string;
  visit_date?: string;
  symptoms?: string;
  diagnosis?: string;
  medicines?: unknown[];
  totalPrice?: number;
  total_price?: number;
  registrationFee?: number;
  registration_fee?: number;
  createdBy?: string;
  created_by?: string;
  createdAt?: string;
  created_at?: string;
  synced?: number;
}

let appMode: 'cloud' | 'offline' = 'cloud';
let currentUserAllowCloud: boolean = false;

// 密码哈希工具：使用 PBKDF2-like 派生（Web Crypto API），迭代 100k 轮 SHA-256
// 注意：当前云端 KV 仍存明文密码，此函数仅用于本地保存与未来迁移准备；
// 一旦云端切换为哈希存储，validateLogin 中明文兼容分支应立即删除。
async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashArr = Array.from(new Uint8Array(bits));
  const hashHex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  const saltArr = Array.from(salt);
  const saltStr = saltArr.map(b => b.toString(16).padStart(2, '0')).join('');
  return { hash: hashHex, salt: saltStr };
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // 兼容三种格式：明文 / "hash:salt:hex" / "salt:hex"
  if (!stored) return false;
  if (!stored.includes(':')) return password === stored;
  const parts = stored.split(':');
  if (parts.length === 2) {
    const [salt, hash] = parts;
    const { hash: computed } = await hashPassword(password, salt);
    return computed === hash;
  }
  return false;
}

export function setAppMode(mode: 'cloud' | 'offline') {
  if (mode === 'cloud' && !currentUserAllowCloud) {
    appMode = 'offline';
    return;
  }
  appMode = mode;
}

export function getAppMode(): 'cloud' | 'offline' {
  return appMode;
}

export function setUserAllowCloud(allowCloud: boolean) {
  currentUserAllowCloud = allowCloud;
}

function getApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE;
  return envBase || DEFAULT_API_BASE;
}

function safeBtoa(str: string): string {
  try {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    logger.warn('safeBtoa fallback used:', e);
    return btoa(unescape(encodeURIComponent(str)));
  }
}

// 登录成功后由云端签发的 HMAC token；为空则 fallback 到旧 Basic 兼容模式。
let authToken: string | null = null;

function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem('auth_token', token);
    else localStorage.removeItem('auth_token');
  }
}

function getAuthTokenString(): string | null {
  if (authToken) return authToken;
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('auth_token');
    if (stored) {
      authToken = stored;
      return stored;
    }
  }
  return null;
}

// 旧 Basic fallback：Base64(username:role)。仅在 token 缺失时使用（兼容期）
function getBasicAuthFallback(user: User): string {
  return safeBtoa(user.username + ':' + (user.role || 'user'));
}

// 统一获取 Authorization 头值：优先 Bearer token，缺失时回退 Basic
function getAuthHeader(user?: User): string {
  const token = getAuthTokenString();
  if (token) return 'Bearer ' + token;
  if (user) return 'Basic ' + getBasicAuthFallback(user);
  return '';
}

function generateRequestId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cloudFetch(url: string, options: RequestInit = {}): Promise<any> {
  if (!url.includes('/users') && !url.includes('/prescriptions') &&
      !url.includes('/medicines') && !url.includes('/formulas')) {
    return { success: false, error: 'Non-allowed API disabled', fromCloud: false };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': generateRequestId(),
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }

    const text = await response.text();
    const cleanText = text.replace(/^\uFEFF/, '').trim();
    const data = JSON.parse(cleanText);

    if (Array.isArray(data) || (typeof data === 'object' && data !== null)) {
      if (Array.isArray(data)) {
        return { success: true, fromCloud: true, data };
      }
      if (data.success === undefined) {
        return { ...data, success: true, fromCloud: true };
      }
      return { ...data, fromCloud: true };
    }

    throw new Error('Invalid response format');
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: '云端请求超时（10秒），请检查网络连接', fromCloud: false };
    }
    return { success: false, error: getErrorMessage(error), fromCloud: false };
  }
}

async function ensureDatabase() {
  await initDatabase();
}

export async function savePrescription(user: User, prescription: Prescription): Promise<{ success: boolean; savedPrescription?: Prescription; error?: string }> {
  if (appMode === 'offline') {
    try {
      await ensureDatabase();
      await saveLocalPrescription({
        prescription_no: prescription.prescriptionNo,
        patient_name: prescription.patientName,
        gender: prescription.gender,
        age: prescription.age,
        phone: prescription.phone,
        visit_date: prescription.visitDate,
        symptoms: prescription.symptoms,
        diagnosis: prescription.diagnosis,
        medicines: prescription.medicines,
        total_price: prescription.totalPrice,
        registration_fee: prescription.registrationFee,
        created_by: prescription.createdBy,
        synced: 0
      });
      return { success: true, savedPrescription: prescription };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  if (!currentUserAllowCloud) {
    return { success: false, error: '您的账号未开通云端访问权限' };
  }

  const url = getApiBase() + '/prescriptions';

  try {
    const data = await cloudFetch(url, {
      method: 'POST',
      headers: { 'Authorization': getAuthHeader(user) },
      body: JSON.stringify({ prescription }),
    });

    if (data && (data.success || data.fromCloud)) {
      try {
        await ensureDatabase();
        await saveLocalPrescription({
          prescription_no: prescription.prescriptionNo,
          patient_name: prescription.patientName,
          gender: prescription.gender,
          age: prescription.age,
          phone: prescription.phone,
          visit_date: prescription.visitDate,
          symptoms: prescription.symptoms,
          diagnosis: prescription.diagnosis,
          medicines: prescription.medicines,
          total_price: prescription.totalPrice,
          registration_fee: prescription.registrationFee,
          created_by: prescription.createdBy,
          synced: 1
        });
      } catch (e) {
        logger.error('Failed to save to local DB:', e);
      }
      return { success: true, savedPrescription: data.savedPrescription };
    }

    return { success: false, error: data.error || '保存失败' };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function loadPrescriptions(user: User): Promise<{ success: boolean; data: Prescription[]; error?: string }> {
  if (appMode === 'offline') {
    try {
      await ensureDatabase();
      let data: RawPrescription[] = [];
      if (isAdminRole(user.role)) {
        data = await getLocalPrescriptions();
      } else {
        data = await getLocalPrescriptionsByUser(user.username);
      }
      return { success: true, data: normalizePrescriptions(data) };
    } catch (error: unknown) {
      return { success: false, data: [], error: getErrorMessage(error) };
    }
  }

  if (!currentUserAllowCloud) {
    try {
      await ensureDatabase();
      let data: RawPrescription[] = [];
      if (isAdminRole(user.role)) {
        data = await getLocalPrescriptions();
      } else {
        data = await getLocalPrescriptionsByUser(user.username);
      }
      return { success: true, data: normalizePrescriptions(data) };
    } catch (error: unknown) {
      return { success: false, data: [], error: getErrorMessage(error) };
    }
  }

  const url = getApiBase() + '/prescriptions?user=' + encodeURIComponent(user.username);

  try {
    const data = await cloudFetch(url, {
      method: 'GET',
      headers: { 'Authorization': getAuthHeader(user) },
    });

    if (data && (data.success || data.fromCloud)) {
      return { success: true, data: normalizePrescriptions(data.data || []) };
    }

    return { success: false, data: [], error: data.error || '加载失败' };
  } catch (error: unknown) {
    return { success: false, data: [], error: getErrorMessage(error) };
  }
}

function normalizePrescriptions(rawList: RawPrescription[]): Prescription[] {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((p): Prescription => ({
    id: p.id || 0,
    prescriptionNo: p.prescriptionNo || p.prescription_no || p.outpatientNo || '',
    patientName: p.patientName || p.patient_name || p.name || '',
    gender: p.gender || '',
    age: p.age != null ? String(p.age) : '',
    phone: p.phone || '',
    visitDate: p.visitDate || p.visit_date || '',
    symptoms: p.symptoms || '',
    diagnosis: p.diagnosis || '',
    medicines: Array.isArray(p.medicines) ? (p.medicines as RawMedicine[]).map((m) => ({
      id: m.id || 0,
      name: m.name || '',
      code: m.code || '',
      unit: m.unit || 'g',
      dosage: typeof m.dosage === 'number' ? m.dosage : (typeof m.defaultDosage === 'number' ? m.defaultDosage : 0),
      price: typeof m.price === 'number' ? m.price : 0,
    })) : [],
    totalPrice: typeof p.totalPrice === 'number' ? p.totalPrice : (typeof p.total_price === 'number' ? p.total_price : 0),
    registrationFee: typeof p.registrationFee === 'number' ? p.registrationFee : (typeof p.registration_fee === 'number' ? p.registration_fee : 0),
    createdBy: p.createdBy || p.created_by || '',
    createdAt: p.createdAt || p.created_at || '',
  }));
}

export async function deletePrescription(user: User, prescriptionId: number): Promise<{ success: boolean; error?: string }> {
  if (appMode === 'offline') {
    try {
      await ensureDatabase();
      const prescriptions = await getLocalPrescriptions();
      const targetPrescription = prescriptions.find(p => p.id === prescriptionId);
      if (targetPrescription) {
        await deleteLocalPrescription(targetPrescription.prescription_no);
      }
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  if (!currentUserAllowCloud) {
    return { success: false, error: '您的账号未开通云端访问权限' };
  }

  const url = getApiBase() + '/prescriptions?id=' + prescriptionId + '&user=' + encodeURIComponent(user.username);

  try {
    const data = await cloudFetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': getAuthHeader(user) },
    });

    return { success: data.success || false, error: data.error };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function loadMedicines(): Promise<{ success: boolean; data: Medicine[]; error?: string }> {
  if (appMode === 'offline') {
    try {
      await ensureDatabase();
      const localMedicines = await getLocalMedicines();
      const data: Medicine[] = localMedicines.map(m => ({
        id: m.id || 0,
        name: m.name,
        code: m.code,
        unit: m.unit || 'g',
        defaultDosage: 6,
        price: m.price || 0,
      }));
      return { success: true, data };
    } catch (error: unknown) {
      return { success: false, data: [], error: getErrorMessage(error) };
    }
  }

  try {
    const data = await cloudFetch(getApiBase() + '/medicines', { method: 'GET' });
    if (data && (data.success || data.fromCloud)) {
      try {
        await ensureDatabase();
        const localMedicines = data.data.map((m: DBMedicine) => ({
          code: m.code,
          name: m.name,
          pinyin: m.pinyin || '',
          category: m.category || '',
          unit: m.unit || 'g',
          price: m.price || 0,
          cost_price: m.cost_price || 0,
          stock: m.stock || 0,
          specification: m.specification || '',
          manufacturer: m.manufacturer || ''
        }));
        await saveLocalMedicines(localMedicines);
      } catch (e) {
        logger.error('Failed to save medicines to local DB:', e);
      }
      return { success: true, data: data.data || [] };
    }
    return { success: false, data: [], error: data.error || '加载失败' };
  } catch (error: unknown) {
    try {
      await ensureDatabase();
      const localMedicines = await getLocalMedicines();
      const data: Medicine[] = localMedicines.map(m => ({
        id: m.id || 0,
        name: m.name,
        code: m.code,
        unit: m.unit || 'g',
        defaultDosage: 6,
        price: m.price || 0,
      }));
      return { success: true, data };
    } catch (localErr) {
      logger.error('Local DB fallback failed:', localErr);
      return { success: false, data: [], error: getErrorMessage(error) };
    }
  }
}

export async function saveMedicines(user: User, medicines: Medicine[]): Promise<{ success: boolean; error?: string }> {
  if (!isAdminRole(user.role)) {
    return { success: false, error: '仅管理员可管理药品库' };
  }

  if (appMode === 'offline') {
    try {
      await ensureDatabase();
      const localMedicines = medicines.map(m => ({
        code: m.code,
        name: m.name,
        pinyin: '',
        category: '',
        unit: m.unit,
        price: m.price || 0,
        cost_price: 0,
        stock: 0,
        specification: '',
        manufacturer: '',
      }));
      await saveLocalMedicines(localMedicines);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  if (!currentUserAllowCloud) {
    return { success: false, error: '您的账号未开通云端访问权限' };
  }

  try {
    const data = await cloudFetch(getApiBase() + '/medicines', {
      method: 'POST',
      headers: { 'Authorization': getAuthHeader(user) },
      body: JSON.stringify({ medicines }),
    });
    return { success: data.success || false, error: data.error };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function loadFormulas(): Promise<{ success: boolean; data: Formula[]; error?: string }> {
  if (appMode === 'offline') {
    return { success: true, data: [] };
  }

  if (!currentUserAllowCloud) {
    return { success: true, data: [] };
  }

  try {
    const data = await cloudFetch(getApiBase() + '/formulas', { method: 'GET' });
    if (data && (data.success || data.fromCloud)) {
      return { success: true, data: data.data || [] };
    }
    return { success: false, data: [], error: data.error || '加载失败' };
  } catch (error: unknown) {
    return { success: false, data: [], error: getErrorMessage(error) };
  }
}

export async function saveFormulas(user: User, formulas: Formula[]): Promise<{ success: boolean; error?: string }> {
  if (appMode === 'offline') {
    return { success: true };
  }

  if (!currentUserAllowCloud) {
    return { success: false, error: '您的账号未开通云端访问权限' };
  }

  try {
    const data = await cloudFetch(getApiBase() + '/formulas', {
      method: 'POST',
      headers: { 'Authorization': getAuthHeader(user) },
      body: JSON.stringify({ formulas }),
    });
    return { success: data.success || false, error: data.error };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function validateLogin(username: string, password: string): Promise<{ success: boolean; error?: string; user?: User }> {
  if (!password) return { success: false, error: '请输入密码' };
  try {
    // 优先调用云端 login 端点（POST /users?action=login），由云端验证密码并签发 token
    try {
      const loginResp = await cloudFetch(getApiBase() + '/users?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': generateRequestId() },
        body: JSON.stringify({ username, password }),
      });

      if (loginResp && loginResp.fromCloud) {
        if (loginResp.success && loginResp.token && loginResp.user) {
          setAuthToken(loginResp.token);
          const u = loginResp.user;
          const frontendRole = mapBackendRoleToFrontend(u.role);
          setUserAllowCloud(!!u.allowCloud);
          // 同步到本地数据库（哈希存储）
          try {
            await ensureDatabase();
            const { hash, salt } = await hashPassword(password);
            await saveLocalUser(u.username, `${salt}:${hash}`, frontendRole, u.name || u.username, !!u.allowCloud);
          } catch (e) {
            logger.error('Failed to cache user to local DB:', e);
          }
          return { success: true, user: { ...u, role: frontendRole } as User };
        }
        // 云端明确返回失败（密码错误/用户不存在）→ 不再回退到本地，避免离线暴力破解
        if (loginResp.success === false && loginResp.error) {
          return { success: false, error: loginResp.error };
        }
      }
    } catch (cloudErr) {
      logger.warn('Cloud login endpoint failed, falling back to local:', cloudErr);
    }

    // 离线降级：使用本地数据库验证（哈希）
    await ensureDatabase();
    const localUser = await getLocalUser(username);
    if (localUser) {
      const ok = await verifyPassword(password, localUser.password || '');
      if (ok) {
        const isAdmin = isAdminRole(localUser.role);
        const allowCloud = isAdmin || localUser.allow_cloud === 1;
        // 离线登录不签发新 token，使用 Basic fallback
        setAuthToken(null);
        return {
          success: true,
          user: {
            username: localUser.username,
            role: (isAdmin ? (localUser.role === 'globalAdmin' ? 'globalAdmin' : 'admin') : 'user') as 'globalAdmin' | 'admin' | 'user',
            name: localUser.name || localUser.username,
            allowCloud: allowCloud
          } as User
        };
      }
    }

    return { success: false, error: '用户名或密码错误' };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function loadCloudUsers(): Promise<{ success: boolean; data: CloudUser[]; error?: string }> {
  if (!currentUserAllowCloud) {
    return { success: false, data: [], error: '您的账号未开通云端访问权限' };
  }

  try {
    const data = await cloudFetch(getApiBase() + '/users', { method: 'GET' });
    if (data && (data.success || data.fromCloud)) {
      return { success: true, data: data.data || [] };
    }
    return { success: false, data: [], error: data.error || '加载失败' };
  } catch (error: unknown) {
    return { success: false, data: [], error: getErrorMessage(error) };
  }
}

export async function saveCloudUsers(user: User, users: CloudUser[]): Promise<{ success: boolean; error?: string }> {
  if (!currentUserAllowCloud) {
    return { success: false, error: '您的账号未开通云端访问权限' };
  }

  try {
    const data = await cloudFetch(getApiBase() + '/users', {
      method: 'POST',
      headers: { 'Authorization': getAuthHeader(user) },
      body: JSON.stringify({ users }),
    });
    return { success: data.success || false, error: data.error };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function changePassword(user: User, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await cloudFetch(getApiBase() + '/users?action=change-password', {
      method: 'POST',
      headers: { 'Authorization': getAuthHeader(user) },
      body: JSON.stringify({ username: user.username, oldPassword, newPassword }),
    });
    return { success: data.success || false, error: data.error };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function syncLocalToCloud(user: User): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  if (!currentUserAllowCloud) {
    return { success: false, syncedCount: 0, error: '您的账号未开通云端访问权限' };
  }

  if (appMode === 'offline') {
    return { success: false, syncedCount: 0, error: '当前处于离线模式，请切换到云端模式后再同步' };
  }

  try {
    await ensureDatabase();
    const unsynced = await getUnsyncedPrescriptions();
    
    if (unsynced.length === 0) {
      return { success: true, syncedCount: 0 };
    }

    let syncedCount = 0;

    for (const prescription of unsynced) {
      const apiPrescription = {
        prescriptionNo: prescription.prescription_no,
        patientName: prescription.patient_name,
        gender: prescription.gender,
        age: prescription.age,
        phone: prescription.phone,
        visitDate: prescription.visit_date,
        symptoms: prescription.symptoms,
        diagnosis: prescription.diagnosis,
        medicines: prescription.medicines,
        totalPrice: prescription.total_price,
        createdBy: prescription.created_by,
        createdAt: prescription.created_at,
      };

      const data = await cloudFetch(getApiBase() + '/prescriptions', {
        method: 'POST',
        headers: { 'Authorization': getAuthHeader(user) },
        body: JSON.stringify({ prescription: apiPrescription }),
      });

      if (data && (data.success || data.fromCloud)) {
        await markPrescriptionSynced(prescription.prescription_no);
        syncedCount++;
      }
    }

    return { success: true, syncedCount };
  } catch (error: unknown) {
    return { success: false, syncedCount: 0, error: getErrorMessage(error) };
  }
}
