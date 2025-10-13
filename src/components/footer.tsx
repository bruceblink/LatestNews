import dayjs from "dayjs/esm";
import { Author, PROJECT_URL } from "@shared/consts";

export function Footer() {
    return (
        <>
            <a href={`${PROJECT_URL}/blob/main/LICENSE`} target="_blank">
                MIT LICENSE
            </a>
            <span>
                <span>
                    {`${import.meta.env.VITE_APP_TITLE}`} © {dayjs().year()} By{" "}
                </span>
                <a href={Author.url} target="_blank">
                    {Author.name}
                </a>
            </span>
        </>
    );
}
