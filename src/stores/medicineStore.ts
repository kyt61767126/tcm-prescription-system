import { create } from 'zustand';
import { Medicine, Formula } from '../types';

interface MedicineStore {
  medicines: Medicine[];
  formulas: Formula[];
  setMedicines: (medicines: Medicine[]) => void;
  setFormulas: (formulas: Formula[]) => void;
  searchMedicines: (query: string) => Medicine[];
  searchFormulas: (query: string) => Formula[];
}

export const useMedicineStore = create<MedicineStore>()((set, get) => ({
  medicines: [],
  formulas: [],

  setMedicines: (medicines) => set({ medicines }),
  setFormulas: (formulas) => set({ formulas }),

  searchMedicines: (query) => {
    const q = query.toLowerCase().trim();
    if (!q) return get().medicines;
    return get().medicines.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q)
    );
  },

  searchFormulas: (query) => {
    const q = query.toLowerCase().trim();
    if (!q) return get().formulas;
    return get().formulas.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.composition.toLowerCase().includes(q)
    );
  },
}));
