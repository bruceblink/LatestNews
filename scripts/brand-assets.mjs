import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const jobs = [
    ["public/icon.svg", "public/apple-touch-icon.png", 180],
    ["public/icon.svg", "public/pwa-192x192.png", 192],
    ["public/icon.svg", "public/pwa-512x512.png", 512],
    ["public/og-image.svg", "public/og-image.png", 1200],
];

for (const [input, output, width] of jobs) {
    const svg = readFileSync(input, "utf8");
    const png = new Resvg(svg, {
        fitTo: {
            mode: "width",
            value: width,
        },
    })
        .render()
        .asPng();

    writeFileSync(output, png);
}