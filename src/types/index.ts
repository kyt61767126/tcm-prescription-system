export interface User {
  username: string;
  role: 'globalAdmin' | 'admin' | 'user';
  name: string;
  allowCloud?: boolean;
  registrationFee?: number;
  clinicId?: string;
}

export interface CloudUser {
  username: string;
  name: string;
  role: 'globalAdmin' | 'admin' | 'user';
  allowSavePrescription?: boolean;
  allowedMode?: 'cloud' | 'local' | 'both';
  allowCloud?: boolean;
  hasPassword?: boolean;
  password?: string;
  clinicId?: string;
}

export interface Medicine {
  id: number;
  name: string;
  code: string;
  unit: string;
  defaultDosage: number;
  price?: number;
}

export interface MedicineItem {
  id: number;
  name: string;
  code: string;
  unit: string;
  dosage: number;
  price: number;
}

export interface Prescription {
  id: number;
  prescriptionNo: string;
  originalNo?: string;
  patientName: string;
  gender: string;
  age: string;
  phone: string;
  visitDate: string;
  symptoms: string;
  diagnosis: string;
  medicines: MedicineItem[];
  totalPrice: number;
  registrationFee: number;
  createdBy: string;
  createdAt: string;
}

export interface Formula {
  id: number;
  name: string;
  composition: string;
  effect: string;
  medicines: MedicineItem[];
  createdBy?: string;
}

export interface PrescriptionFormData {
  patientName: string;
  gender: string;
  age: string;
  phone: string;
  visitDate: string;
  symptoms: string;
  diagnosis: string;
  medicines: MedicineItem[];
  prescriptionNo?: string;
  clinicNo?: string;
  address?: string;
  doctorName?: string;
  registrationFee?: number;
}
