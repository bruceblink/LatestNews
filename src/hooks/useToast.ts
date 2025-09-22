import type {ToastItem} from "~/atoms/types";

export const toastAtom = atom<ToastItem[]>([]);
export function useToast() {
  const setToastItems = useSetAtom(toastAtom);
  return useCallback((msg: string, props?: Omit<ToastItem, "id" | "msg">) => {
    setToastItems(prev => [
      {
        msg,
        id: Date.now(),
        ...props,
      },
      ...prev,
    ]);
  }, [setToastItems]);
}
