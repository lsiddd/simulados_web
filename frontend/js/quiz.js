import { API_BASE_URL, Analytics, initTheme, getQuestionHash, showToast } from './common.js';
let saveTimeout;
const DONT_KNOW_ANSWER = "Não sei";
const AVG_TIME_PER_QUESTION_MS = 30000;
let quizData = {};
let originalQuestions = [];
let incorrectQuestions = [];
let incorrectQuestionsLog = {};
let bookmarkedQuestions = [];
let allUserBookmarks = [];
let currentQuestionIndex = 0;
let score = 0;
let selectedAnswer = null;
let isReviewMode = false;
let questionStartTime = 0;
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
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    const params = new URLSearchParams(window.location.search);
    const simuladoId = params.get('id');
    if (simuladoId) {
        startSimulado(simuladoId);
        addEventListeners();
    } else {
        window.location.href = 'index.html';
    }
});
function addEventListeners() {
    btnConfirm?.addEventListener('click', confirmAnswer);
    btnNext?.addEventListener('click', nextQuestion);
    btnSaveProgress?.addEventListener('click', () => {
        saveProgress();
        showToast('Progresso salvo com sucesso!');
    });
    
    
    
    alternativesContainer.addEventListener('click', (e) => {
        if (selectedAnswer === 'CONFIRMED') return;
        const label = e.target.closest('.alternativa-label');
        if (label) {
            const radio = label.querySelector('input[type="radio"]');
            if (radio) {
                handleAnswerSelection(radio.value, label);
            }
        }
    });
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
/**
 * Initializes the quiz, fetching data and setting up the initial state.
 * It prioritizes using prefetched data from sessionStorage for an instant start.
 * It also handles resuming from saved progress, starting a new quiz, or loading a single bookmarked question.
 * @param {string} simuladoId - The ID of the quiz to load.
 */
async function startSimulado(simuladoId) {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const isOneQuestion = urlParams.get('one') === '1';
        const targetSimuladoId = sessionStorage.getItem('targetSimuladoId');
        const targetQuestionHash = sessionStorage.getItem('targetQuestionHash');

        // --- MODIFIED IMPLEMENTATION: CHECK FOR PREFETCHED DATA ---
        let dataFromCache = null;
        const prefetchedDataJSON = sessionStorage.getItem(`quiz_${simuladoId}`);

        if (prefetchedDataJSON) {
            console.log(`[Quiz] Using prefetched data for quiz ${simuladoId}.`);
            try {
                // Try to parse the cached data
                dataFromCache = JSON.parse(prefetchedDataJSON);
            } catch (e) {
                // If parsing fails, the data is corrupt. Remove it and let it fetch from the network.
                console.error("Failed to parse prefetched data, will fetch from network.", e);
                sessionStorage.removeItem(`quiz_${simuladoId}`);
            }
        }

        // If we have valid cached data, resolve it immediately. Otherwise, create a network fetch request.
        const quizDataPromise = dataFromCache
            ? Promise.resolve(dataFromCache)
            : fetch(`${API_BASE_URL}/simulados/${simuladoId}`).then(res => {
                if (!res.ok) throw new Error('Falha ao carregar os dados do simulado.');
                console.log(`[Quiz] Fetched quiz data for ${simuladoId} from network.`);
                return res.json();
              });
        
        // Fetch quiz data (from cache or network) and user bookmarks in parallel
        const [quizResult, bookmarksResponse] = await Promise.all([
            quizDataPromise,
            fetch(`${API_BASE_URL}/user/bookmarks`)
        ]);

        quizData = quizResult;
        // --- END OF MODIFIED IMPLEMENTATION ---

        originalQuestions = quizData.questoes.map((q, index) => ({ ...q, originalIndex: index }));
        
        if (bookmarksResponse.ok) {
            allUserBookmarks = await bookmarksResponse.json();
        } else {
            console.error("Não foi possível carregar os marcadores do usuário.");
        }

        document.title = quizData.titulo;
        quizTitle.textContent = quizData.titulo;
        
        if (isOneQuestion && targetSimuladoId === simuladoId && targetQuestionHash) {
            handleOneQuestionMode();
            return;
        }

        const shouldStartNew = urlParams.get('start') === 'true';
        if (shouldStartNew) {
            await clearProgress();
            resetQuizState();
            Analytics.track('quiz_started', { quizId: quizData.id, totalQuestions: originalQuestions.length });
        } else if (await checkForSavedProgress()) {
            Analytics.track('quiz_resumed', { quizId: quizData.id });
        } else {
            resetQuizState();
            Analytics.track('quiz_started', { quizId: quizData.id, totalQuestions: originalQuestions.length });
        }

        bookmarkedQuestions = allUserBookmarks
            .filter(b => b.simulado_id === simuladoId)
            .map(b => ({
                questionHash: Number(b.question_hash),
                category: b.category,
                enunciado: b.enunciado
            }));
            
        displayCurrentQuestion();

    } catch (error) {
        showError(error.message, true);
    }
}
/**
 * Sets up the quiz state for single-question mode based on data from sessionStorage.
 */
function handleOneQuestionMode() {
    const targetSimuladoId = sessionStorage.getItem('targetSimuladoId');
    const targetQuestionHash = sessionStorage.getItem('targetQuestionHash');
    if (!targetSimuladoId || !targetQuestionHash) {
        showError('Dados da questão marcada não encontrados.', true);
        return;
    }
    const foundQuestion = originalQuestions.find(questionObject => String(getQuestionHash(questionObject.enunciado)) === targetQuestionHash);
    if (!foundQuestion) {
        showError('Não foi possível encontrar a questão marcada.', true);
        return;
    }
    quizData.questoes = [foundQuestion];
    originalQuestions = [foundQuestion];
    currentQuestionIndex = 0;
    score = 0;
    isReviewMode = false;
    bookmarkedQuestions = allUserBookmarks
        .filter(b => b.simulado_id === targetSimuladoId)
        .map(b => ({
            questionHash: Number(b.question_hash),
            category: b.category,
            enunciado: b.enunciado
        }));
    displayCurrentQuestion();
    window.handleEndOfQuiz = showOneQuestionResult;
    sessionStorage.removeItem('targetQuestionHash');
    sessionStorage.removeItem('targetSimuladoId');
}
function displayCurrentQuestion() {
    if (currentQuestionIndex >= quizData.questoes.length) {
        (window.handleEndOfQuiz || handleEndOfQuiz)();
        return;
    }
    resetQuestionUI();
    questionStartTime = Date.now();
    const question = quizData.questoes[currentQuestionIndex];
    questionStatement.textContent = question.enunciado;
    setupBookmarkButton(question);
    
    alternativesContainer.innerHTML = '';
    const alternativasComNaoSei = [...question.alternativas, DONT_KNOW_ANSWER];
    
    
    const fragment = document.createDocumentFragment();
    alternativasComNaoSei.forEach((alt, index) => {
        const id = `alt-${index}`;
        const label = document.createElement('label');
        label.className = 'alternativa-label';
        label.htmlFor = id;
        
        label.innerHTML = `
            <input type="radio" id="${id}" name="alternativa" value="">
            <span></span>
        `;
        
        
        label.querySelector('input').value = alt;
        label.querySelector('span').textContent = alt;
        fragment.appendChild(label);
    });
    
    
    alternativesContainer.appendChild(fragment);
    
    updateProgress();
}
function handleAnswerSelection(answer, labelElement) {
    if (selectedAnswer === 'CONFIRMED') return;
    
    const currentSelected = alternativesContainer.querySelector('.alternativa-label.selected');
    if (currentSelected) {
        currentSelected.classList.remove('selected');
    }
    
    if (labelElement) {
        labelElement.classList.add('selected');
        const radio = labelElement.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
    }
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
function confirmAnswer() {
    if (selectedAnswer === null || selectedAnswer === 'CONFIRMED') return;
    const timeTaken = Date.now() - questionStartTime;
    const question = quizData.questoes[currentQuestionIndex];
    const isCorrect = selectedAnswer === question.alternativa_correta && selectedAnswer !== DONT_KNOW_ANSWER;
    const questionHash = getQuestionHash(question.enunciado);
    
    Analytics.track('answer_submitted', { quizId: quizData.id, questionIndex: currentQuestionIndex, isCorrect, timeTaken });
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
    explanationText.innerHTML = `A resposta correta é: "<b>${question.alternativa_correta}</b>".<br><br>${question.explicacao}`;
    
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
/**
 * --- OPTIMIZATION: Debounced Progress Saving ---
 * Clears the current timeout and sets a new one.
 * This prevents the save function from firing too frequently.
 */
function queueProgressSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveProgress(), 2000); 
}
function nextQuestion() {
    currentQuestionIndex++;
    
    queueProgressSave();
    displayCurrentQuestion();
}
function handleEndOfQuiz() {
    if (incorrectQuestions.length > 0) {
        startReview();
    } else {
        showFinalResults();
    }
}
window.handleEndOfQuiz = handleEndOfQuiz;
function startReview() {
    isReviewMode = true;
    quizData.questoes = [...incorrectQuestions];
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
            <a href="simulado.html?id=${quizData.id}&start=true" class="button button-primary">Tentar Novamente</a>
            ${bookmarkButtonHTML}
            <a href="index.html" class="button button-secondary">Ver outros simulados</a>
        </div>`;
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
        </div>`;
    resultContainer.classList.remove('hidden');
}
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
async function handleBookmark(question, category) {
    const questionHash = getQuestionHash(question.enunciado);
    const simuladoId = new URLSearchParams(window.location.search).get('id');
    const bookmarkData = {
        simulado_id: simuladoId,
        question_hash: String(questionHash),
        enunciado: question.enunciado,
        category: category,
    };
    
    const localIndex = bookmarkedQuestions.findIndex(bq => bq.questionHash === questionHash);
    let shouldDelete = false;
    if (localIndex > -1 && bookmarkedQuestions[localIndex].category === category) {
        shouldDelete = true;
    }
    try {
        if (shouldDelete) {
            const response = await fetch(`${API_BASE_URL}/user/bookmark`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ simulado_id: simuladoId, question_hash: String(questionHash) })
            });
            if (!response.ok) throw new Error('Falha ao remover o favorito.');
            bookmarkedQuestions.splice(localIndex, 1);
            showToast('Favorito removido.');
        } else {
            const response = await fetch(`${API_BASE_URL}/user/bookmark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarkData)
            });
            if (!response.ok) throw new Error('Falha ao salvar o favorito.');
            if (localIndex > -1) {
                bookmarkedQuestions[localIndex].category = category;
            } else {
                bookmarkedQuestions.push({ questionHash, category, enunciado: question.enunciado });
            }
            showToast('Favorito salvo!');
        }
        btnBookmark.classList.toggle('bookmarked', !shouldDelete);
    } catch (error) {
        console.error("Erro ao gerenciar favorito:", error);
        showToast(error.message, true);
    }
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
                ${questionsInCategory.map(q => `<div class="bookmarked-item"><p>${q.enunciado}</p></div>`).join('')}
            </div>`;
    }).join('');
    document.getElementById('btn-close-modal').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    };
    modal.classList.remove('hidden');
}
async function saveProgress() {
    const simuladoId = new URLSearchParams(window.location.search).get('id');
    const progressData = {
        currentQuestionIndex: currentQuestionIndex,
        score: score,
        isReviewMode: isReviewMode,
        incorrectQuestions: incorrectQuestions.map(q => getQuestionHash(q.enunciado)),
        reviewQuestions: isReviewMode ? quizData.questoes.map(q => getQuestionHash(q.enunciado)) : []
    };
    
    try {
        await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(progressData),
        });
    } catch (error) {
        console.error("Failed to save progress", error);
        showToast("Falha ao salvar o progresso.", true);
    }
}
async function clearProgress() {
    const simuladoId = new URLSearchParams(window.location.search).get('id');
    try {
        await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    } catch (error) {
        console.error("Failed to clear progress", error);
    }
}
async function checkForSavedProgress() {
    const simuladoId = new URLSearchParams(window.location.search).get('id');
    try {
        const response = await fetch(`${API_BASE_URL}/user/progress/${simuladoId}`);
        if (!response.ok) return false;
        const progress = await response.json();
        if (!progress || Object.keys(progress).length === 0) return false;
        currentQuestionIndex = progress.currentQuestionIndex || 0;
        score = progress.score || 0;
        isReviewMode = progress.isReviewMode || false;
        const findQuestionByHash = (hash) => originalQuestions.find(q => getQuestionHash(q.enunciado) === hash);
        
        if (isReviewMode && progress.reviewQuestions) {
            quizData.questoes = progress.reviewQuestions.map(findQuestionByHash).filter(Boolean);
            incorrectQuestions = progress.incorrectQuestions.map(findQuestionByHash).filter(Boolean);
        } else if (progress.incorrectQuestions) {
            incorrectQuestions = progress.incorrectQuestions.map(findQuestionByHash).filter(Boolean);
        }
        
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