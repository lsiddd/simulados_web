// --- CONFIGURATION ---
const API_BASE_URL = '/api';
const DONT_KNOW_ANSWER = "Não sei";
const AVG_TIME_PER_QUESTION_MS = 30000; // 30 segundos para estimativa

// --- IMPROVEMENT: Mock Analytics Service ---
const Analytics = {
    track: (eventName, properties) => {
        console.log(`[Analytics] Event: ${eventName}`, properties);
        // Em um aplicativo real, você enviaria esses dados para um serviço
        // como Google Analytics, Mixpanel, etc.
    }
};

// --- STATE MANAGEMENT ---
let quizData = {};
let originalQuestions = [];
let incorrectQuestions = [];
// --- NEW: Persistent log of all incorrect answers ---
let incorrectQuestionsLog = {};
let bookmarkedQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let selectedAnswer = null;
let isReviewMode = false;
let questionStartTime = 0;

// --- DOM ELEMENTS ---
const homePage = document.getElementById('simulados-grid');
const quizPage = document.getElementById('quiz-container');
// --- FIX: O themeSwitcher pode não existir em todas as páginas, e tudo bem ---
const themeSwitcher = document.getElementById('btn-theme-switcher');

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme(); // Agora deve rodar sem erros em todas as páginas.

    if (homePage) {
        loadSimulados();
        setupTabs();
    } else if (quizPage) {
        const params = new URLSearchParams(window.location.search);
        const simuladoId = params.get('id');
        if (simuladoId) {
            startSimulado(simuladoId);
        } else {
            window.location.href = 'index.html';
        }
    }

    // Adiciona event listeners que são seguros para serem adicionados globalmente
    addEventListeners();
});

// --- IMPROVEMENT: Dark Mode Logic ---
async function initTheme() {
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
}

async function setTheme(theme, save = true) {
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
            // ignore
        }
    }
}

// --- IMPROVEMENT: Universal Event Listeners ---
function addEventListeners() {
    // --- FIX: Verifica se o themeSwitcher existe antes de adicionar um event listener ---
    themeSwitcher?.addEventListener('click', () => {
        const newTheme = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
    });

    // Estes listeners são apenas para a página do quiz, então verificamos a existência dos elementos.
    document.getElementById('btn-confirmar')?.addEventListener('click', confirmAnswer);
    document.getElementById('btn-proxima')?.addEventListener('click', nextQuestion);
    document.getElementById('btn-salvar-progresso')?.addEventListener('click', () => {
        saveProgress();
        showToast('Progresso salvo com sucesso!');
    });

    // Atalhos de teclado só devem estar ativos na página do quiz.
    if (quizPage) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && selectedAnswer !== 'CONFIRMED') {
                document.getElementById('btn-confirmar').click();
            } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
                if (!document.getElementById('btn-proxima').classList.contains('hidden')) {
                    document.getElementById('btn-proxima').click();
                }
            }
            if (e.key.toLowerCase() === 'b') {
                e.preventDefault();
                toggleBookmarkOptions();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                handleArrowKeySelection(e.key);
            }
        });
    }
}


// --- HOMEPAGE LOGIC ---
async function loadSimulados() {
    try {
        const response = await fetch(`${API_BASE_URL}/simulados`);
        if (!response.ok) throw new Error('Falha ao carregar a lista de simulados.');
        const simulados = await response.json();

        // --- NEW: List saved progress ---
        if (homePage) {
            renderSavedProgress(simulados);
            // Attach event delegation for remove buttons
            const savedProgressSection = document.getElementById('saved-progress-list');
            if (savedProgressSection) {
                savedProgressSection.addEventListener('click', function(e) {
                    if (e.target && e.target.matches('.btn-remove-progress')) {
                        const key = e.target.getAttribute('data-key');
                        if (key) {
                            window.removeSavedProgress(key);
                        }
                    }
                });
            }
        }

        homePage.innerHTML = simulados.map(simulado => `
            <div class="card simulado-card">
                <div class="badge">${simulado.questoes_count} Questões</div>
                <h2>${simulado.titulo}</h2>
                <p>${simulado.descricao}</p>
                <a href="simulado.html?id=${simulado.id}" class="button button-primary">▶ Iniciar Simulado</a>
            </div>
        `).join('');
    } catch (error) {
        showError(error.message);
        // Também exibe uma mensagem de erro na própria página inicial
        homePage.innerHTML = `<p style="text-align: center;">Erro ao carregar os simulados. Tente recarregar a página.</p>`;
    }
}

// --- NEW: Render saved progress cards on homepage ---
function renderSavedProgress(simulados) {
    const savedProgressSection = document.getElementById('saved-progress-list');
    if (!savedProgressSection) return;
    // Find all localStorage keys that match simuladoProgress_*
    const savedKeys = Object.keys(localStorage).filter(k => k.startsWith('simuladoProgress_'));
    if (savedKeys.length === 0) {
        savedProgressSection.innerHTML = '';
        return;
    }
    // Map keys to simulado info
    const cards = savedKeys.map(key => {
        const simuladoId = key.replace('simuladoProgress_', '');
        const simulado = simulados.find(s => s.id === simuladoId);
        if (!simulado) return '';
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
    }).filter(Boolean);
    if (cards.length === 0) {
        savedProgressSection.innerHTML = '';
        return;
    }
    savedProgressSection.innerHTML = `<h2 style="width:100%;">Progresso Salvo</h2>` + cards.join('');
}

// --- NEW: Remove saved progress helper for button ---
window.removeSavedProgress = function(key) {
    localStorage.removeItem(key);
    // Reload the page to update the list
    location.reload();
}

// --- QUIZ PAGE LOGIC ---
async function startSimulado(simuladoId) {
    try {
        // Check for one-question simulado mode
        const urlParams = new URLSearchParams(window.location.search);
        const isOneQuestion = urlParams.get('one') === '1';
        let oneQuestionData = null;
        if (isOneQuestion && sessionStorage.getItem('oneQuestionSimulado')) {
            oneQuestionData = JSON.parse(sessionStorage.getItem('oneQuestionSimulado'));
            if (oneQuestionData.simuladoId !== simuladoId) {
                oneQuestionData = null;
            }
        }
        const response = await fetch(`${API_BASE_URL}/simulados/${simuladoId}`);
        if (!response.ok) throw new Error('Falha ao carregar os dados do simulado.');
        quizData = await response.json();
        originalQuestions = quizData.questoes.map((q, index) => ({ ...q, originalIndex: index }));

        document.title = quizData.titulo;
        document.getElementById('simulado-titulo').textContent = quizData.titulo;

        if (isOneQuestion && oneQuestionData) {
            // Find by questionHash
            const question = originalQuestions.find(q => getQuestionHash(q.enunciado) === Number(oneQuestionData.questionHash));
            if (!question) {
                showError('Não foi possível encontrar a questão marcada. Ela pode ter sido removida ou o progresso foi resetado.', true);
                return;
            }
            quizData.questoes = [question];
            originalQuestions = [question];
            // No progress, no review mode, no bookmarks
            resetQuizState();
            displayCurrentQuestion();
            // Remove from sessionStorage after use
            sessionStorage.removeItem('oneQuestionSimulado');
            // Override handleEndOfQuiz to show a simple result
            handleEndOfQuiz = function() {
                showOneQuestionResult();
            };
            return;
        }

        if (await checkForSavedProgress()) {
            Analytics.track('quiz_resumed', { quizId: quizData.id });
            return;
        }

        resetQuizState();
        displayCurrentQuestion();
        Analytics.track('quiz_started', { quizId: quizData.id, totalQuestions: originalQuestions.length });
    } catch (error) {
        showError(error.message, true);
    }
}

function displayCurrentQuestion() {
    resetQuestionUI();

    if (currentQuestionIndex >= quizData.questoes.length) {
        handleEndOfQuiz();
        return;
    }
    questionStartTime = Date.now();
    const question = quizData.questoes[currentQuestionIndex];
    document.getElementById('enunciado-questao').textContent = question.enunciado;

    setupBookmarkButton(question);

    const alternativasContainer = document.getElementById('alternativas-container');
    alternativasContainer.innerHTML = '';
    const alternativasComNaoSei = [...question.alternativas, DONT_KNOW_ANSWER];

    alternativasComNaoSei.forEach((alt, index) => {
        const id = `alt-${index}`;
        const alternativaEl = document.createElement('label');
        alternativaEl.className = 'alternativa-label';
        alternativaEl.htmlFor = id;
        alternativaEl.innerHTML = `<input type="radio" id="${id}" name="alternativa" value="${alt}"><span>${alt}</span>`;
        alternativaEl.addEventListener('click', () => handleAnswerSelection(alt, alternativaEl));
        alternativasContainer.appendChild(alternativaEl);
    });

    updateProgress();
}

function handleAnswerSelection(answer, labelElement) {
    // if (selectedAnswer !== null && selectedAnswer !== 'CONFIRMED') return;
    if (selectedAnswer === 'CONFIRMED') return; 
    document.querySelectorAll('.alternativa-label.selected').forEach(el => el.classList.remove('selected'));
    if (labelElement) labelElement.classList.add('selected');
    selectedAnswer = answer;
    document.getElementById('btn-confirmar').disabled = false;
}

function resetQuestionUI() {
    selectedAnswer = null;
    document.getElementById('feedback-container').classList.add('hidden');
    document.getElementById('btn-confirmar').classList.remove('hidden');
    document.getElementById('btn-confirmar').disabled = true;
    document.getElementById('btn-proxima').classList.add('hidden');
    document.getElementById('bookmark-options').classList.add('hidden');
}

function updateProgress() {
    const totalQuestions = quizData.questoes.length;
    document.getElementById('contador-questoes').textContent = `Questão ${currentQuestionIndex + 1} de ${totalQuestions}`;
    const progressPercentage = ((currentQuestionIndex + 1) / totalQuestions) * 100;
    document.getElementById('progress-bar-inner').style.width = `${progressPercentage}%`;

    const remainingQuestions = totalQuestions - currentQuestionIndex;
    const estimatedMs = remainingQuestions * AVG_TIME_PER_QUESTION_MS;
    const minutes = Math.ceil(estimatedMs / 60000);
    const timeEl = document.getElementById('estimated-time');
    if (minutes > 0 && timeEl) {
        timeEl.textContent = `~${minutes} min restantes`;
    } else if (timeEl) {
        timeEl.textContent = '';
    }
}

// --- QUIZ ACTIONS ---
function confirmAnswer() {
    if (selectedAnswer === null || selectedAnswer === 'CONFIRMED') return;

    const timeTaken = Date.now() - questionStartTime;
    const question = quizData.questoes[currentQuestionIndex];
    const isCorrect = selectedAnswer === question.alternativa_correta && selectedAnswer !== DONT_KNOW_ANSWER;
    const questionHash = getQuestionHash(question.enunciado);

    Analytics.track('question_answered', {
        quizId: quizData.id,
        questionIndex: currentQuestionIndex,
        isCorrect,
        timeTaken
    });

    if (isCorrect) {
        if (!isReviewMode) score++;
        // If correct in review, remove from this session's incorrect list
        if (isReviewMode) {
            const indexToRemove = incorrectQuestions.findIndex(q => getQuestionHash(q.enunciado) === questionHash);
            if (indexToRemove > -1) {
                incorrectQuestions.splice(indexToRemove, 1);
            }
        }
    } else {
        // Only add to incorrectQuestions if it's not already there for this session's review
        if (!incorrectQuestions.some(q => getQuestionHash(q.enunciado) === questionHash)) {
            incorrectQuestions.push(question);
        }

        // --- NEW: Persistently log the incorrect answer ---
        logIncorrectAnswer(question);
    }

    const feedbackContainer = document.getElementById('feedback-container');
    feedbackContainer.classList.remove('hidden', 'correct', 'incorrect');
    feedbackContainer.classList.add(isCorrect ? 'correct' : 'incorrect');
    document.getElementById('feedback-texto').textContent = isCorrect ? '🎉 Resposta Correta!' : (selectedAnswer === DONT_KNOW_ANSWER ? '🧠 Resposta pulada' : '❌ Resposta Incorreta');
    document.getElementById('explicacao-texto').textContent = `A resposta correta é: "${question.alternativa_correta}".\n\n${question.explicacao}`;

    document.querySelectorAll('.alternativa-label').forEach(label => {
        const input = label.querySelector('input');
        label.classList.add('disabled');
        if (input.value === question.alternativa_correta) label.classList.add('correct');
        else if (input.value === selectedAnswer) label.classList.add('incorrect');
    });

    document.getElementById('btn-confirmar').classList.add('hidden');
    document.getElementById('btn-proxima').classList.remove('hidden');
    selectedAnswer = 'CONFIRMED';
}

function nextQuestion() {
    currentQuestionIndex++;
    saveProgress();
    displayCurrentQuestion();
}

// --- END OF QUIZ & REVIEW LOGIC ---
function handleEndOfQuiz() {
    // --- MODIFIED: The review mode now repeats until all questions are correct ---
    if (incorrectQuestions.length > 0) {
        // If we are already in review mode, we just continue with the remaining incorrect questions.
        // If not, we start the first review session.
        startReview();
    } else {
        // This is reached when the quiz is finished 처음부터 or the review loop is completed.
        showFinalResults();
    }
}

function startReview() {
    isReviewMode = true;
    // --- MODIFIED: The questions for the review are now the ones left in incorrectQuestions ---
    quizData.questoes = [...incorrectQuestions];
    // We don't clear incorrectQuestions, as we need to track them across the review session.
    // Instead, we will remove questions from it as they are answered correctly.
    resetQuizState(); // Resets index, but not scores or incorrect lists

    const reviewNotice = document.querySelector('.review-notice');
    if (reviewNotice) {
        reviewNotice.innerHTML = `<h3>🔄 Modo de Revisão</h3><p>Vamos repassar as ${quizData.questoes.length} questões que você ainda não acertou.</p>`;
    } else {
        const newReviewMessage = document.createElement('div');
        newReviewMessage.className = 'card review-notice';
        newReviewMessage.innerHTML = `<h3>🔄 Modo de Revisão</h3><p>Vamos repassar as ${quizData.questoes.length} questões que você errou.</p>`;
        quizPage.prepend(newReviewMessage);
    }


    displayCurrentQuestion();
}

function resetQuizState() {
    currentQuestionIndex = 0;
    if (!isReviewMode) {
        score = 0;
        incorrectQuestions = [];
        bookmarkedQuestions = [];
        // --- NEW: Load persistent incorrect log at the start ---
        loadIncorrectAnswerLog();
    }
}

function showFinalResults() {
    Analytics.track('quiz_completed', { quizId: quizData.id, score, total: originalQuestions.length });
    // --- NEW: Send stats to backend ---
    sendIncorrectAnswerLog();
    clearProgress();

    quizPage.classList.add('hidden');
    document.querySelector('.simulado-footer')?.classList.add('hidden');
    document.querySelector('.review-notice')?.remove();

    const resultadoContainer = document.getElementById('resultado-container');
    const totalQuestions = originalQuestions.length;
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    let bookmarkButtonHTML = '';
    if (bookmarkedQuestions.length > 0) {
        bookmarkButtonHTML = `<button id="btn-review-bookmarks" class="button button-secondary">Revisar Questões Marcadas</button>`;
    }

    resultadoContainer.innerHTML = `
        <h2>🎯 Simulado Concluído!</h2>
        <p>Você acertou ${score} de ${totalQuestions} questões (${percentage}%).</p>
        <div class="result-buttons">
            <a href="simulado.html?id=${quizData.id}" class="button button-primary">Tentar Novamente</a>
            ${bookmarkButtonHTML}
            <a href="index.html" class="button button-secondary">Ver outros simulados</a>
        </div>
    `;
    resultadoContainer.classList.remove('hidden');

    document.getElementById('btn-review-bookmarks')?.addEventListener('click', showBookmarkModal);
}

// --- NEW: Show result for one-question simulado ---
function showOneQuestionResult() {
    const quizPage = document.getElementById('quiz-container');
    const resultadoContainer = document.getElementById('resultado-container');
    quizPage.classList.add('hidden');
    document.querySelector('.simulado-footer')?.classList.add('hidden');
    resultadoContainer.innerHTML = `
        <h2>✅ Questão Estudada!</h2>
        <p>Você concluiu o estudo desta questão marcada.</p>
        <div class="result-buttons">
            <a href="index.html" class="button button-primary">Voltar para o início</a>
        </div>
    `;
    resultadoContainer.classList.remove('hidden');
}

// --- IMPROVEMENT: Advanced Bookmarking Logic ---
function setupBookmarkButton(question) {
    const btnBookmark = document.getElementById('btn-bookmark');
    const bookmarkOptions = document.getElementById('bookmark-options');
    const questionHash = getQuestionHash(question.enunciado);
    const existingBookmark = bookmarkedQuestions.find(bq => bq.questionHash === questionHash);

    btnBookmark.classList.toggle('bookmarked', !!existingBookmark);

    btnBookmark.onclick = (e) => {
        e.stopPropagation();
        toggleBookmarkOptions();
    };

    bookmarkOptions.onclick = (e) => {
        if (e.target.tagName === 'BUTTON') {
            const category = e.target.dataset.category;
            handleBookmark(question, category);
            bookmarkOptions.classList.add('hidden');
        }
    };
}

function handleBookmark(question, category) {
    const questionHash = getQuestionHash(question.enunciado);
    const index = bookmarkedQuestions.findIndex(bq => bq.questionHash === questionHash);

    if (index > -1) {
        if (bookmarkedQuestions[index].category === category) {
            bookmarkedQuestions.splice(index, 1);
        } else {
            bookmarkedQuestions[index].category = category;
        }
    } else {
        bookmarkedQuestions.push({ questionHash, category, enunciado: question.enunciado });
    }

    document.getElementById('btn-bookmark').classList.toggle('bookmarked', bookmarkedQuestions.some(bq => bq.questionHash === questionHash));
    saveProgress();
}

function toggleBookmarkOptions() {
    const bookmarkOptions = document.getElementById('bookmark-options');
    bookmarkOptions.classList.toggle('hidden');
}

function showBookmarkModal() {
    const modal = document.getElementById('bookmark-modal');
    const body = document.getElementById('bookmark-modal-body');

    const categories = {
        'review-later': 'Revisar Depois',
        'difficult': 'Difíceis',
        'favorite': 'Favoritas'
    };

    body.innerHTML = Object.keys(categories).map(catKey => {
        const questionsInCategory = bookmarkedQuestions.filter(bq => bq.category === catKey);
        if (questionsInCategory.length === 0) return '';

        return `
            <div class="bookmark-group">
                <h3>${categories[catKey]}</h3>
                ${questionsInCategory.map(q => `<div class="bookmarked-item">${q.enunciado}</div>`).join('')}
            </div>
        `;
    }).join('');

    modal.classList.remove('hidden');
    document.getElementById('btn-close-modal').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
}

// --- IMPROVEMENT: Keyboard Navigation ---
function handleArrowKeySelection(key) {
    const radios = Array.from(document.querySelectorAll('input[name="alternativa"]'));
    if (!radios.length) return;
    let currentIndex = radios.findIndex(r => r.checked);

    if (key === 'ArrowDown') {
        currentIndex = (currentIndex + 1) % radios.length;
    } else if (key === 'ArrowUp') {
        currentIndex = (currentIndex - 1 + radios.length) % radios.length;
    }

    radios[currentIndex].checked = true;
    handleAnswerSelection(radios[currentIndex].value, radios[currentIndex].parentElement);
}

// --- IMPROVEMENT: Robust Progress Management & Error Handling ---
function getProgressKey() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

async function saveProgress() {
    try {
        const simuladoId = getProgressKey();
        const progress = {
            currentQuestionIndex,
            score,
            incorrectQuestions: incorrectQuestions.map(q => getQuestionHash(q.enunciado)),
            bookmarkedQuestions,
            isReviewMode,
            reviewQuestions: isReviewMode ? quizData.questoes.map(q => getQuestionHash(q.enunciado)) : []
        };
        await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(progress)
        });
    } catch (e) {
        console.error("Falha ao salvar o progresso:", e);
        showError("Não foi possível salvar seu progresso.");
    }
}

async function clearProgress() {
    // Overwrite with empty progress
    const simuladoId = getProgressKey();
    await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
}

async function checkForSavedProgress() {
    const simuladoId = getProgressKey();
    try {
        const response = await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`);
        if (!response.ok) return false;
        const progress = await response.json();
        if (!progress || Object.keys(progress).length === 0) return false;
        if (!window.confirm("Encontramos um progresso salvo. Deseja continuar?")) {
            await clearProgress();
            return false;
        }
        currentQuestionIndex = progress.currentQuestionIndex || 0;
        score = progress.score || 0;
        bookmarkedQuestions = progress.bookmarkedQuestions || [];
        isReviewMode = progress.isReviewMode || false;
        if (isReviewMode && progress.reviewQuestions) {
            quizData.questoes = progress.reviewQuestions.map(hash => originalQuestions.find(q => getQuestionHash(q.enunciado) === hash)).filter(Boolean);
            incorrectQuestions = progress.incorrectQuestions.map(hash => originalQuestions.find(q => getQuestionHash(q.enunciado) === hash)).filter(Boolean);
        } else if (progress.incorrectQuestions) {
            incorrectQuestions = progress.incorrectQuestions.map(hash => originalQuestions.find(q => getQuestionHash(q.enunciado) === hash)).filter(Boolean);
        }
        displayCurrentQuestion();
        return true;
    } catch (error) {
        showError("Não foi possível carregar seu progresso. Começando novamente.");
        await clearProgress();
        return false;
    }
}

function showError(message, isFatal = false) {
    console.error(message);
    const toast = document.getElementById('error-toast');
    // --- FIX: Check if toast element exists before trying to use it ---
    if (!toast) return;

    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 5000);

    if (isFatal) {
        document.getElementById('quiz-container').innerHTML = `<div class="card" style="text-align: center;"><p>${message} Tente <a href="index.html">voltar para o início</a>.</p></div>`;
    }
}

// Add a showToast helper to display a quick notification
function showToast(message) {
    const toast = document.getElementById('error-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2000);
}

// --- NEW: Tab switching and rendering bookmarked questions ---
function setupTabs() {
    const tabSimulados = document.getElementById('tab-simulados');
    const tabBookmarked = document.getElementById('tab-bookmarked');
    const simuladosGrid = document.getElementById('simulados-grid');
    const savedProgressList = document.getElementById('saved-progress-list');
    const bookmarkedTabContent = document.getElementById('bookmarked-tab-content');

    if (!tabSimulados || !tabBookmarked || !simuladosGrid || !bookmarkedTabContent) return;

    // Apply consistent button styles
    tabSimulados.classList.add('button', 'button-secondary');
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
        renderAllBookmarkedQuestions();
    });
}

// --- NEW: Aggregate and render all bookmarked questions from localStorage ---
async function renderAllBookmarkedQuestions() {
    const bookmarkedTabContent = document.getElementById('bookmarked-tab-content');
    if (!bookmarkedTabContent) return;
    let bookmarks = window.globalBookmarks;
    if (!bookmarks) {
        try {
            const response = await fetch(`${API_BASE_URL}/user/bookmarks`);
            bookmarks = response.ok ? await response.json() : [];
        } catch {
            bookmarks = [];
        }
    }
    if (bookmarks.length === 0) {
        bookmarkedTabContent.innerHTML = '<p style="text-align:center;">Nenhuma questão marcada encontrada.</p>';
        return;
    }
    // Optionally fetch simulados for titles
    let simulados = [];
    try {
        const response = await fetch(`${API_BASE_URL}/simulados`);
        simulados = response.ok ? await response.json() : [];
    } catch {}
    bookmarkedTabContent.innerHTML = '<h2 style="width:100%;">Questões Marcadas</h2>' + bookmarks.map(bq => {
        const simulado = simulados.find(s => s.id === bq.simulado_id);
        return `
            <div class="card simulado-card">
                <div class="badge">${bq.category ? bq.category : 'Marcada'}</div>
                <h3>${bq.enunciado}</h3>
                <p><strong>Simulado:</strong> ${simulado ? simulado.titulo : bq.simulado_id}</p>
                <button class="button button-primary btn-one-question" data-simulado="${bq.simulado_id}" data-question-hash="${bq.question_hash}">Estudar esta questão</button>
            </div>
        `;
    }).join('');
    // Attach event delegation for one-question simulado buttons
    bookmarkedTabContent.addEventListener('click', function(e) {
        if (e.target && e.target.matches('.btn-one-question')) {
            const simuladoId = e.target.getAttribute('data-simulado');
            const questionHash = e.target.getAttribute('data-question-hash');
            if (simuladoId && questionHash) {
                sessionStorage.setItem('oneQuestionSimulado', JSON.stringify({ simuladoId, questionHash }));
                window.location.href = `simulado.html?id=${simuladoId}&one=1`;
            }
        }
    }, { once: true });
}

// --- Helper: Generate a simple hash from question text (enunciado) ---
function getQuestionHash(enunciado) {
    let hash = 0, i, chr;
    if (!enunciado) return hash;
    for (i = 0; i < enunciado.length; i++) {
        chr = enunciado.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

// --- NEW: Functions to manage the persistent incorrect answer log ---
function logIncorrectAnswer(question) {
    const questionHash = getQuestionHash(question.enunciado);
    if (!incorrectQuestionsLog[questionHash]) {
        incorrectQuestionsLog[questionHash] = {
            count: 0,
            enunciado: question.enunciado,
            simuladoId: quizData.id
        };
    }
    incorrectQuestionsLog[questionHash].count++;
    saveIncorrectAnswerLog();
}

async function saveIncorrectAnswerLog() {
    try {
        await fetch(`${API_BASE_URL}/user/incorrect_answers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(incorrectQuestionsLog)
        });
    } catch (e) {
        console.error("Falha ao salvar o log de respostas incorretas:", e);
    }
}

async function loadIncorrectAnswerLog() {
    try {
        const response = await fetch(`${API_BASE_URL}/user/incorrect_answers`);
        if (response.ok) {
            const data = await response.json();
            incorrectQuestionsLog = {};
            for (const entry of data) {
                incorrectQuestionsLog[entry.question_hash] = {
                    count: entry.count,
                    enunciado: entry.enunciado,
                    simuladoId: entry.simulado_id
                };
            }
        } else {
            incorrectQuestionsLog = {};
        }
    } catch (e) {
        console.error("Falha ao carregar o log de respostas incorretas:", e);
        incorrectQuestionsLog = {};
    }
}

async function sendIncorrectAnswerLog() {
    const log = incorrectQuestionsLog;
    if (!log || Object.keys(log).length === 0) return;

    try {
        const response = await fetch(`${API_BASE_URL}/user/stats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(log),
        });
        if (response.ok) {
            console.log("Log de respostas incorretas enviado com sucesso.");
            // Optionally clear the log after successful submission
            // incorrectQuestionsLog = {};
        } else {
            console.error("Falha ao enviar o log de respostas incorretas.");
        }
    } catch (error) {
        console.error("Erro de rede ao enviar o log de respostas incorretas:", error);
    }
}

async function saveBookmarks() {
    try {
        // bookmarks are stored as part of progress, but also aggregate for all simulados
        // collect all bookmarks from all progresses (if needed)
        const allBookmarks = [];
        // If you have a global bookmarks array, use it. Otherwise, aggregate from progress/bookmarkedQuestions.
        for (const simulado of simuladosList || []) {
            const simuladoId = simulado.id;
            const response = await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`);
            if (response.ok) {
                const progress = await response.json();
                (progress.bookmarkedQuestions || []).forEach(bq => {
                    allBookmarks.push({
                        simulado_id: simuladoId,
                        question_hash: bq.questionHash,
                        enunciado: bq.enunciado,
                        category: bq.category
                    });
                });
            }
        }
        await fetch(`${API_BASE_URL}/user/bookmarks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allBookmarks)
        });
    } catch (e) {
        console.error("Falha ao salvar bookmarks:", e);
    }
}

async function loadBookmarks() {
    try {
        const response = await fetch(`${API_BASE_URL}/user/bookmarks`);
        if (response.ok) {
            const data = await response.json();
            // You can now use this data to render bookmarks in the UI
            // e.g., set a global bookmarks variable or update the DOM
            window.globalBookmarks = data;
        } else {
            window.globalBookmarks = [];
        }
    } catch (e) {
        console.error("Falha ao carregar bookmarks:", e);
        window.globalBookmarks = [];
    }
}