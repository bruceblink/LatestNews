export interface LabeledNewsEventPair {
    label: "same" | "different";
    left: { title: string; url: string; publishedAt: number };
    right: { title: string; url: string; publishedAt: number };
}

const SAMPLE_NOW = Date.parse("2026-07-05T08:00:00.000Z");
const POSITIVE_SEEDS = [
    { entity: "OpenAI", version: "GPT-5", subject: "模型" },
    { entity: "Anthropic", version: "Claude-4", subject: "模型" },
    { entity: "Linux", version: "6.12", subject: "内核" },
    { entity: "Rust", version: "1.85", subject: "编译器" },
];

/** 生成跨语言、跨来源的正例，覆盖稳定实体、版本号和事件时间窗口。 */
const positivePairs = Array.from({ length: 100 }, (_, index) => {
    const seed = POSITIVE_SEEDS[index % POSITIVE_SEEDS.length];
    const publishedAt = SAMPLE_NOW - (index % 3) * 24 * 60 * 60 * 1000;
    return {
        label: "same" as const,
        left: {
            title: `${seed.entity} 发布 ${seed.version} ${seed.subject}，官方公布更新 ${index}`,
            url: `https://first.example.com/${seed.entity.toLowerCase()}-${index}`,
            publishedAt,
        },
        right: {
            title: `${seed.entity} ${seed.version} ${seed.subject} 更新与影响解读 ${index}`,
            url: `https://second.example.com/${seed.entity.toLowerCase()}-${index}`,
            publishedAt: publishedAt + 60 * 60 * 1000,
        },
    };
});

/** 生成负例，覆盖实体、版本、事件类型和时间窗口冲突。 */
const negativePairs = Array.from({ length: 100 }, (_, index) => {
    const mode = index % 4;
    if (mode === 0) {
        return {
            label: "different" as const,
            left: {
                title: `OpenAI 发布 GPT-5 模型更新 ${index}`,
                url: `https://first.example.com/openai-release-${index}`,
                publishedAt: SAMPLE_NOW,
            },
            right: {
                title: `Anthropic 发布 Claude-4 模型更新 ${index}`,
                url: `https://second.example.com/anthropic-release-${index}`,
                publishedAt: SAMPLE_NOW,
            },
        };
    }
    if (mode === 1) {
        return {
            label: "different" as const,
            left: {
                title: `OpenAI 发布 GPT-5 模型更新 ${index}`,
                url: `https://first.example.com/openai-gpt5-${index}`,
                publishedAt: SAMPLE_NOW,
            },
            right: {
                title: `OpenAI 发布 GPT-6 模型更新 ${index}`,
                url: `https://second.example.com/openai-gpt6-${index}`,
                publishedAt: SAMPLE_NOW,
            },
        };
    }
    if (mode === 2) {
        return {
            label: "different" as const,
            left: {
                title: `OpenAI 发布 GPT-5 模型 ${index}`,
                url: `https://first.example.com/openai-release-${index}`,
                publishedAt: SAMPLE_NOW,
            },
            right: {
                title: `OpenAI GPT-5 安全漏洞 ${index}`,
                url: `https://second.example.com/openai-security-${index}`,
                publishedAt: SAMPLE_NOW,
            },
        };
    }
    return {
        label: "different" as const,
        left: {
            title: `OpenAI 发布 GPT-5 模型更新 ${index}`,
            url: `https://first.example.com/openai-old-${index}`,
            publishedAt: SAMPLE_NOW - 30 * 24 * 60 * 60 * 1000,
        },
        right: {
            title: `OpenAI GPT-5 模型更新 ${index}`,
            url: `https://second.example.com/openai-new-${index}`,
            publishedAt: SAMPLE_NOW,
        },
    };
});

export const NEWS_EVENT_LABELED_PAIRS: LabeledNewsEventPair[] = [...positivePairs, ...negativePairs];
