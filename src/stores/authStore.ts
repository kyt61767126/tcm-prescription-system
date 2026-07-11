import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User } from '../types';

interface AuthStore {
  user: User | null;
  hasHydrated: boolean;
  login: (user: User) => void;
  logout: () => void;
  isAdmin: () => boolean;
  isGlobalAdmin: () => boolean;
  setHasHydrated: (state: boolean) => void;
  setRegistrationFee: (fee: number) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      hasHydrated: false,
      login: (user: User) => set({ user }),
      logout: () => set({ user: null }),
      isAdmin: () => {
        const role = get().user?.role;
        return role === 'admin' || role === 'globalAdmin';
      },
      isGlobalAdmin: () => get().user?.role === 'globalAdmin',
      setHasHydrated: (state: boolean) => set({ hasHydrated: state }),
      setRegistrationFee: (fee: number) =>
        set((state) => ({
          user: state.user ? { ...state.user, registrationFee: fee } : null,
        })),
    }),
    {
      name: 'tcm-auth',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
