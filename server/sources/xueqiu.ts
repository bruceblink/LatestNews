import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface StockRes {
    data: {
        items: {
            code: string;
            name: string;
            percent: number;
            exchange: string;
            // 1
            ad: number;
        }[];
    };
}

const hotstock = defineSource(async () => {
    const url = "https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=30&_type=10&type=10";
    const cookie = (await $fetch.raw("https://xueqiu.com/hq")).headers.getSetCookie();
    const res: StockRes = await myFetch(url, {
        headers: {
            cookie: cookie.join("; "),
        },
    });
    return await Promise.all(
        res.data.items
            .filter((k) => !k.ad)
            .map(async (k) => {
                const fulUrl = `https://xueqiu.com/s/${k.code}`;
                const hashId = await generateUrlHashId(fulUrl);
                return {
                    id: hashId,
                    url: `https://xueqiu.com/s/${k.code}`,
                    title: k.name,
                    extra: {
                        info: `${k.percent}% ${k.exchange}`,
                    },
                };
            })
    );
});

export default defineSource({
    xueqiu: hotstock,
    "xueqiu-hotstock": hotstock,
});
