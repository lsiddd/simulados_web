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
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(savedTheme);
}

function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    // --- FIX: Verifica se o themeSwitcher existe antes de usá-lo ---
    if (themeSwitcher) {
        themeSwitcher.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    localStorage.setItem('theme', theme);
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

// --- QUIZ PAGE LOGIC ---
async function startSimulado(simuladoId) {
    try {
        const response = await fetch(`${API_BASE_URL}/simulados/${simuladoId}`);
        if (!response.ok) throw new Error('Falha ao carregar os dados do simulado.');
        quizData = await response.json();
        originalQuestions = quizData.questoes.map((q, index) => ({ ...q, originalIndex: index }));

        document.title = quizData.titulo;
        document.getElementById('simulado-titulo').textContent = quizData.titulo;

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

    Analytics.track('question_answered', {
        quizId: quizData.id,
        questionIndex: currentQuestionIndex,
        isCorrect,
        timeTaken
    });

    if (isCorrect) {
        if (!isReviewMode) score++;
    } else {
        incorrectQuestions.push(question);
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
    if (incorrectQuestions.length > 0 && !isReviewMode) {
        startReview();
    } else {
        showFinalResults();
    }
}

function startReview() {
    isReviewMode = true;
    quizData.questoes = [...incorrectQuestions];
    incorrectQuestions = [];
    resetQuizState();

    const reviewMessage = document.createElement('div');
    reviewMessage.className = 'card review-notice';
    reviewMessage.innerHTML = '<h3>🔄 Modo de Revisão</h3><p>Vamos repassar as questões que você errou.</p>';
    quizPage.prepend(reviewMessage);

    displayCurrentQuestion();
}

function resetQuizState() {
    currentQuestionIndex = 0;
    if (!isReviewMode) {
        score = 0;
        incorrectQuestions = [];
        bookmarkedQuestions = [];
    }
}

function showFinalResults() {
    Analytics.track('quiz_completed', { quizId: quizData.id, score, total: originalQuestions.length });
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

// --- IMPROVEMENT: Advanced Bookmarking Logic ---
function setupBookmarkButton(question) {
    const btnBookmark = document.getElementById('btn-bookmark');
    const bookmarkOptions = document.getElementById('bookmark-options');
    const existingBookmark = bookmarkedQuestions.find(bq => bq.questionId === question.originalIndex);

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
    const questionId = question.originalIndex;
    const index = bookmarkedQuestions.findIndex(bq => bq.questionId === questionId);

    if (index > -1) {
        if (bookmarkedQuestions[index].category === category) {
            bookmarkedQuestions.splice(index, 1);
        } else {
            bookmarkedQuestions[index].category = category;
        }
    } else {
        bookmarkedQuestions.push({ questionId, category, enunciado: question.enunciado });
    }

    document.getElementById('btn-bookmark').classList.toggle('bookmarked', bookmarkedQuestions.some(bq => bq.questionId === questionId));
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
    // quizData might not be loaded yet when this is first called
    const params = new URLSearchParams(window.location.search);
    const simuladoId = params.get('id');
    return `simuladoProgress_${simuladoId}`;
}

function saveProgress() {
    try {
        const progress = {
            currentQuestionIndex,
            score,
            incorrectQuestions: incorrectQuestions.map(q => q.originalIndex),
            bookmarkedQuestions,
            isReviewMode,
            reviewQuestions: isReviewMode ? quizData.questoes.map(q => q.originalIndex) : []
        };
        localStorage.setItem(getProgressKey(), JSON.stringify(progress));
    } catch (e) {
        console.error("Falha ao salvar o progresso:", e);
        showError("Não foi possível salvar seu progresso.");
    }
}

function clearProgress() {
    localStorage.removeItem(getProgressKey());
}

async function checkForSavedProgress() {
    const savedProgressJSON = localStorage.getItem(getProgressKey());
    if (!savedProgressJSON) return false;

    if (!window.confirm("Encontramos um progresso salvo. Deseja continuar?")) {
        clearProgress();
        return false;
    }

    try {
        const progress = JSON.parse(savedProgressJSON);
        currentQuestionIndex = progress.currentQuestionIndex || 0;
        score = progress.score || 0;
        bookmarkedQuestions = progress.bookmarkedQuestions || [];
        isReviewMode = progress.isReviewMode || false;

        if (isReviewMode && progress.reviewQuestions) {
            quizData.questoes = progress.reviewQuestions.map(id => originalQuestions.find(q => q.originalIndex === id)).filter(Boolean);
            incorrectQuestions = progress.incorrectQuestions.map(id => originalQuestions.find(q => q.originalIndex === id)).filter(Boolean);
        } else if (progress.incorrectQuestions) {
            incorrectQuestions = progress.incorrectQuestions.map(id => originalQuestions.find(q => q.originalIndex === id)).filter(Boolean);
        }

        displayCurrentQuestion();
        return true;
    } catch (error) {
        showError("Não foi possível carregar seu progresso. Começando novamente.");
        clearProgress();
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