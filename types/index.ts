export interface Medicine {
  id?: number
  name: string
  code: string
  price: number
  unit: string
  dosage: number
  category?: string
  stock?: number
  created_at?: string
}

export interface PrescriptionItem {
  id?: number
  prescription_id?: number
  medicine_name: string
  medicine_code: string
  dosage: number
  unit: string
  price: number
  total: number
}

export interface Prescription {
  id?: number
  prescription_no: string
  patient_name: string
  patient_gender: string
  patient_age: string
  patient_phone: string
  patient_address: string
  diagnosis: string
  total_amount: number
  dose_count: number
  medical_fee?: number
  doctor_name?: string
  created_at?: string
  items?: PrescriptionItem[]
}

export interface FormulaComposition {
  id?: number
  formula_id?: number
  medicine_name: string
  dosage: number
  unit: string
}

export interface Formula {
  id?: number
  name: string
  code: string
  effect: string
  indication: string
  created_at?: string
  compositions?: FormulaComposition[]
}