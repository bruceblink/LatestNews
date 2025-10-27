import dayjs from "dayjs/esm";
import { Author, PROJECT_URL } from "@shared/consts";

export function Footer() {
    return (
        <>
            <a href={`${PROJECT_URL}/blob/main/LICENSE`} target="_blank" className="btn text-sm ml-1 font-mono">
                MIT LICENSE
            </a>
            <span>
                <span>
                    <a href={PROJECT_URL} target="_blank" className="btn text-sm ml-1 font-mono">
                        {`${import.meta.env.VITE_APP_TITLE} `}
                    </a>
                    © {dayjs().year()} By{" "}
                </span>
                <a href={Author.url} target="_blank" className="btn text-sm ml-1 font-mono">
                    {Author.name}
                </a>
            </span>
        </>
    );
}
