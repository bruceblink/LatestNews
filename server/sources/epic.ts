import { myFetch } from "#/utils/fetch";
import { defineSource, generateUrlHashId } from "#/utils/source";

interface GameItem {
    title: string;
    id: string;
    namespace: string;
    description: string;
    effectiveDate: string;
    offerType: string;
    expiryDate: null;
    viewableDate: string;
    status: string;
    isCodeRedemptionOnly: boolean;
    keyImages: { type: string; url: string }[];
    seller: { id: string; name: string };
    productSlug: null | string;
    urlSlug: string;
    url: null;
    items: { id: string; namespace: string }[];
    customAttributes: { key: string; value: string }[];
    categories: { path: string }[];
    tags: { id: string }[];
    catalogNs: { mappings: { pageSlug: string; pageType: string }[] | null };
    offerMappings: { pageSlug: string; pageType: string }[] | null;
    price: {
        totalPrice: {
            discountPrice: number;
            originalPrice: number;
            voucherDiscount: number;
            discount: number;
            currencyCode: string;
            currencyInfo: { decimals: number };
            fmtPrice: {
                originalPrice: string;
                discountPrice: string;
                intermediatePrice: string;
            };
        };
        lineOffers: {
            appliedRules: {
                id: string;
                endDate: string;
                discountSetting: { discountType: string };
            }[];
        }[];
    };
    promotions: null | {
        promotionalOffers: {
            promotionalOffers: {
                startDate: string;
                endDate: string;
                discountSetting: {
                    discountType: string;
                    discountPercentage: number;
                };
            }[];
        }[];
        upcomingPromotionalOffers: {
            promotionalOffers: {
                startDate: string;
                endDate: string;
                discountSetting: {
                    discountType: string;
                    discountPercentage: number;
                };
            }[];
        }[];
    };
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
    const allGames = (res?.data?.Catalog?.searchStore?.elements || []) as GameItem[];

    const activeGames = allGames.filter((e) => ["OTHERS", "BASE_GAME"].some((type) => type === e.offerType));

    return await Promise.all(
        activeGames.map(async (game) => {
            const slug =
                game.productSlug ||
                game.catalogNs?.mappings?.[0]?.pageSlug ||
                game.offerMappings?.[0]?.pageSlug ||
                game.urlSlug ||
                "";
            const fulUrl = slug ? `https://store.epicgames.com/store/zh-CN/p/${slug}` : "";

            const originalCover =
                game.keyImages?.find((e) => e.type === "OfferImageWide")?.url || game.keyImages[0]?.url || "";

            const cover = originalCover.startsWith("http")
                ? originalCover
                : originalCover.includes("?cover=")
                  ? decodeURIComponent(originalCover.split("?cover=")[1] || "")
                  : originalCover;

            const hashId = await generateUrlHashId(fulUrl);
            return {
                id: hashId,
                title: (game.title || "-").replace("Mystery Game", "神秘游戏"),
                url: fulUrl,
                extra: {
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
