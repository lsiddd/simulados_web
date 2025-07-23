
// --- CONFIGURATION ---
export const API_BASE_URL = '/api';

// --- MOCK ANALYTICS ---
export const Analytics = {
    track: (eventName, properties) => {
        console.log(`[Analytics] Event: ${eventName}`, properties);
        // Em um aplicativo real, você enviaria esses dados para um serviço
        // como Google Analytics, Mixpanel, etc.
    }
};

// --- THEME MANAGEMENT ---
export async function initTheme() {
    const themeSwitcher = document.getElementById('btn-theme-switcher');
    try {
        const response = await fetch(`${API_BASE_URL}/user/theme`);
        const data = await response.json();
        const savedTheme = data.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        setTheme(savedTheme, false);
    } catch (e) {
        // fallback to system preference
        const fallbackTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        setTheme(fallbackTheme, false);
    }

    // Attach listener only if the button exists on the current page
    themeSwitcher?.addEventListener('click', () => {
        const newTheme = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        setTheme(newTheme, true);
    });
}

export async function setTheme(theme, save = true) {
    const themeSwitcher = document.getElementById('btn-theme-switcher');
    document.body.setAttribute('data-theme', theme);
    if (themeSwitcher) {
        themeSwitcher.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    if (save) {
        try {
            await fetch(`${API_BASE_URL}/user/theme`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme })
            });
        } catch (e) {
            console.error("Failed to save theme", e);
        }
    }
}

// --- UTILITY FUNCTIONS ---

/**
 * Generates a simple, non-cryptographic hash from a string.
 * @param {string} enunciado The string to hash.
 * @returns {number} A 32-bit integer hash.
 */
export function getQuestionHash(enunciado) {
    let hash = 0, i, chr;
    if (!enunciado || enunciado.length === 0) return hash;
    for (i = 0; i < enunciado.length; i++) {
        chr = enunciado.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

/**
 * Displays a temporary notification toast.
 * @param {string} message The message to display.
 * @param {boolean} isError True if the toast should have an error style.
 */
export function showToast(message, isError = false) {
    const toast = document.getElementById('error-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = 'error-toast'; // Reset classes
    if (isError) {
        toast.classList.add('error'); // Use a specific class for error styling
    }
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, isError ? 5000 : 3000);
}   