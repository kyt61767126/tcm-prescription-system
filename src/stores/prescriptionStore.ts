import { create } from 'zustand';
import { Prescription, PrescriptionFormData, MedicineItem } from '../types';
import { formatDate, calculateTotalPrice, generateId } from '../utils/helpers';

interface PrescriptionStore {
  currentForm: PrescriptionFormData;
  prescriptions: Prescription[];
  setFormField: <K extends keyof PrescriptionFormData>(field: K, value: PrescriptionFormData[K]) => void;
  addMedicine: (medicine: Omit<MedicineItem, 'id'>) => void;
  updateMedicine: (index: number, updates: Partial<MedicineItem>) => void;
  removeMedicine: (index: number) => void;
  clearForm: () => void;
  setPrescriptions: (prescriptions: Prescription[]) => void;
  deletePrescription: (id: number) => void;
  getTotalPrice: () => number;
  createPrescription: (createdBy: string) => Prescription;
}

const defaultForm: PrescriptionFormData = {
  patientName: '',
  gender: '',
  age: '',
  phone: '',
  visitDate: formatDate(new Date()),
  symptoms: '',
  diagnosis: '',
  medicines: [],
};

export const usePrescriptionStore = create<PrescriptionStore>()((set, get) => ({
  currentForm: defaultForm,
  prescriptions: [],

  setFormField: (field, value) =>
    set((state) => ({
      currentForm: { ...state.currentForm, [field]: value },
    })),

  addMedicine: (medicine) =>
    set((state) => ({
      currentForm: {
        ...state.currentForm,
        medicines: [...state.currentForm.medicines, { ...medicine, id: generateId() }],
      },
    })),

  updateMedicine: (index, updates) =>
    set((state) => ({
      currentForm: {
        ...state.currentForm,
        medicines: state.currentForm.medicines.map((m, i) =>
          i === index ? { ...m, ...updates } : m
        ),
      },
    })),

  removeMedicine: (index) =>
    set((state) => ({
      currentForm: {
        ...state.currentForm,
        medicines: state.currentForm.medicines.filter((_, i) => i !== index),
      },
    })),

  clearForm: () =>
    set({
      currentForm: {
        ...defaultForm,
        visitDate: formatDate(new Date()),
      },
    }),

  setPrescriptions: (prescriptions) => set({ prescriptions }),

  deletePrescription: (id) =>
    set((state) => ({
      prescriptions: state.prescriptions.filter((p) => p.id !== id),
    })),

  getTotalPrice: () => calculateTotalPrice(get().currentForm.medicines),

  createPrescription: (createdBy) => {
    const form = get().currentForm;
    return {
      id: generateId(),
      prescriptionNo: '',
      patientName: form.patientName,
      gender: form.gender,
      age: form.age,
      phone: form.phone,
      visitDate: form.visitDate,
      symptoms: form.symptoms,
      diagnosis: form.diagnosis,
      medicines: form.medicines,
      totalPrice: get().getTotalPrice(),
      createdBy,
      createdAt: new Date().toISOString(),
    };
  },
}));
