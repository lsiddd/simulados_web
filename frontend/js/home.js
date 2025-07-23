import { API_BASE_URL, initTheme, showToast } from './common.js';

// --- DOM ELEMENTS ---
const simuladosGrid = document.getElementById('simulados-grid');
const savedProgressList = document.getElementById('saved-progress-list');
const bookmarkedTabContent = document.getElementById('bookmarked-tab-content');
const tabSimulados = document.getElementById('tab-simulados');
const tabBookmarked = document.getElementById('tab-bookmarked');

// --- STATE ---
let allSimulados = []; // Cache for the list of quizzes
let bookmarksLoaded = false; // Lazy loading flag

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupTabs();
    initializeHomepage();
});

/**
 * Fetches the list of quizzes, then renders the main list and saved progress.
 */
async function initializeHomepage() {
    try {
        const response = await fetch(`${API_BASE_URL}/simulados`);
        if (!response.ok) throw new Error('Falha ao carregar a lista de simulados.');
        allSimulados = await response.json();

        renderSimuladosList();
        renderSavedProgress(); // Initial render
    } catch (error) {
        console.error(error);
        simuladosGrid.innerHTML = `<p style="text-align: center;">Erro ao carregar os simulados. Tente recarregar a página.</p>`;
    }
}

/**
 * Renders the main list of available quizzes.
 */
function renderSimuladosList() {
    if (!simuladosGrid) return;
    simuladosGrid.innerHTML = allSimulados.map(simulado => `
        <div class="card simulado-card">
            <div class="badge">${simulado.questoes_count} Questões</div>
            <h2>${simulado.titulo}</h2>
            <p>${simulado.descricao}</p>
            <a href="simulado.html?id=${simulado.id}" class="button button-primary">▶ Iniciar Simulado</a>
        </div>
    `).join('');
}

/**
 * Renders cards for quizzes with saved progress from localStorage.
 */
function renderSavedProgress() {
    if (!savedProgressList) return;

    // Use a more specific key to avoid conflicts
    const savedKeys = Object.keys(localStorage).filter(k => k.startsWith('simuladoProgress_'));

    if (savedKeys.length === 0) {
        savedProgressList.innerHTML = '';
        return;
    }
    
    const cards = savedKeys.map(key => {
        try {
            const simuladoId = key.replace('simuladoProgress_', '');
            const simulado = allSimulados.find(s => s.id === simuladoId);
            if (!simulado) return ''; // Progress for a quiz that no longer exists

            const progress = JSON.parse(localStorage.getItem(key));
            const current = (progress.currentQuestionIndex || 0) + 1;
            const total = simulado.questoes_count || 0;
            return `
                <div class="card simulado-card">
                    <div class="badge">Progresso Salvo</div>
                    <h2>${simulado.titulo}</h2>
                    <p>${simulado.descricao}</p>
                    <p><strong>Questão:</strong> ${current} de ${total}</p>
                    <a href="simulado.html?id=${simulado.id}" class="button button-success">⏩ Retomar Simulado</a>
                    <button class="button button-secondary btn-remove-progress" data-key="${key}">Remover</button>
                </div>
            `;
        } catch {
            return ''; // Ignore malformed progress data
        }
    }).filter(Boolean).join('');

    if (cards.length === 0) {
        savedProgressList.innerHTML = '';
    } else {
        savedProgressList.innerHTML = `<h2 style="width:100%;">Progresso Salvo</h2>` + cards;
    }
}

// EFFICIENT JS: Use event delegation for the "remove progress" buttons
savedProgressList.addEventListener('click', function(e) {
    if (e.target && e.target.matches('.btn-remove-progress')) {
        const key = e.target.getAttribute('data-key');
        if (key) {
            localStorage.removeItem(key);
            showToast('Progresso removido.');
            renderSavedProgress(); // Re-render only this section, no page reload
        }
    }
});

// --- TABS & LAZY LOADING ---

/**
 * Sets up tab navigation and implements lazy loading for the Bookmarked tab.
 */
function setupTabs() {
    if (!tabSimulados || !tabBookmarked) return;

    tabSimulados.classList.add('button', 'button-secondary', 'active');
    tabBookmarked.classList.add('button', 'button-secondary');

    tabSimulados.addEventListener('click', () => {
        tabSimulados.classList.add('active');
        tabBookmarked.classList.remove('active');
        simuladosGrid.classList.remove('hidden');
        savedProgressList.classList.remove('hidden');
        bookmarkedTabContent.classList.add('hidden');
    });

    tabBookmarked.addEventListener('click', () => {
        tabBookmarked.classList.add('active');
        tabSimulados.classList.remove('active');
        simuladosGrid.classList.add('hidden');
        savedProgressList.classList.add('hidden');
        bookmarkedTabContent.classList.remove('hidden');
        
        // LAZY LOADING: Only load bookmarks when the tab is first clicked
        if (!bookmarksLoaded) {
            renderAllBookmarkedQuestions();
            bookmarksLoaded = true;
        }
    });
}

/**
 * Fetches and renders all bookmarked questions from all quizzes.
 */
async function renderAllBookmarkedQuestions() {
    if (!bookmarkedTabContent) return;
    bookmarkedTabContent.innerHTML = '<p style="text-align:center;">Carregando questões marcadas...</p>';

    try {
        const [bookmarksRes, simuladosRes] = await Promise.all([
            fetch(`${API_BASE_URL}/user/bookmarks`),
            fetch(`${API_BASE_URL}/simulados`)
        ]);

        if (!bookmarksRes.ok) throw new Error('Falha ao carregar as questões marcadas.');
        const bookmarks = await bookmarksRes.json();
        const simulados = simuladosRes.ok ? await simuladosRes.json() : [];

        if (bookmarks.length === 0) {
            bookmarkedTabContent.innerHTML = '<p style="text-align:center;">Nenhuma questão marcada encontrada.</p>';
            return;
        }

        const simuladosMap = new Map(simulados.map(s => [s.id, s.titulo]));

        bookmarkedTabContent.innerHTML = '<h2 style="width:100%;">Questões Marcadas</h2>' + bookmarks.map(bq => `
            <div class="card simulado-card">
                <div class="badge">${bq.category || 'Marcada'}</div>
                <h3>${bq.enunciado}</h3>
                <p><strong>Simulado:</strong> ${simuladosMap.get(bq.simulado_id) || bq.simulado_id}</p>
                <button class="button button-primary btn-one-question" data-simulado="${bq.simulado_id}" data-question-hash="${bq.question_hash}">Estudar esta questão</button>
            </div>
        `).join('');

        // EFFICIENT JAVASCRIPT: Use event delegation for "study question" buttons
        bookmarkedTabContent.addEventListener('click', function(e) {
            if (e.target && e.target.matches('.btn-one-question')) {
                const simuladoId = e.target.getAttribute('data-simulado');
                const questionHash = e.target.getAttribute('data-question-hash');
                if (simuladoId && questionHash) {
                    sessionStorage.setItem('oneQuestionSimulado', JSON.stringify({ simuladoId, questionHash }));
                    window.location.href = `simulado.html?id=${simuladoId}&one=1`;
                }
            }
        });

    } catch (error) {
        console.error(error);
        bookmarkedTabContent.innerHTML = `<p style="text-align: center;">Erro ao carregar as questões marcadas.</p>`;
    }
}