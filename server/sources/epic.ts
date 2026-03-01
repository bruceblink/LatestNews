import { myFetch } from "#/utils/fetch";
import { defineSource, generateUrlHashId } from "#/utils/source";

interface FreeGameItem {
    title: string;
    description: string;
    productSlug: string | null;
    urlSlug: string;
    keyImages: { type: string; url: string }[];
    promotions: {
        promotionalOffers: {
            startDate: string;
            endDate: string;
            discountSetting: {
                discountPercentage: number;
            };
        }[];
    }[];
}

const freeGame = defineSource(async () => {
    const url =
        "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN";

    const res: any = await myFetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Referer: "https://store.epicgames.com/",
        },
    });

    const games: FreeGameItem[] = res?.data?.Catalog?.searchStore?.elements || [];

    return Promise.all(
        games.map(async (game) => {
            const promo = game.promotions?.[0]?.promotionalOffers?.[0];

            const slug = game.productSlug || game.urlSlug || "";
            const fulUrl = slug ? `https://store.epicgames.com/zh-CN/p/${slug}` : "";

            const cover = game.keyImages.find((e) => e.type === "OfferImageWide")?.url || game.keyImages[0]?.url || "";

            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: game.title.replace("Mystery Game", "神秘游戏"),
                url: fulUrl,
                pubDate: promo?.startDate,
                extra: {
                    info: "Epic Games Store · 今日免费",
                    hover: game.description || "",
                    icon: cover,
                },
            };
        })
    );
});

export default defineSource({
    epic: freeGame,
    "epic-free-game": freeGame,
});
