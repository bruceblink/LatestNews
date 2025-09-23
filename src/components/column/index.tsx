import type { FixedColumnID } from "@shared/types";

import { useTitle } from "react-use";
import { currentColumnIDAtom } from "~/atoms";

import { Dnd } from "./dnd";
import { NavBar } from "../navbar";

export function Column({ id }: { id: FixedColumnID }) {
    const [currentColumnID, setCurrentColumnID] = useAtom(currentColumnIDAtom);
    useEffect(() => {
        setCurrentColumnID(id);
    }, [id, setCurrentColumnID]);

    useTitle(`${import.meta.env.VITE_APP_TITLE} | ${metadata[id].name}`);

    return (
        <>
            <div className="flex justify-center md:hidden mb-6">
                <NavBar />
            </div>
            {id === currentColumnID && <Dnd />}
        </>
    );
}
