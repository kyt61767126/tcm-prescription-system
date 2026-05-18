import { defaultMedicines } from './defaultMedicines'
import type { Medicine, Prescription, PrescriptionItem, Formula, FormulaComposition } from '../types'

export interface User {
  id?: number
  username: string
  password: string
  name: string
  role?: string
}

export async function getUsers(): Promise<User[]> {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('cloudUsers')
    return saved ? JSON.parse(saved) : []
  }
  return []
}

export async function addUser(user: User): Promise<any> {
  if (typeof window !== 'undefined') {
    const users = await getUsers()
    const newUsers = [...users, user]
    localStorage.setItem('cloudUsers', JSON.stringify(newUsers))
    return user
  }
  throw new Error('Not in browser environment')
}

export async function deleteUser(id: number): Promise<void> {
  if (typeof window !== 'undefined') {
    const users = await getUsers()
    const filtered = users.filter((u: User) => u.id !== id)
    localStorage.setItem('cloudUsers', JSON.stringify(filtered))
    return
  }
  throw new Error('Not in browser environment')
}

export async function updateUser(id: number, user: Partial<User>): Promise<any> {
  if (typeof window !== 'undefined') {
    const users = await getUsers()
    const updated = users.map((u: User) => u.id === id ? { ...u, ...user } : u)
    localStorage.setItem('cloudUsers', JSON.stringify(updated))
    return updated.find((u: User) => u.id === id)
  }
  throw new Error('Not in browser environment')
}

export async function getMedicines(): Promise<Medicine[]> {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('medicines')
    if (saved) return JSON.parse(saved)
    return defaultMedicines
  }
  return defaultMedicines
}

export async function addMedicine(medicine: Medicine): Promise<any> {
  if (typeof window !== 'undefined') {
    const medicines = await getMedicines()
    const newMedicines = [...medicines, medicine]
    localStorage.setItem('medicines', JSON.stringify(newMedicines))
    return medicine
  }
  throw new Error('Not in browser environment')
}

export async function updateMedicine(id: number, medicine: Medicine): Promise<any> {
  if (typeof window !== 'undefined') {
    const medicines = await getMedicines()
    const updated = medicines.map((m: Medicine) => m.id === id ? medicine : m)
    localStorage.setItem('medicines', JSON.stringify(updated))
    return medicine
  }
  throw new Error('Not in browser environment')
}

export async function deleteMedicine(id: number): Promise<void> {
  if (typeof window !== 'undefined') {
    const medicines = await getMedicines()
    const filtered = medicines.filter((m: Medicine) => m.id !== id)
    localStorage.setItem('medicines', JSON.stringify(filtered))
    return
  }
  throw new Error('Not in browser environment')
}

export async function getPrescriptions(): Promise<Prescription[]> {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('prescriptions')
    return saved ? JSON.parse(saved) : []
  }
  return []
}

export async function addPrescription(prescription: Omit<Prescription, 'id'>, items: PrescriptionItem[]) {
  if (typeof window !== 'undefined') {
    const prescriptions = await getPrescriptions()
    const newPrescription = { ...prescription, id: Date.now(), created_at: new Date().toISOString() }
    const updatedPrescriptions = [newPrescription, ...prescriptions]
    localStorage.setItem('prescriptions', JSON.stringify(updatedPrescriptions))
    localStorage.setItem('prescription_items_' + newPrescription.id, JSON.stringify(items))
    return newPrescription
  }
  throw new Error('Not in browser environment')
}

export async function deletePrescription(id: number): Promise<void> {
  if (typeof window !== 'undefined') {
    const prescriptions = await getPrescriptions()
    const filtered = prescriptions.filter((p: Prescription) => p.id !== id)
    localStorage.setItem('prescriptions', JSON.stringify(filtered))
    localStorage.removeItem('prescription_items_' + id)
    return
  }
  throw new Error('Not in browser environment')
}

export async function getFormulas(): Promise<Formula[]> {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('formulas')
    return saved ? JSON.parse(saved) : []
  }
  return []
}

export async function addFormula(formula: Omit<Formula, 'id'>, compositions: FormulaComposition[]) {
  if (typeof window !== 'undefined') {
    const formulas = await getFormulas()
    const newFormula = { ...formula, id: Date.now(), compositions }
    const updated = [...formulas, newFormula]
    localStorage.setItem('formulas', JSON.stringify(updated))
    return newFormula
  }
  throw new Error('Not in browser environment')
}

export async function deleteFormula(id: number): Promise<void> {
  if (typeof window !== 'undefined') {
    const formulas = await getFormulas()
    const filtered = formulas.filter((f: Formula) => f.id !== id)
    localStorage.setItem('formulas', JSON.stringify(filtered))
    return
  }
  throw new Error('Not in browser environment')
}

export async function exportAllData() {
  if (typeof window !== 'undefined') {
    const medicines = localStorage.getItem('medicines') ? JSON.parse(localStorage.getItem('medicines')!) : defaultMedicines
    const prescriptions = localStorage.getItem('prescriptions') ? JSON.parse(localStorage.getItem('prescriptions')!) : []
    const formulas = localStorage.getItem('formulas') ? JSON.parse(localStorage.getItem('formulas')!) : []
    const users = localStorage.getItem('cloudUsers') ? JSON.parse(localStorage.getItem('cloudUsers')!) : []
    return { medicines, prescriptions, formulas, users, exportDate: new Date().toISOString() }
  }
  return { medicines: defaultMedicines, prescriptions: [], formulas: [], users: [], exportDate: new Date().toISOString() }
}

export async function importData(data: any) {
  if (typeof window !== 'undefined') {
    if (data.medicines && data.medicines.length > 0) {
      localStorage.setItem('medicines', JSON.stringify(data.medicines))
    }
    if (data.prescriptions && data.prescriptions.length > 0) {
      localStorage.setItem('prescriptions', JSON.stringify(data.prescriptions))
    }
    if (data.formulas && data.formulas.length > 0) {
      localStorage.setItem('formulas', JSON.stringify(data.formulas))
    }
    if (data.users && data.users.length > 0) {
      localStorage.setItem('cloudUsers', JSON.stringify(data.users))
    }
    return { success: true }
  }
  throw new Error('Not in browser environment')
}