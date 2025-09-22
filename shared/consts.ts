/**
 * 缓存过期时间
 */
import packageJSON from "../package.json";

export const TTL = 30 * 60 * 1000;
/**
 * 默认刷新间隔, 10 min
 */
export const Interval = 10 * 60 * 1000;
// GitHub项目地址
export const ProjectUrl = packageJSON.projectUrl;
// 应用部署地址
export const HomePage = packageJSON.homepage;

export const Version = packageJSON.version;
export const Author = packageJSON.author;
