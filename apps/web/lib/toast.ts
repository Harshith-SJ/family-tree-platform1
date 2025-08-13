import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';
export type Toast = { id: string; message: string; type: ToastType };

type ToastState = {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  remove: (id: string) => void;
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, ...t } as Toast;
    set((s) => ({ toasts: [...s.toasts, toast] }));
    // auto dismiss in 3 seconds
    setTimeout(() => get().remove(id), 3000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success(message: string) {
    useToastStore.getState().push({ message, type: 'success' });
  },
  error(message: string) {
    useToastStore.getState().push({ message, type: 'error' });
  },
  info(message: string) {
    useToastStore.getState().push({ message, type: 'info' });
  },
};
