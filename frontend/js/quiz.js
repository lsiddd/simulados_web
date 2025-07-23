import { API_BASE_URL, Analytics, initTheme, getQuestionHash, showToast } from './common.js';

// --- CONFIGURATION ---
const DONT_KNOW_ANSWER = "Não sei";
const AVG_TIME_PER_QUESTION_MS = 30000; // 30 segundos para estimativa

// --- STATE MANAGEMENT ---
let quizData = {};
let originalQuestions = [];
let incorrectQuestions = [];
let incorrectQuestionsLog = {};
let bookmarkedQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let selectedAnswer = null;
let isReviewMode = false;
let questionStartTime = 0;

// --- DOM ELEMENTS (Cached for efficiency) ---
const quizPage = document.getElementById('quiz-container');
const quizTitle = document.getElementById('simulado-titulo');
const questionCounter = document.getElementById('contador-questoes');
const progressBarInner = document.getElementById('progress-bar-inner');
const estimatedTime = document.getElementById('estimated-time');
const questionStatement = document.getElementById('enunciado-questao');
const alternativesContainer = document.getElementById('alternativas-container');
const feedbackContainer = document.getElementById('feedback-container');
const feedbackText = document.getElementById('feedback-texto');
const explanationText = document.getElementById('explicacao-texto');
const resultContainer = document.getElementById('resultado-container');
const btnConfirm = document.getElementById('btn-confirmar');
const btnNext = document.getElementById('btn-proxima');
const btnSaveProgress = document.getElementById('btn-salvar-progresso');
const btnBookmark = document.getElementById('btn-bookmark');
const bookmarkOptions = document.getElementById('bookmark-options');

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();

    const params = new URLSearchParams(window.location.search);
    const simuladoId = params.get('id');
    if (simuladoId) {
        startSimulado(simuladoId);
        addEventListeners();
    } else {
        window.location.href = 'index.html'; // Redirect if no ID is provided
    }
});

// --- EVENT LISTENERS ---
function addEventListeners() {
    btnConfirm?.addEventListener('click', confirmAnswer);
    btnNext?.addEventListener('click', nextQuestion);
    btnSaveProgress?.addEventListener('click', () => {
        saveProgress();
        showToast('Progresso salvo com sucesso!');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && selectedAnswer !== 'CONFIRMED') {
            btnConfirm.click();
        } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
            if (!btnNext.classList.contains('hidden')) {
                btnNext.click();
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

// --- QUIZ PAGE LOGIC ---
async function startSimulado(simuladoId) {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const isOneQuestion = urlParams.get('one') === '1';
        let oneQuestionData = null;
        if (isOneQuestion && sessionStorage.getItem('oneQuestionSimulado')) {
            oneQuestionData = JSON.parse(sessionStorage.getItem('oneQuestionSimulado'));
            if (oneQuestionData.simuladoId !== simuladoId) oneQuestionData = null;
        }

        const response = await fetch(`${API_BASE_URL}/simulados/${simuladoId}`);
        if (!response.ok) throw new Error('Falha ao carregar os dados do simulado.');
        quizData = await response.json();
        originalQuestions = quizData.questoes.map((q, index) => ({ ...q, originalIndex: index }));

        document.title = quizData.titulo;
        quizTitle.textContent = quizData.titulo;

        if (isOneQuestion && oneQuestionData) {
            handleOneQuestionMode(oneQuestionData);
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

function handleOneQuestionMode(oneQuestionData) {
    const question = originalQuestions.find(q => getQuestionHash(q.enunciado) === Number(oneQuestionData.questionHash));
    if (!question) {
        showError('Não foi possível encontrar a questão marcada.', true);
        return;
    }
    quizData.questoes = [question];
    originalQuestions = [question];
    resetQuizState();
    displayCurrentQuestion();
    sessionStorage.removeItem('oneQuestionSimulado');
    // Override end-of-quiz handler for this special mode
    window.handleEndOfQuiz = showOneQuestionResult;
}

function displayCurrentQuestion() {
    if (currentQuestionIndex >= quizData.questoes.length) {
        // Use the globally scoped handler, which might be overridden
        window.handleEndOfQuiz ? window.handleEndOfQuiz() : handleEndOfQuiz();
        return;
    }

    resetQuestionUI();
    questionStartTime = Date.now();
    const question = quizData.questoes[currentQuestionIndex];
    questionStatement.textContent = question.enunciado;

    setupBookmarkButton(question);

    alternativesContainer.innerHTML = '';
    const alternativasComNaoSei = [...question.alternativas, DONT_KNOW_ANSWER];

    alternativasComNaoSei.forEach((alt, index) => {
        const id = `alt-${index}`;
        const alternativaEl = document.createElement('label');
        alternativaEl.className = 'alternativa-label';
        alternativaEl.htmlFor = id;
        alternativaEl.innerHTML = `<input type="radio" id="${id}" name="alternativa" value="${alt}"><span>${alt}</span>`;
        alternativaEl.addEventListener('click', () => handleAnswerSelection(alt, alternativaEl));
        alternativesContainer.appendChild(alternativaEl);
    });

    updateProgress();
}

function handleAnswerSelection(answer, labelElement) {
    if (selectedAnswer === 'CONFIRMED') return;
    document.querySelectorAll('.alternativa-label.selected').forEach(el => el.classList.remove('selected'));
    if (labelElement) labelElement.classList.add('selected');
    selectedAnswer = answer;
    btnConfirm.disabled = false;
}

function resetQuestionUI() {
    selectedAnswer = null;
    feedbackContainer.classList.add('hidden');
    btnConfirm.classList.remove('hidden');
    btnConfirm.disabled = true;
    btnNext.classList.add('hidden');
    bookmarkOptions.classList.add('hidden');
}

function updateProgress() {
    const totalQuestions = quizData.questoes.length;
    questionCounter.textContent = `Questão ${currentQuestionIndex + 1} de ${totalQuestions}`;
    const progressPercentage = totalQuestions > 0 ? ((currentQuestionIndex + 1) / totalQuestions) * 100 : 0;
    progressBarInner.style.width = `${progressPercentage}%`;

    const remainingQuestions = totalQuestions - currentQuestionIndex;
    const estimatedMs = remainingQuestions * AVG_TIME_PER_QUESTION_MS;
    const minutes = Math.ceil(estimatedMs / 60000);
    
    if (minutes > 0 && estimatedTime) {
        estimatedTime.textContent = `~${minutes} min restantes`;
    } else if (estimatedTime) {
        estimatedTime.textContent = '';
    }
}

// --- QUIZ ACTIONS ---
function confirmAnswer() {
    if (selectedAnswer === null || selectedAnswer === 'CONFIRMED') return;

    const timeTaken = Date.now() - questionStartTime;
    const question = quizData.questoes[currentQuestionIndex];
    const isCorrect = selectedAnswer === question.alternativa_correta && selectedAnswer !== DONT_KNOW_ANSWER;
    const questionHash = getQuestionHash(question.enunciado);

    Analytics.track('question_answered', { quizId: quizData.id, questionIndex: currentQuestionIndex, isCorrect, timeTaken });

    if (isCorrect) {
        if (!isReviewMode) score++;
        if (isReviewMode) {
            const indexToRemove = incorrectQuestions.findIndex(q => getQuestionHash(q.enunciado) === questionHash);
            if (indexToRemove > -1) incorrectQuestions.splice(indexToRemove, 1);
        }
    } else {
        if (!incorrectQuestions.some(q => getQuestionHash(q.enunciado) === questionHash)) {
            incorrectQuestions.push(question);
        }
        logIncorrectAnswer(question);
    }

    feedbackContainer.classList.remove('hidden', 'correct', 'incorrect');
    feedbackContainer.classList.add(isCorrect ? 'correct' : 'incorrect');
    feedbackText.textContent = isCorrect ? '🎉 Resposta Correta!' : (selectedAnswer === DONT_KNOW_ANSWER ? '🧠 Resposta pulada' : '❌ Resposta Incorreta');
    explanationText.textContent = `A resposta correta é: "${question.alternativa_correta}".\n\n${question.explicacao}`;

    document.querySelectorAll('.alternativa-label').forEach(label => {
        const input = label.querySelector('input');
        label.classList.add('disabled');
        if (input.value === question.alternativa_correta) label.classList.add('correct');
        else if (input.value === selectedAnswer) label.classList.add('incorrect');
    });

    btnConfirm.classList.add('hidden');
    btnNext.classList.remove('hidden');
    selectedAnswer = 'CONFIRMED';
}

function nextQuestion() {
    currentQuestionIndex++;
    saveProgress();
    displayCurrentQuestion();
}

// --- END OF QUIZ & REVIEW LOGIC ---
function handleEndOfQuiz() {
    if (incorrectQuestions.length > 0) {
        startReview();
    } else {
        showFinalResults();
    }
}
window.handleEndOfQuiz = handleEndOfQuiz; // Make it globally accessible for overrides

function startReview() {
    isReviewMode = true;
    quizData.questoes = [...incorrectQuestions]; // Review only the remaining incorrect questions
    resetQuizState(); 

    let reviewNotice = document.querySelector('.review-notice');
    if (!reviewNotice) {
        reviewNotice = document.createElement('div');
        reviewNotice.className = 'card review-notice';
        quizPage.prepend(reviewNotice);
    }
    reviewNotice.innerHTML = `<h3>🔄 Modo de Revisão</h3><p>Vamos repassar as ${quizData.questoes.length} questões que você ainda não acertou.</p>`;

    displayCurrentQuestion();
}

function resetQuizState() {
    currentQuestionIndex = 0;
    if (!isReviewMode) {
        score = 0;
        incorrectQuestions = [];
        bookmarkedQuestions = [];
        loadIncorrectAnswerLog();
    }
}

function showFinalResults() {
    Analytics.track('quiz_completed', { quizId: quizData.id, score, total: originalQuestions.length });
    sendIncorrectAnswerLog();
    clearProgress();

    quizPage.classList.add('hidden');
    document.querySelector('.simulado-footer')?.classList.add('hidden');
    document.querySelector('.review-notice')?.remove();

    const totalQuestions = originalQuestions.length;
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    let bookmarkButtonHTML = bookmarkedQuestions.length > 0
        ? `<button id="btn-review-bookmarks" class="button button-secondary">Revisar Questões Marcadas</button>`
        : '';

    resultContainer.innerHTML = `
        <h2>🎯 Simulado Concluído!</h2>
        <p>Você acertou ${score} de ${totalQuestions} questões (${percentage}%).</p>
        <div class="result-buttons">
            <a href="simulado.html?id=${quizData.id}" class="button button-primary">Tentar Novamente</a>
            ${bookmarkButtonHTML}
            <a href="index.html" class="button button-secondary">Ver outros simulados</a>
        </div>
    `;
    resultContainer.classList.remove('hidden');
    document.getElementById('btn-review-bookmarks')?.addEventListener('click', showBookmarkModal);
}

function showOneQuestionResult() {
    quizPage.classList.add('hidden');
    document.querySelector('.simulado-footer')?.classList.add('hidden');
    resultContainer.innerHTML = `
        <h2>✅ Questão Estudada!</h2>
        <p>Você concluiu o estudo desta questão marcada.</p>
        <div class="result-buttons">
            <a href="index.html" class="button button-primary">Voltar para o início</a>
        </div>
    `;
    resultContainer.classList.remove('hidden');
}

// --- BOOKMARKING LOGIC ---
function setupBookmarkButton(question) {
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

    if (index > -1) { // Bookmark exists
        // If same category is clicked, unbookmark. Otherwise, change category.
        if (bookmarkedQuestions[index].category === category) {
            bookmarkedQuestions.splice(index, 1);
        } else {
            bookmarkedQuestions[index].category = category;
        }
    } else { // New bookmark
        bookmarkedQuestions.push({ questionHash, category, enunciado: question.enunciado });
    }
    btnBookmark.classList.toggle('bookmarked', bookmarkedQuestions.some(bq => bq.questionHash === questionHash));
    saveProgress();
}

function toggleBookmarkOptions() {
    bookmarkOptions.classList.toggle('hidden');
}

function showBookmarkModal() {
    const modal = document.getElementById('bookmark-modal');
    const body = document.getElementById('bookmark-modal-body');
    const categories = { 'review-later': 'Revisar Depois', 'difficult': 'Difíceis', 'favorite': 'Favoritas' };

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

// --- KEYBOARD NAVIGATION ---
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

// --- PROGRESS MANAGEMENT & ERROR HANDLING ---
function getProgressKey() {
    return new URLSearchParams(window.location.search).get('id');
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
    const simuladoId = getProgressKey();
    try {
        await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    } catch (e) {
        console.error("Failed to clear progress on server", e);
    }
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
        
        const findQuestionByHash = (hash) => originalQuestions.find(q => getQuestionHash(q.enunciado) === hash);

        if (isReviewMode && progress.reviewQuestions) {
            quizData.questoes = progress.reviewQuestions.map(findQuestionByHash).filter(Boolean);
            incorrectQuestions = progress.incorrectQuestions.map(findQuestionByHash).filter(Boolean);
        } else if (progress.incorrectQuestions) {
            incorrectQuestions = progress.incorrectQuestions.map(findQuestionByHash).filter(Boolean);
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
    showToast(message, true);

    if (isFatal) {
        quizPage.innerHTML = `<div class="card" style="text-align: center;"><p>${message} Tente <a href="index.html">voltar para o início</a>.</p></div>`;
    }
}

// --- INCORRECT ANSWER LOGGING ---
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
        await fetch(`${API_BASE_URL}/user/stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(log),
        });
    } catch (error) {
        console.error("Erro de rede ao enviar o log de respostas incorretas:", error);
    }
}