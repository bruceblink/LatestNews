import packageJSON from "../package.json";
import sources from "../shared/sources.json";
const HOME_PAGE = packageJSON.homepage;

Promise.all(Object.keys(sources).map((id) => fetch(`${HOME_PAGE}/api/s?id=${id}`))).catch(console.error);
