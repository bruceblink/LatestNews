import sources from "../shared/sources.json"

Promise.all(Object.keys(sources).map(id =>
  fetch(`https://newsnow.busiyi.world/api/s?id=${id}`),
)).catch(console.error)
