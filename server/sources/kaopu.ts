import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

type Res = {
    description: string;
    link: string;
    // Date
    pubDate: string;
    publisher: string;
    title: string;
}[];
export default defineSource(async () => {
    const res = await Promise.all(
        [
            "https://kaopustorage.blob.core.windows.net/jsondata/news_list_beta_hans_0.json",
            "https://kaopustorage.blob.core.windows.net/jsondata/news_list_beta_hans_1.json",
        ].map((url) => myFetch(url) as Promise<Res>)
    );
    return await Promise.all(
        res
            .flat()
            .filter((k) => ["财新", "公视"].every((h) => k.publisher !== h))
            .map(async (k) => {
                const hashId = await generateUrlHashId(k.link);
                return {
                    id: hashId,
                    title: k.title,
                    pubDate: k.pubDate,
                    extra: {
                        hover: k.description,
                        info: k.publisher,
                    },
                    url: k.link,
                };
            })
    );
});
