import process from "node:process";
import { sendRedirect, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
    await sendRedirect(event, `https://github.com/login/oauth/authorize?client_id=${process.env.G_CLIENT_ID}`);
});
