import dayjs from "dayjs/esm";
import { APP_TITLE } from "~/utils/app-title";
import { Author, PROJECT_URL } from "@shared/consts";

export function Footer() {
    return (
        <>
            <a
                href={`${PROJECT_URL}/blob/main/LICENSE.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="app-footer-link"
            >
                GPLv3 / AGPLv3 · 无担保
            </a>
            <span className="app-footer-credit">
                <span>
                    <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer" className="app-footer-link">
                        {`${APP_TITLE} `}
                    </a>
                    © {dayjs().year()} By{" "}
                </span>
                <a href={Author.url} target="_blank" rel="noopener noreferrer" className="app-footer-link">
                    {Author.name}
                </a>
            </span>
        </>
    );
}
