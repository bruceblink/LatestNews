import type { FixedColumnID } from "@shared/types";

import { useAtom } from "jotai";
import { useEffect } from "react";
import { useTitle } from "react-use";
import { APP_TITLE } from "~/utils/app-title";
import { currentColumnIDAtom } from "~/atoms";
import { metadata } from "@shared/metadata.ts";

import { Dnd } from "./dnd";
import { NavBar } from "../navbar";

export function Column({ id }: { id: FixedColumnID }) {
    const [currentColumnID, setCurrentColumnID] = useAtom(currentColumnIDAtom);
    useEffect(() => {
        setCurrentColumnID(id);
    }, [id, setCurrentColumnID]);

    useTitle(`${APP_TITLE} | ${metadata[id].name}`);

    return (
        <>
            <div className="flex justify-center md:hidden mb-6">
                <NavBar />
            </div>
            {id === currentColumnID && <Dnd />}
        </>
    );
}
