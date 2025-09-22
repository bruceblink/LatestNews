/**
 * 缓存过期时间
 */
import packageJSON from "../package.json";

export const TTL = 30 * 60 * 1000;
/**
 * 默认刷新间隔, 10 min
 */
export const Interval = 10 * 60 * 1000;
// 项目名称
export const APP_NAME = packageJSON.name;
// GitHub项目地址
export const PROJECT_URL = packageJSON.projectUrl;
// 应用部署地址
export const HOME_PAGE = packageJSON.homepage;

export const Version = packageJSON.version;
export const Author = packageJSON.author;
