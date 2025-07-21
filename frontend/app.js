// --- CONFIGURATION ---
const API_BASE_URL = '/api';
const DONT_KNOW_ANSWER = "Não sei";

// --- STATE MANAGEMENT ---
let quizData = {};
let originalQuestions = [];
let incorrectQuestions = [];
let flaggedQuestions = []; // NOVO: Armazena enunciados das questões marcadas
let currentQuestionIndex = 0;
let score = 0;
let selectedAnswer = null;
let isReviewMode = false;

// --- DOM ELEMENTS ---
const homePage = document.getElementById('simulados-grid');
const quizPage = document.getElementById('quiz-container');

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
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
});

// --- HOMEPAGE LOGIC ---
async function loadSimulados() {
    try {
        const response = await fetch(`${API_BASE_URL}/simulados`);
        if (!response.ok) throw new Error('Failed to load quizzes');
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
        homePage.innerHTML = `<p>Erro ao carregar os simulados.</p>`;
        console.error(error);
    }
}

// --- QUIZ PAGE LOGIC ---
async function startSimulado(simuladoId) {
    try {
        const response = await fetch(`${API_BASE_URL}/simulados/${simuladoId}`);
        if (!response.ok) throw new Error('Failed to load quiz data');
        quizData = await response.json();
        originalQuestions = [...quizData.questoes];

        document.title = quizData.titulo;
        document.getElementById('simulado-titulo').textContent = quizData.titulo;

        // NOVO: Verificar progresso salvo
        if (checkForSavedProgress()) {
            return; // Continua de onde parou
        }

        resetQuizState();
        displayCurrentQuestion();
    } catch (error) {
        document.getElementById('quiz-container').innerHTML = `<p>Erro ao carregar o simulado. Tente <a href="index.html">voltar para o início</a>.</p>`;
        console.error(error);
    }
}

function displayCurrentQuestion() {
    resetQuestionUI();

    if (currentQuestionIndex >= quizData.questoes.length) {
        handleEndOfQuiz();
        return;
    }

    const question = quizData.questoes[currentQuestionIndex];
    document.getElementById('enunciado-questao').textContent = question.enunciado;
    
    // NOVO: Adicionar listener e atualizar estado do botão de marcar
    const flagButton = document.getElementById('btn-flag-question');
    flagButton.onclick = () => handleFlagQuestion(question.enunciado);
    flagButton.classList.toggle('flagged', flaggedQuestions.includes(question.enunciado));

    const alternativasContainer = document.getElementById('alternativas-container');
    alternativasContainer.innerHTML = '';

    // MODIFICADO: Adiciona a opção "Não sei"
    const alternativasComNaoSei = [...question.alternativas, DONT_KNOW_ANSWER];

    alternativasComNaoSei.forEach(alt => {
        const alternativaEl = document.createElement('label');
        alternativaEl.className = 'alternativa-label';
        alternativaEl.innerHTML = `<input type="radio" name="alternativa" value="${alt}"><span>${alt}</span>`;
        alternativaEl.addEventListener('click', () => handleAnswerSelection(alt, alternativaEl));
        alternativasContainer.appendChild(alternativaEl);
    });

    updateProgress();
}

function handleAnswerSelection(answer, labelElement) {
    if (selectedAnswer !== null) return;
    document.querySelectorAll('.alternativa-label.selected').forEach(el => el.classList.remove('selected'));
    labelElement.classList.add('selected');
    selectedAnswer = answer;
    document.getElementById('btn-confirmar').disabled = false;
}

function resetQuestionUI() {
    selectedAnswer = null;
    document.getElementById('feedback-container').classList.add('hidden');
    document.getElementById('btn-confirmar').classList.remove('hidden');
    document.getElementById('btn-confirmar').disabled = true;
    document.getElementById('btn-proxima').classList.add('hidden');
}

function updateProgress() {
    const totalQuestions = quizData.questoes.length;
    document.getElementById('contador-questoes').textContent = `Questão ${currentQuestionIndex + 1} de ${totalQuestions}`;
    const progressPercentage = ((currentQuestionIndex + 1) / totalQuestions) * 100;
    document.getElementById('progress-bar-inner').style.width = `${progressPercentage}%`;
}

// --- QUIZ ACTIONS ---
document.getElementById('btn-confirmar')?.addEventListener('click', () => {
    if (selectedAnswer === null) return;

    const question = quizData.questoes[currentQuestionIndex];
    // MODIFICADO: Resposta "Não sei" é sempre incorreta
    const isCorrect = selectedAnswer === question.alternativa_correta && selectedAnswer !== DONT_KNOW_ANSWER;

    if (isCorrect) {
        if (!isReviewMode) score++;
    } else {
        incorrectQuestions.push(question);
    }

    const feedbackContainer = document.getElementById('feedback-container');
    const feedbackText = document.getElementById('feedback-texto');
    const explicacaoText = document.getElementById('explicacao-texto');

    feedbackContainer.classList.remove('hidden', 'correct', 'incorrect');
    if (isCorrect) {
        feedbackContainer.classList.add('correct');
        feedbackText.textContent = '🎉 Resposta Correta!';
    } else {
        feedbackContainer.classList.add('incorrect');
        feedbackText.textContent = selectedAnswer === DONT_KNOW_ANSWER ? '🧠 Resposta pulada' : '❌ Resposta Incorreta';
    }
    explicacaoText.textContent = `A resposta correta é: "${question.alternativa_correta}".\n\n${question.explicacao}`;

    document.querySelectorAll('.alternativa-label').forEach(label => {
        const input = label.querySelector('input');
        label.classList.add('disabled');
        if (input.value === question.alternativa_correta) label.classList.add('correct');
        else if (input.value === selectedAnswer) label.classList.add('incorrect');
    });

    document.getElementById('btn-confirmar').classList.add('hidden');
    document.getElementById('btn-proxima').classList.remove('hidden');
    selectedAnswer = 'CONFIRMED';
});

document.getElementById('btn-proxima')?.addEventListener('click', () => {
    currentQuestionIndex++;
    // NOVO: Salva o progresso ao ir para a próxima questão
    saveProgress();
    displayCurrentQuestion();
});

// --- NOVO: LÓGICA PARA MARCAR QUESTÕES ---
function handleFlagQuestion(questionEnunciado) {
    const flagButton = document.getElementById('btn-flag-question');
    const questionIndex = flaggedQuestions.indexOf(questionEnunciado);

    if (questionIndex > -1) {
        flaggedQuestions.splice(questionIndex, 1); // Desmarca
        flagButton.classList.remove('flagged');
    } else {
        flaggedQuestions.push(questionEnunciado); // Marca
        flagButton.classList.add('flagged');
    }
    // Salva o progresso para que a marcação persista
    saveProgress();
}


// --- END OF QUIZ & REVIEW LOGIC ---
function handleEndOfQuiz() {
    if (incorrectQuestions.length > 0) {
        startReview();
    } else {
        showFinalResults();
    }
}

function startReview() {
    isReviewMode = true;
    quizData.questoes = incorrectQuestions;
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
        flaggedQuestions = []; // Limpa marcações ao iniciar um novo simulado
    }
}

// --- FINAL RESULTS ---
function showFinalResults() {
    // NOVO: Limpa o progresso salvo ao finalizar
    clearProgress();

    quizPage.classList.add('hidden');
    document.querySelector('.simulado-footer').classList.add('hidden');
    const reviewNotice = document.querySelector('.review-notice');
    if (reviewNotice) reviewNotice.remove();

    const resultadoContainer = document.getElementById('resultado-container');
    const totalQuestions = originalQuestions.length;
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    let flaggedQuestionsHTML = '';
    if (flaggedQuestions.length > 0) {
        flaggedQuestionsHTML = `
            <div id="flagged-questions-review">
                <h3>🚩 Questões que você marcou para revisar:</h3>
                <ul>
                    ${flaggedQuestions.map(q => `<li>${q}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    resultadoContainer.innerHTML = `
        <h2>🎯 Simulado Concluído!</h2>
        <p>Você acertou ${score} de ${totalQuestions} questões (${percentage}%).</p>
        <p>Todas as questões foram revisadas. Ótimo trabalho!</p>
        ${flaggedQuestionsHTML}
        <div class="result-buttons" style="margin-top: 2rem;">
            <a href="simulado.html?id=${quizData.id}" class="button button-primary">Tentar Novamente</a>
            <a href="index.html" class="button button-secondary">Ver outros simulados</a>
        </div>
    `;
    resultadoContainer.classList.remove('hidden');
}


// --- NOVO: LÓGICA PARA SALVAR/CARREGAR PROGRESSO ---
function getProgressKey() {
    return `simuladoProgress_${quizData.id}`;
}

function saveProgress() {
    const progress = {
        currentQuestionIndex,
        score,
        incorrectQuestions,
        flaggedQuestions,
        isReviewMode,
        reviewQuestions: isReviewMode ? quizData.questoes : []
    };
    localStorage.setItem(getProgressKey(), JSON.stringify(progress));
}

function clearProgress() {
    localStorage.removeItem(getProgressKey());
}

function checkForSavedProgress() {
    const savedProgress = localStorage.getItem(getProgressKey());
    if (savedProgress) {
        const wantsToContinue = window.confirm("Encontramos um progresso salvo para este simulado. Deseja continuar de onde parou?");
        if (wantsToContinue) {
            const progress = JSON.parse(savedProgress);
            currentQuestionIndex = progress.currentQuestionIndex;
            score = progress.score;
            incorrectQuestions = progress.incorrectQuestions;
            flaggedQuestions = progress.flaggedQuestions;
            isReviewMode = progress.isReviewMode;
            if (isReviewMode) {
                quizData.questoes = progress.reviewQuestions;
            }
            displayCurrentQuestion();
            return true; // Indica que o progresso foi carregado
        } else {
            clearProgress(); // Limpa se o usuário não quiser continuar
        }
    }
    return false; // Nenhum progresso salvo ou usuário não quis continuar
}