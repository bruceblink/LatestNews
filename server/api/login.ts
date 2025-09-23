import process from "node:process";

export default defineEventHandler(async (event) => {
    sendRedirect(event, `https://github.com/login/oauth/authorize?client_id=${process.env.G_CLIENT_ID}`);
});
