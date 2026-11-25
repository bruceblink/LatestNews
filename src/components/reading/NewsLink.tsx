import type { ComponentPropsWithoutRef } from "react";

import { newsLinkHref } from "@shared/news-url-policy";

type Props = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
    href: string;
    preferredHref?: string;
};

/** Legacy history/cache entries remain readable and removable, but cannot navigate. */
export function NewsLink({ href, preferredHref, onClick, ...props }: Props) {
    const safeHref = newsLinkHref(href, preferredHref);
    return (
        <a
            {...props}
            href={safeHref}
            aria-disabled={safeHref ? undefined : true}
            title={safeHref ? props.title : "链接无效，无法打开"}
            onClick={safeHref ? onClick : (event) => event.preventDefault()}
        />
    );
}
