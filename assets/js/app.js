// ==========================================
// SIMULASI UKP - APP ENGINE
// ==========================================

const CONFIG = window.UKP_CONFIG || {};
const SCRIPT_URL = CONFIG.SCRIPT_URL || '';
const QUESTION_BANK_URL = CONFIG.QUESTION_BANK_URL || './data/Bank_Soal_Simulasi_UKP_A_B_C_300_Soal.json';
const PASSING_SCORE = Number(CONFIG.PASSING_SCORE ?? 60);
const MAX_TIME_MINUTES = Number(CONFIG.MAX_TIME_MINUTES ?? 180);
const MAX_TIME_SECONDS = MAX_TIME_MINUTES * 60;
const SESSION_KEY = 'ukp_simulasi_session_v1';

let BANK_SOAL = { A: [], B: [], C: [] };

let appState = {
  user: { nama: '', email: '', hp: '' },
  tingkat: 'A',
  mode: 20,
  questions: [],
  answers: {},
  currentIndex: 0,
  timerSeconds: 0,
  timerInterval: null
};

// ==========================================
// 1. LOAD & NORMALIZE JSON QUESTION BANK
// ==========================================

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  const startButton = document.getElementById('startButton');
  const dataStatus = document.getElementById('dataStatus');

  try {
    const response = await fetch(QUESTION_BANK_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} saat memuat bank soal`);
    }

    const payload = await response.json();
    validateQuestionPayload(payload);
    BANK_SOAL = normalizeQuestionBank(payload.questions);

    const counts = ['A', 'B', 'C'].map(level => `${level}: ${BANK_SOAL[level].length}`).join(' • ');
    dataStatus.textContent = `Bank soal siap — ${counts}`;
    dataStatus.className = 'text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3';
    startButton.disabled = false;

    // Setelah bank soal tersedia, pulihkan sesi aktif (jika ada).
    restoreSession();
  } catch (error) {
    console.error('Gagal memuat bank soal:', error);
    dataStatus.innerHTML = `Gagal memuat bank soal. Pastikan file JSON berada di <strong>data/</strong> dan situs dijalankan melalui GitHub Pages/HTTP server.`;
    dataStatus.className = 'text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3';
    startButton.disabled = true;
  }
}

function validateQuestionPayload(payload) {
  if (!payload || !Array.isArray(payload.questions)) {
    throw new Error('Format JSON tidak valid: properti "questions" tidak ditemukan.');
  }

  if (payload.questions.length === 0) {
    throw new Error('Bank soal kosong.');
  }

  const validLevels = new Set(['A', 'B', 'C']);
  const validLetters = new Set(['A', 'B', 'C', 'D']);

  payload.questions.forEach((q, index) => {
    const label = q.id || `index ${index}`;

    if (!validLevels.has(q.level)) {
      throw new Error(`Level tidak valid pada ${label}.`);
    }
    if (!q.question || !q.category || !q.difficulty) {
      throw new Error(`Data pertanyaan tidak lengkap pada ${label}.`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`${label} harus memiliki tepat 4 pilihan.`);
    }
    if (!validLetters.has(q.correct_answer)) {
      throw new Error(`Kunci jawaban tidak valid pada ${label}.`);
    }

    const optionIds = q.options.map(opt => opt.id);
    if (new Set(optionIds).size !== 4 || optionIds.some(id => !validLetters.has(id))) {
      throw new Error(`ID pilihan A-D tidak valid pada ${label}.`);
    }

    const keyedOption = q.options.find(opt => opt.id === q.correct_answer);
    if (!keyedOption) {
      throw new Error(`Pilihan untuk kunci ${q.correct_answer} tidak ditemukan pada ${label}.`);
    }

    if (q.correct_answer_text && keyedOption.text !== q.correct_answer_text) {
      throw new Error(`Teks kunci tidak cocok pada ${label}.`);
    }
  });
}

function normalizeQuestionBank(questions) {
  const grouped = { A: [], B: [], C: [] };
  const letters = ['A', 'B', 'C', 'D'];

  questions.forEach(q => {
    const sortedOptions = [...q.options].sort((a, b) => letters.indexOf(a.id) - letters.indexOf(b.id));
    const keyIndex = sortedOptions.findIndex(opt => opt.id === q.correct_answer);

    grouped[q.level].push({
      id: q.id,
      number: q.number,
      cat: q.category,
      diff: q.difficulty,
      q: q.question,
      options: sortedOptions.map(opt => opt.text),
      key: keyIndex,
      exp: [q.explanation, q.legal_basis ? `Dasar hukum: ${q.legal_basis}` : ''].filter(Boolean).join(' ')
    });
  });

  Object.keys(grouped).forEach(level => {
    grouped[level].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  });

  return grouped;
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}


function selectLevel(level) {
  if (!['A', 'B', 'C'].includes(level)) return;
  document.getElementById('selectTingkat').value = level;
  document.querySelectorAll('.level-card').forEach(card => {
    card.classList.toggle('active', card.dataset.level === level);
  });
}

function selectMode(mode) {
  const value = Number(mode) === 100 ? 100 : 20;
  document.getElementById('selectMode').value = String(value);
  document.querySelectorAll('.mode-card').forEach(card => {
    card.classList.toggle('active', Number(card.dataset.mode) === value);
  });
  const summary = document.getElementById('summaryQuestionCount');
  if (summary) summary.textContent = `${value} PG`;
}

function updateQuizSummary() {
  const answered = Object.keys(appState.answers).length;
  const total = appState.questions.length;
  const answeredLabel = document.getElementById('answeredProgress');
  const sideAnswered = document.getElementById('sideAnswered');
  const sideUnanswered = document.getElementById('sideUnanswered');
  if (answeredLabel) answeredLabel.textContent = `${answered} terjawab`;
  if (sideAnswered) sideAnswered.textContent = answered;
  if (sideUnanswered) sideUnanswered.textContent = Math.max(total - answered, 0);
}

// ==========================================
// 2. SESSION PERSISTENCE
// ==========================================

function buildSessionPayload(screen = 'quiz') {
  return {
    version: 1,
    screen,
    savedAt: Date.now(),
    user: { ...appState.user },
    tingkat: appState.tingkat,
    mode: appState.mode,
    questionIds: appState.questions.map(q => q.id),
    answers: { ...appState.answers },
    currentIndex: appState.currentIndex,
    timerSeconds: appState.timerSeconds
  };
}

function saveSession(screen = 'quiz') {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(buildSessionPayload(screen)));
  } catch (err) {
    console.warn('Sesi simulasi tidak dapat disimpan:', err);
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (err) {
    console.warn('Sesi simulasi tidak dapat dihapus:', err);
  }
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Sesi simulasi tidak dapat dibaca:', err);
    return null;
  }
}

function restoreSession() {
  const saved = getSession();
  if (!saved || saved.version !== 1) return false;
  if (!['A', 'B', 'C'].includes(saved.tingkat)) {
    clearSession();
    return false;
  }

  const source = BANK_SOAL[saved.tingkat] || [];
  const byId = new Map(source.map(q => [q.id, q]));
  const savedQuestionIds = Array.isArray(saved.questionIds) ? saved.questionIds : [];
  const restoredQuestions = savedQuestionIds.map(id => byId.get(id)).filter(Boolean);

  // Jika struktur bank soal berubah sehingga soal sesi tidak lagi lengkap,
  // sesi dibatalkan agar kunci/jawaban tidak salah pasangan.
  if (!restoredQuestions.length || restoredQuestions.length !== savedQuestionIds.length) {
    clearSession();
    return false;
  }

  appState.user = {
    nama: saved.user?.nama || '',
    email: saved.user?.email || '',
    hp: saved.user?.hp || ''
  };
  appState.tingkat = saved.tingkat;
  appState.mode = Number(saved.mode) || restoredQuestions.length;
  selectLevel(appState.tingkat);
  selectMode(appState.mode);
  appState.questions = restoredQuestions;
  appState.answers = saved.answers && typeof saved.answers === 'object' ? saved.answers : {};
  appState.currentIndex = Math.min(
    Math.max(Number(saved.currentIndex) || 0, 0),
    restoredQuestions.length - 1
  );

  const elapsedWhileReloading = saved.screen === 'quiz' && saved.savedAt
    ? Math.max(0, Math.floor((Date.now() - Number(saved.savedAt)) / 1000))
    : 0;
  appState.timerSeconds = Math.min(
    MAX_TIME_SECONDS,
    Math.max(0, Number(saved.timerSeconds) || 0) + elapsedWhileReloading
  );

  document.getElementById('regScreen').classList.add('hidden');
  document.getElementById('quizBadge').innerText = 'Tingkat ' + appState.tingkat;

  if (saved.screen === 'result') {
    restoreResultScreen();
  } else if (appState.timerSeconds >= MAX_TIME_SECONDS) {
    // Jika waktu habis ketika halaman ditutup/di-refresh, ujian langsung diselesaikan.
    updateTimerDisplay();
    finishQuiz(true);
  } else {
    document.getElementById('resultScreen').classList.add('hidden');
    document.getElementById('quizScreen').classList.remove('hidden');
    document.getElementById('toggleCalcBtn').classList.remove('hidden');
    startTimer();
    renderQuestion();
  }

  return true;
}

function restoreResultScreen() {
  clearInterval(appState.timerInterval);

  let correctCount = 0;
  appState.questions.forEach((q, idx) => {
    if (Number(appState.answers[idx]) === q.key) correctCount++;
  });

  const total = appState.questions.length;
  const finalScore = total ? ((correctCount / total) * 100).toFixed(1) : '0.0';
  const wrongCount = total - correctCount;
  const m = Math.floor(appState.timerSeconds / 60).toString().padStart(2, '0');
  const s = (appState.timerSeconds % 60).toString().padStart(2, '0');

  document.getElementById('quizScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.remove('hidden');
  document.getElementById('toggleCalcBtn').classList.add('hidden');

  document.getElementById('resultUserMeta').innerText = `${appState.user.nama} • Tingkat ${appState.tingkat}`;
  document.getElementById('resultScore').innerText = finalScore;
  document.getElementById('resCorrect').innerText = correctCount;
  document.getElementById('resWrong').innerText = wrongCount;
  document.getElementById('resTime').innerText = `${m}:${s}`;

  const badgeEl = document.getElementById('resultBadge');
  if (Number(finalScore) >= PASSING_SCORE) {
    badgeEl.innerText = 'LULUS SIMULASI UKP';
    badgeEl.className = 'inline-block px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
  } else {
    badgeEl.innerText = 'PERLU PERSIAPAN LAGI';
    badgeEl.className = 'inline-block px-4 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300';
  }

  renderReview();
}

// ==========================================
// 3. QUIZ LOGIC
// ==========================================

function startQuiz(e) {
  e.preventDefault();

  appState.user.nama = document.getElementById('inputNama').value.trim();
  appState.user.email = document.getElementById('inputEmail').value.trim();
  appState.user.hp = document.getElementById('inputHp').value.trim();
  appState.tingkat = document.getElementById('selectTingkat').value;
  appState.mode = parseInt(document.getElementById('selectMode').value, 10);

  const baseQuestions = BANK_SOAL[appState.tingkat] || [];
  if (baseQuestions.length === 0) {
    alert('Bank soal untuk tingkat ini belum tersedia.');
    return;
  }

  if (appState.mode > baseQuestions.length) {
    alert(`Jumlah soal yang diminta (${appState.mode}) melebihi bank soal Tingkat ${appState.tingkat} (${baseQuestions.length}).`);
    return;
  }

  // Acak urutan soal, tanpa mengubah urutan opsi/kunci.
  // Mode 20 mengambil 20 soal acak; mode 100 memakai seluruh 100 soal level yang dipilih.
  appState.questions = shuffleArray(baseQuestions).slice(0, appState.mode);
  appState.currentIndex = 0;
  appState.answers = {};
  appState.timerSeconds = 0;
  saveSession('quiz');

  document.getElementById('regScreen').classList.add('hidden');
  document.getElementById('quizScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('toggleCalcBtn').classList.remove('hidden');
  document.getElementById('quizBadge').innerText = 'Tingkat ' + appState.tingkat;

  startTimer();
  renderQuestion();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startTimer() {
  clearInterval(appState.timerInterval);
  updateTimerDisplay();

  // Pengaman jika sesi yang dipulihkan sudah mencapai batas waktu.
  if (appState.timerSeconds >= MAX_TIME_SECONDS) {
    appState.timerSeconds = MAX_TIME_SECONDS;
    finishQuiz(true);
    return;
  }

  appState.timerInterval = setInterval(() => {
    appState.timerSeconds++;

    if (appState.timerSeconds >= MAX_TIME_SECONDS) {
      appState.timerSeconds = MAX_TIME_SECONDS;
      updateTimerDisplay();
      saveSession('quiz');
      finishQuiz(true);
      return;
    }

    updateTimerDisplay();
    if (appState.timerSeconds % 5 === 0) saveSession('quiz');
  }, 1000);
}

function updateTimerDisplay() {
  const remaining = Math.max(MAX_TIME_SECONDS - appState.timerSeconds, 0);
  const h = Math.floor(remaining / 3600).toString().padStart(2, '0');
  const m = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
  const s = (remaining % 60).toString().padStart(2, '0');
  const display = document.getElementById('timerDisplay');
  if (display) display.innerText = `${h}:${m}:${s}`;
}

function renderQuestion() {
  const q = appState.questions[appState.currentIndex];
  if (!q) return;

  document.getElementById('quizProgress').innerText = `Soal ${appState.currentIndex + 1} dari ${appState.questions.length}`;
  updateQuizSummary();
  document.getElementById('questionCategory').innerText = q.cat;
  document.getElementById('questionDifficulty').innerText = q.diff;
  document.getElementById('questionText').innerText = q.q;

  const optionsContainer = document.getElementById('optionsContainer');
  optionsContainer.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  q.options.forEach((opt, idx) => {
    const isSelected = appState.answers[appState.currentIndex] === idx;
    const activeClass = isSelected
      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-900 font-semibold ring-2 ring-indigo-500'
      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800';
    const badgeClass = isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600';

    const optionEl = document.createElement('button');
    optionEl.type = 'button';
    optionEl.className = `w-full text-left p-3.5 rounded-xl border ${activeClass} cursor-pointer transition flex items-start space-x-3 text-sm md:text-base`;
    optionEl.addEventListener('click', () => selectOption(idx));

    const badge = document.createElement('span');
    badge.className = `w-7 h-7 rounded-lg ${badgeClass} font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5`;
    badge.textContent = letters[idx];

    const text = document.createElement('span');
    text.className = 'pt-0.5';
    text.textContent = opt;

    optionEl.append(badge, text);
    optionsContainer.appendChild(optionEl);
  });

  document.getElementById('prevBtn').disabled = appState.currentIndex === 0;
  if (appState.currentIndex === appState.questions.length - 1) {
    document.getElementById('nextBtn').classList.add('hidden');
    document.getElementById('finishBtn').classList.remove('hidden');
  } else {
    document.getElementById('nextBtn').classList.remove('hidden');
    document.getElementById('finishBtn').classList.add('hidden');
  }
}

function selectOption(optIndex) {
  appState.answers[appState.currentIndex] = optIndex;
  saveSession('quiz');
  renderQuestion();
}

function navigateQuestion(direction) {
  const newIndex = appState.currentIndex + direction;
  if (newIndex >= 0 && newIndex < appState.questions.length) {
    appState.currentIndex = newIndex;
    saveSession('quiz');
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function confirmFinishQuiz() {
  const answeredCount = Object.keys(appState.answers).length;
  const total = appState.questions.length;

  if (answeredCount < total) {
    if (!confirm(`Anda baru menjawab ${answeredCount} dari ${total} soal. Yakin ingin menyelesaikan simulasi sekarang?`)) {
      return;
    }
  }
  finishQuiz();
}

function finishQuiz(timeExpired = false) {
  clearInterval(appState.timerInterval);

  // Pastikan waktu yang tercatat tidak pernah melebihi limit.
  appState.timerSeconds = Math.min(appState.timerSeconds, MAX_TIME_SECONDS);

  let correctCount = 0;
  appState.questions.forEach((q, idx) => {
    if (appState.answers[idx] === q.key) correctCount++;
  });

  const total = appState.questions.length;
  const finalScore = total ? ((correctCount / total) * 100).toFixed(1) : '0.0';
  const wrongCount = total - correctCount;

  const m = Math.floor(appState.timerSeconds / 60).toString().padStart(2, '0');
  const s = (appState.timerSeconds % 60).toString().padStart(2, '0');
  const timeStr = `${m}:${s}`;

  saveSession('result');

  sendDataToSpreadsheet({
    nama: appState.user.nama,
    email: appState.user.email,
    hp: appState.user.hp,
    tingkat: 'Tingkat ' + appState.tingkat,
    mode: appState.mode + ' Soal',
    skor: finalScore,
    benar: correctCount,
    total,
    status: Number(finalScore) >= PASSING_SCORE ? 'LULUS' : 'TIDAK LULUS'
  });

  document.getElementById('quizScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.remove('hidden');
  document.getElementById('toggleCalcBtn').classList.add('hidden');
  closeCalculator();

  document.getElementById('resultUserMeta').innerText = `${appState.user.nama} • Tingkat ${appState.tingkat}`;
  document.getElementById('resultScore').innerText = finalScore;
  document.getElementById('resCorrect').innerText = correctCount;
  document.getElementById('resWrong').innerText = wrongCount;
  document.getElementById('resTime').innerText = timeStr;

  const badgeEl = document.getElementById('resultBadge');
  if (Number(finalScore) >= PASSING_SCORE) {
    badgeEl.innerText = 'LULUS SIMULASI UKP';
    badgeEl.className = 'inline-block px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
  } else {
    badgeEl.innerText = 'PERLU PERSIAPAN LAGI';
    badgeEl.className = 'inline-block px-4 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300';
  }

  renderReview();

  if (timeExpired) {
    alert(`Waktu maksimal ${MAX_TIME_MINUTES} menit telah habis. Simulasi otomatis diselesaikan.`);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 4. SILENT DATA SUBMISSION
// ==========================================

async function sendDataToSpreadsheet(payload) {
  if (!SCRIPT_URL || SCRIPT_URL.includes('YOUR_DEPLOYED_SCRIPT_ID_HERE')) {
    console.log('Script URL belum dikonfigurasi. Data tidak dikirim.');
    return;
  }

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('Data hasil simulasi dikirim di latar belakang.');
  } catch (err) {
    console.error('Gagal mengirim data:', err);
  }
}

// ==========================================
// 5. REVIEW & EXPLANATION
// ==========================================

function renderReview() {
  const container = document.getElementById('reviewContainer');
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  appState.questions.forEach((q, idx) => {
    const userAns = appState.answers[idx];
    const isCorrect = userAns === q.key;
    const borderClass = isCorrect ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30';
    const iconClass = isCorrect ? 'fa-circle-check text-emerald-600' : 'fa-circle-xmark text-red-600';

    const card = document.createElement('div');
    card.className = `bg-white rounded-xl border ${borderClass} p-5 space-y-3 shadow-sm`;

    const header = document.createElement('div');
    header.className = 'flex items-start justify-between';

    const title = document.createElement('div');
    title.className = 'font-bold text-slate-800 text-sm md:text-base';
    const no = document.createElement('span');
    no.className = 'text-indigo-600 mr-1';
    no.textContent = `#${idx + 1}`;
    title.append(no, document.createTextNode(' ' + q.q));

    const icon = document.createElement('i');
    icon.className = `fa-solid ${iconClass} text-xl ml-2 flex-shrink-0`;
    header.append(title, icon);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-2 text-xs md:text-sm pt-1';

    const userBox = document.createElement('div');
    userBox.className = `p-2.5 rounded-lg ${userAns === q.key ? 'bg-emerald-100 text-emerald-900 font-semibold' : (userAns !== undefined ? 'bg-red-100 text-red-900' : 'bg-slate-100 text-slate-500')}`;
    userBox.textContent = `Jawaban Anda: ${userAns !== undefined ? `${letters[userAns]}. ${q.options[userAns]}` : 'Tidak Dijawab'}`;

    const keyBox = document.createElement('div');
    keyBox.className = 'p-2.5 rounded-lg bg-emerald-100 text-emerald-900 font-semibold';
    keyBox.textContent = `Kunci Jawaban: ${letters[q.key]}. ${q.options[q.key]}`;
    grid.append(userBox, keyBox);

    const explanation = document.createElement('div');
    explanation.className = 'text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 mt-2';
    const strong = document.createElement('strong');
    strong.className = 'text-indigo-900';
    strong.textContent = 'Pembahasan & Regulasi: ';
    explanation.append(strong, document.createTextNode(q.exp || '-'));

    card.append(header, grid, explanation);
    container.appendChild(card);
  });
}

function toggleReviewSection() {
  const rev = document.getElementById('reviewSection');
  rev.classList.toggle('hidden');
  if (!rev.classList.contains('hidden')) {
    rev.scrollIntoView({ behavior: 'smooth' });
  }
}

function resetApp() {
  clearInterval(appState.timerInterval);
  clearSession();
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('reviewSection').classList.add('hidden');
  document.getElementById('regScreen').classList.remove('hidden');
  document.getElementById('regForm').reset();
  selectLevel('A');
  selectMode(20);
  appState.answers = {};
  appState.questions = [];
  appState.currentIndex = 0;
  appState.timerSeconds = 0;
  updateTimerDisplay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 6. QUESTION GRID MODAL
// ==========================================

function openQuestionGrid() {
  const container = document.getElementById('questionGridBtns');
  container.innerHTML = '';

  appState.questions.forEach((q, idx) => {
    const isAnswered = appState.answers[idx] !== undefined;
    const isCurrent = idx === appState.currentIndex;
    const bgClass = isCurrent
      ? 'ring-2 ring-indigo-600 bg-indigo-600 text-white font-bold'
      : (isAnswered ? 'bg-indigo-100 text-indigo-800 font-bold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `py-2 rounded-lg text-sm transition ${bgClass}`;
    btn.textContent = idx + 1;
    btn.addEventListener('click', () => jumpToQuestion(idx));
    container.appendChild(btn);
  });

  document.getElementById('gridModal').classList.remove('hidden');
}

function closeQuestionGrid() {
  document.getElementById('gridModal').classList.add('hidden');
}

function jumpToQuestion(idx) {
  appState.currentIndex = idx;
  saveSession('quiz');
  renderQuestion();
  closeQuestionGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 7. CALCULATOR WIDGET
// ==========================================

let calcState = { cur: '0', prev: '', op: null };

function toggleCalculator() {
  document.getElementById('calcModal').classList.toggle('hidden');
}

function closeCalculator() {
  document.getElementById('calcModal').classList.add('hidden');
}

function calcNum(n) {
  if (calcState.cur === '0' && n !== '.') calcState.cur = n;
  else if (n === '.' && calcState.cur.includes('.')) return;
  else calcState.cur += n;
  updateCalcDisplay();
}

function calcOp(op) {
  if (calcState.cur === '') return;
  if (calcState.prev !== '') calcEqual();
  calcState.op = op;
  calcState.prev = calcState.cur;
  calcState.cur = '';
  updateCalcDisplay();
}

function calcClear() {
  calcState = { cur: '0', prev: '', op: null };
  updateCalcDisplay();
}

function calcDelete() {
  if (calcState.cur.length > 1) calcState.cur = calcState.cur.slice(0, -1);
  else calcState.cur = '0';
  updateCalcDisplay();
}

function calcEqual() {
  let result;
  const p = parseFloat(calcState.prev);
  const c = parseFloat(calcState.cur);
  if (isNaN(p) || isNaN(c)) return;

  switch (calcState.op) {
    case '+': result = p + c; break;
    case '-': result = p - c; break;
    case '*': result = p * c; break;
    case '/': result = c !== 0 ? p / c : 'Error'; break;
    default: return;
  }

  calcState.cur = result.toString();
  calcState.op = null;
  calcState.prev = '';
  updateCalcDisplay();
}

function updateCalcDisplay() {
  document.getElementById('calcDisplayCur').innerText = calcState.cur || '0';
  document.getElementById('calcDisplayPrev').innerText = calcState.prev && calcState.op ? `${calcState.prev} ${calcState.op}` : '';
}
