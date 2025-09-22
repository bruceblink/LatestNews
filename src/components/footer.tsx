import dayjs from "dayjs/esm";
import { APP_NAME, ProjectUrl } from "@shared/consts";

export function Footer() {
  return (
    <>
      <a href={`${ProjectUrl}/blob/main/LICENSE`} target="_blank">
        MIT LICENSE
      </a>
      <span>
        <span>
          {APP_NAME} © {dayjs().year()} By{" "}
        </span>
        <a href={Author.url} target="_blank">
          {Author.name}
        </a>
      </span>
    </>
  );
}
