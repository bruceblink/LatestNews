import {ProjectUrl} from "@shared/consts";

export function Footer() {
  return (
    <>
        <a href={`${ProjectUrl}/blob/main/LICENSE`} target="_blank">MIT LICENSE</a>
      <span>
        <span>NewsNow © 2024 By </span>
        <a href={Author.url} target="_blank">
          {Author.name}
        </a>
      </span>
    </>
  );
}
