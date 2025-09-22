const searchBarAtom = atom(false);

export function useSearchBar() {
    const [opened, setOpened] = useAtom(searchBarAtom);
    const toggle = useCallback(
        (status?: boolean) => {
      if (status !== undefined) setOpened(status);
      else setOpened((v) => !v);
        },
        [setOpened]
    );
  return {
    opened,
    toggle,
  };
}
