import { eventHandler, setResponseHeader } from "h3";
import { rendererTemplate } from "#nitro/virtual/renderer-template";

// Return the built SPA shell for client-side routes that do not have a server handler.
export default eventHandler((event) => {
    setResponseHeader(event, "content-type", "text/html; charset=utf-8");
    return rendererTemplate(event.req);
});
