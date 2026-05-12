import { supabase } from './supabase'
import { defaultMedicines } from './defaultMedicines'
import type { Medicine, Prescription, PrescriptionItem, Formula, FormulaComposition } from '../types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface User {
  id?: number
  username: string
  password: string
  name: string
  role?: string
}

const client = supabase as SupabaseClient | null

export async function getUsers(): Promise<User[]> {
  try {
    if (!client) return []
    const { data, error } = await client.from('users').select('*')
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

export async function addUser(user: User): Promise<any> {
  if (!client) throw new Error('Supabase not configured')
  const { data, error } = await client.from('users').insert([user]).select()
  if (error) throw error
  return data
}

export async function deleteUser(id: number): Promise<void> {
  if (!client) throw new Error('Supabase not configured')
  const { error } = await client.from('users').delete().eq('id', id)
  if (error) throw error
}

export async function updateUser(id: number, user: Partial<User>): Promise<any> {
  if (!client) throw new Error('Supabase not configured')
  const { data, error } = await client.from('users').update(user).eq('id', id).select()
  if (error) throw error
  return data
}

export async function getMedicines(): Promise<Medicine[]> {
  try {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('medicines')
      if (saved) return JSON.parse(saved)
    }
    if (!client) return defaultMedicines
    const { data, error } = await client.from('medicines').select('*')
    if (error) return defaultMedicines
    return data && data.length > 0 ? data : defaultMedicines
  } catch {
    return defaultMedicines
  }
}

export async function addMedicine(medicine: Medicine): Promise<any> {
  if (!client) throw new Error('Supabase not configured')
  const { data, error } = await client.from('medicines').insert([medicine]).select()
  if (error) throw error
  return data
}

export async function updateMedicine(id: number, medicine: Medicine): Promise<any> {
  if (!client) throw new Error('Supabase not configured')
  const { data, error } = await client.from('medicines').update(medicine).eq('id', id).select()
  if (error) throw error
  return data
}

export async function deleteMedicine(id: number): Promise<void> {
  if (!client) throw new Error('Supabase not configured')
  const { error } = await client.from('medicines').delete().eq('id', id)
  if (error) throw error
}

export async function getPrescriptions(): Promise<Prescription[]> {
  try {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('prescriptions')
      if (saved) return JSON.parse(saved)
    }
    if (!client) return []
    const { data, error } = await client.from('prescriptions').select('*').order('created_at', { ascending: false })
    if (error) return []
    return data || []
  } catch {
    return []
  }
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
  if (!client) throw new Error('Supabase not configured')
  const { data: presData, error: presError } = await client.from('prescriptions').insert([prescription]).select()
  if (presError) throw presError
  const prescriptionId = presData[0].id
  const itemsWithPrescriptionId = items.map(item => ({ ...item, prescription_id: prescriptionId }))
  const { error: itemsError } = await client.from('prescription_items').insert(itemsWithPrescriptionId)
  if (itemsError) throw itemsError
  return presData[0]
}

export async function deletePrescription(id: number): Promise<void> {
  if (typeof window !== 'undefined') {
    const prescriptions = await getPrescriptions()
    const filtered = prescriptions.filter(p => p.id !== id)
    localStorage.setItem('prescriptions', JSON.stringify(filtered))
    localStorage.removeItem('prescription_items_' + id)
    return
  }
  if (!client) throw new Error('Supabase not configured')
  await client.from('prescription_items').delete().eq('prescription_id', id)
  const { error } = await client.from('prescriptions').delete().eq('id', id)
  if (error) throw error
}

export async function getFormulas(): Promise<Formula[]> {
  try {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('formulas')
      if (saved) return JSON.parse(saved)
    }
    if (!client) return []
    const { data, error } = await client.from('formulas').select('*')
    if (error) return []
    if (!data || data.length === 0) return []
    return Promise.all(data.map(async (formula: any) => {
      if (!client) return formula
      const { data: compositions } = await client.from('formula_compositions').select('*').eq('formula_id', formula.id)
      return { ...formula, compositions: compositions || [] }
    }))
  } catch {
    return []
  }
}

export async function addFormula(formula: Omit<Formula, 'id'>, compositions: FormulaComposition[]) {
  if (!client) throw new Error('Supabase not configured')
  const { data: formulaData, error: formulaError } = await client.from('formulas').insert([formula]).select()
  if (formulaError) throw formulaError
  const formulaId = formulaData[0].id
  const compositionsWithFormulaId = compositions.map(comp => ({ ...comp, formula_id: formulaId }))
  const { error: compError } = await client.from('formula_compositions').insert(compositionsWithFormulaId)
  if (compError) throw compError
  return formulaData[0]
}

export async function deleteFormula(id: number): Promise<void> {
  if (!client) throw new Error('Supabase not configured')
  await client.from('formula_compositions').delete().eq('formula_id', id)
  const { error } = await client.from('formulas').delete().eq('id', id)
  if (error) throw error
}

export async function exportAllData() {
  if (typeof window !== 'undefined') {
    const medicines = localStorage.getItem('medicines') ? JSON.parse(localStorage.getItem('medicines')!) : defaultMedicines
    const prescriptions = localStorage.getItem('prescriptions') ? JSON.parse(localStorage.getItem('prescriptions')!) : []
    const formulas = localStorage.getItem('formulas') ? JSON.parse(localStorage.getItem('formulas')!) : []
    const users = localStorage.getItem('cloudUsers') ? JSON.parse(localStorage.getItem('cloudUsers')!) : []
    return { medicines, prescriptions, formulas, users, exportDate: new Date().toISOString() }
  }
  const [medicines, prescriptions, formulas] = await Promise.all([
    getMedicines(),
    getPrescriptions(),
    getFormulas()
  ])
  return { medicines, prescriptions, formulas, exportDate: new Date().toISOString() }
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
  if (!client) throw new Error('Supabase not configured')
  if (data.medicines && data.medicines.length > 0) {
    for (const medicine of data.medicines) {
      const { id, created_at, ...medicineData } = medicine
      await client.from('medicines').upsert(medicineData)
    }
  }
  if (data.formulas && data.formulas.length > 0) {
    for (const formula of data.formulas) {
      const { id, created_at, compositions, ...formulaData } = formula
      const { data: newFormula } = await client.from('formulas').insert([formulaData]).select()
      if (newFormula && newFormula[0] && compositions) {
        const compositionsWithId = compositions.map((comp: any) => ({ ...comp, formula_id: newFormula[0].id }))
        await client.from('formula_compositions').insert(compositionsWithId)
      }
    }
  }
  return { success: true }
}