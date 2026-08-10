import { defineRSSSource } from "../utils/source";

export const FREEBUF_RSS_URL = "https://www.freebuf.com/rss";

// FreeBuf's RSS endpoint is stable on serverless egress, while its homepage may reject automated requests.
export default defineRSSSource(FREEBUF_RSS_URL);
