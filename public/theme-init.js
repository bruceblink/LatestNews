// Apply the stored theme before application modules load; keep this script external for the desktop CSP.
(() => {
    let colorScheme = "light";
    try {
        colorScheme = JSON.parse(localStorage.getItem("color-scheme") ?? '"light"');
    } catch {
        // Unavailable or malformed storage must not prevent the page from loading.
    }
    const isDark =
        colorScheme === "dark" ||
        (colorScheme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
})();
