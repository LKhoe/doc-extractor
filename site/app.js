// ============================================
// Configuration
// ============================================

const CONFIG = {
  florence: {
    modelId: 'onnx-community/Florence-2-base-ft',
    dtype: 'q4',
  },
  wllama: {
    modelRepo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    modelFile: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  },
  maxThumbPages: 30,
  pdfRenderScale: 1.5,
  thumbScale: 0.25,
  maxTextChars: 4000,
  sparseTextThreshold: 50, // avg chars/page below this → OCR needed
};

const DEFAULT_FIELDS = [
  'Document Type',
  'Title',
  'Author',
  'Date',
  'Language',
  'Summary',
];

// ============================================
// DOM References
// ============================================

const $ = (s) => document.querySelector(s);
const uploadSection = $('#uploadSection');
const dropZone = $('#dropZone');
const fileInput = $('#fileInput');
const browseBtn = $('#browseBtn');
const engineSelector = $('#engineSelector');
const pageSection = $('#pageSection');
const pageCount = $('#pageCount');
const pageRange = $('#pageRange');
const configSection = $('#configSection');
const extractInstructions = $('#extractInstructions');
const fieldRows = $('#fieldRows');
const addFieldBtn = $('#addFieldBtn');
const analyzeBtn = $('#analyzeBtn');
const pageThumbnails = $('#pageThumbnails');
const statusArea = $('#statusArea');
const statusText = $('#statusText');
const progressBar = $('#progressBar');
const progressFill = $('#progressFill');
const resultsArea = $('#resultsArea');
const resultGrid = $('#resultGrid');
const rawResponse = $('#rawResponse');
const resetBtn = $('#resetBtn');
const chromeFlagsBtn = $('#chromeFlagsBtn');
const chromeFlagsInfo = $('#chromeFlagsInfo');

// ============================================
// State
// ============================================

let pdfDoc = null;
let pdfTotalPages = 0;
let selectedPages = new Set();

// Cached model instances
let florenceModel = null;
let florenceProcessor = null;
let wllamaInstance = null;

// Timer (excludes download time)
let timerStart = 0;
let timerPaused = 0;
let timerPauseStart = 0;

function timerReset() {
  timerStart = performance.now();
  timerPaused = 0;
  timerPauseStart = 0;
}

function timerPause() {
  if (!timerPauseStart) timerPauseStart = performance.now();
}

function timerResume() {
  if (timerPauseStart) {
    timerPaused += performance.now() - timerPauseStart;
    timerPauseStart = 0;
  }
}

function timerElapsed() {
  const now = performance.now();
  const pauseExtra = timerPauseStart ? now - timerPauseStart : 0;
  const ms = now - timerStart - timerPaused - pauseExtra;
  return ms;
}

function formatElapsed(ms) {
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = (secs % 60).toFixed(0);
  return `${mins}m ${remSecs}s`;
}

// ============================================
// Extraction Fields UI
// ============================================

function initFieldRows() {
  fieldRows.innerHTML = '';
  for (const name of DEFAULT_FIELDS) addFieldRow(name);
}

function addFieldRow(value = '') {
  const row = document.createElement('div');
  row.className = 'field-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = 'Field name';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'field-remove';
  btn.textContent = '\u00d7';
  btn.addEventListener('click', () => row.remove());
  row.append(input, btn);
  fieldRows.appendChild(row);
  return input;
}

function getFieldNames() {
  return [...fieldRows.querySelectorAll('input')]
    .map((i) => i.value.trim())
    .filter(Boolean);
}

// ============================================
// Dynamic Prompt Builder
// ============================================

function buildExtractionPrompt() {
  const instructions = extractInstructions.value.trim()
    || 'Analyze the provided document and extract key information.';
  const fields = getFieldNames();
  const fieldLines = fields.map((f) => `  "${f}": "extracted value or null"`).join(',\n');

  return `${instructions}

Return ONLY a JSON object (no markdown, no code fences) with these fields:
{
${fieldLines}
}

Only include fields you can confidently identify from the document.`;
}

// ============================================
// Page Range Parser
// ============================================

function parsePageRange(str, total) {
  const pages = new Set();
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number);
      if (isNaN(a) || isNaN(b)) continue;
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) pages.add(i);
    } else {
      const n = Number(trimmed);
      if (!isNaN(n) && n >= 1 && n <= total) pages.add(n);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function pagesToRangeString(pages) {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0], end = start;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = sorted[i];
      end = start;
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(', ');
}

// ============================================
// PDF Utilities (lazy-loaded)
// ============================================

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
  return pdfjsLib;
}

async function loadPdf(file) {
  const lib = await loadPdfJs();
  const data = await file.arrayBuffer();
  const doc = await lib.getDocument({ data }).promise;
  return doc;
}

async function renderPageToCanvas(doc, pageNum, scale) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

async function renderPageImages(doc, pages, scale) {
  const blobs = [];
  for (const p of pages) {
    const canvas = await renderPageToCanvas(doc, p, scale);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    blobs.push(blob);
  }
  return blobs;
}

async function extractPdfText(doc, pages) {
  let text = '';
  for (const p of pages) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(' ');
    text += `--- Page ${p} ---\n${pageText}\n\n`;
  }
  return text.slice(0, CONFIG.maxTextChars);
}

// ============================================
// Engine Definitions & Detection
// ============================================

const ENGINES = [
  {
    id: 'prompt-api-multimodal',
    name: 'Gemini Nano (Multimodal)',
    desc: 'Direct image analysis via Chrome built-in AI',
  },
  {
    id: 'prompt-api-text',
    name: 'Gemini Nano (Text)',
    desc: 'PDF text extraction + Chrome built-in AI',
  },
  {
    id: 'florence-wllama',
    name: 'Florence-2 + wllama',
    desc: 'On-device vision OCR + text analysis (~570 MB total)',
  },
  {
    id: 'tesseract-wllama',
    name: 'Tesseract.js + wllama',
    desc: 'Traditional OCR + on-device text analysis (~370 MB total)',
  },
];

// Resolve the LanguageModel API — Chrome ships it as a global in 138+,
// older builds (Canary / Dev) expose it under window.ai.languageModel.
function getLanguageModelAPI() {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  if (typeof window !== 'undefined' && window.ai?.languageModel) return window.ai.languageModel;
  return null;
}

// Chrome versions return different strings for availability:
//   'readily' | 'readily-available' | 'available'  → ready now
//   'after-download' | 'downloadable'               → needs download
//   'downloading'                                    → in progress
//   'unavailable' | 'no' | null/undefined            → not usable
function parseAvailability(raw) {
  const v = (raw || '').toLowerCase();
  if (['readily', 'readily-available', 'available'].includes(v))
    return { usable: true, label: 'Ready', cls: 'ready' };
  if (['after-download', 'downloadable'].includes(v))
    return { usable: true, label: 'Needs download', cls: 'download' };
  if (v === 'downloading')
    return { usable: true, label: 'Downloading...', cls: 'download' };
  return { usable: false, label: 'Unavailable', cls: 'unavailable' };
}

async function detectAllEngines() {
  const avail = {};
  let multiRaw = 'unavailable';
  let textRaw = 'unavailable';

  const api = getLanguageModelAPI();
  if (api) {
    try {
      multiRaw = await api.availability({ expectedInputs: [{ type: 'image' }] }) || 'unavailable';
    } catch { /* multimodal not supported at all */ }
    try {
      textRaw = await api.availability() || 'unavailable';
    } catch { /* text not supported */ }
  }

  avail['prompt-api-multimodal'] = parseAvailability(multiRaw);
  avail['prompt-api-text'] = parseAvailability(textRaw);
  avail['florence-wllama'] = { usable: true, label: 'Ready', cls: 'ready' };
  avail['tesseract-wllama'] = { usable: true, label: 'Ready', cls: 'ready' };
  return avail;
}

function renderEngineSelector(availability) {
  engineSelector.innerHTML = '';
  let firstAvailable = null;

  for (const engine of ENGINES) {
    const info = availability[engine.id];
    if (info.usable && !firstAvailable) firstAvailable = engine.id;

    const label = document.createElement('label');
    label.className = `engine-option${info.usable ? '' : ' disabled'}`;

    label.innerHTML = `
      <input type="radio" name="engine" value="${engine.id}" ${info.usable ? '' : 'disabled'}>
      <div class="engine-option-info">
        <span class="engine-name">${engine.name}</span>
        <span class="engine-desc">${engine.desc}</span>
      </div>
      <span class="engine-status ${info.cls}">
        ${info.label}
      </span>`;
    engineSelector.appendChild(label);
  }

  // Auto-select best available
  if (firstAvailable) {
    const radio = engineSelector.querySelector(`input[value="${firstAvailable}"]`);
    radio.checked = true;
    radio.closest('.engine-option').classList.add('selected');
  }

  // Handle selection
  engineSelector.addEventListener('change', (e) => {
    engineSelector.querySelectorAll('.engine-option').forEach((o) => o.classList.remove('selected'));
    e.target.closest('.engine-option').classList.add('selected');
  });

  // Always show Chrome flags help button
  chromeFlagsBtn.hidden = false;
  chromeFlagsInfo.hidden = true;
}

function getSelectedEngine() {
  const checked = engineSelector.querySelector('input[name="engine"]:checked');
  return checked?.value ?? null;
}

// ============================================
// Prompt API Engines
// ============================================

async function createPromptAPISession(options) {
  setStatus('Loading Gemini Nano model...');
  showProgress(true);
  timerPause();
  const api = getLanguageModelAPI();

  const session = await api.create({
    // systemPrompt is not valid — use initialPrompts with role:'system'
    initialPrompts: [
      { role: 'system', content: 'You are a document analysis assistant. Always respond with valid JSON only.' },
    ],
    ...options,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        // e.loaded is a 0-1 fraction in some builds, byte count in others
        const loaded = e.loaded ?? 0;
        const total = e.total ?? 0;
        let pct;
        if (loaded <= 1 && total <= 1) {
          pct = Math.round(loaded * 100);
        } else if (total > 0) {
          pct = Math.round((loaded / total) * 100);
        } else {
          pct = 0;
        }
        setProgress(pct);
        setStatus(`Downloading Gemini Nano... ${pct}%`);
      });
    },
  });
  showProgress(false);
  timerResume();
  return session;
}

// prompt() is more reliable than promptStreaming() across Chrome versions
// (streaming chunk format changed between Chrome <131 and 131+)
async function runPromptAPISession(session, input, onChunk) {
  setStatus('Analyzing document...');
  try {
    // Try streaming first
    const stream = session.promptStreaming(input);
    let result = '';
    for await (const chunk of stream) {
      // Chrome <131: chunk = accumulated text, Chrome 131+: chunk = incremental
      // Detect: if chunk starts with current result, it's accumulated
      if (result.length > 0 && chunk.length >= result.length && chunk.startsWith(result.slice(0, 30))) {
        result = chunk;
      } else {
        result += chunk;
      }
      onChunk(result);
    }
    session.destroy();
    return result;
  } catch {
    // Fallback to non-streaming
    const result = await session.prompt(typeof input === 'string' ? input : input);
    onChunk(result);
    session.destroy();
    return result;
  }
}

async function analyzePromptAPIMultimodal(pages, onChunk) {
  setStatus('Rendering PDF pages...');
  const images = await renderPageImages(pdfDoc, pages, CONFIG.pdfRenderScale);
  const session = await createPromptAPISession({ expectedInputs: [{ type: 'image' }] });

  const content = [{ type: 'text', value: buildExtractionPrompt() }];
  for (const blob of images) content.push({ type: 'image', value: blob });
  return runPromptAPISession(session, [{ role: 'user', content }], onChunk);
}

async function analyzePromptAPIText(pages, onChunk) {
  setStatus('Extracting text from PDF...');
  const text = await extractPdfText(pdfDoc, pages);
  const session = await createPromptAPISession({});
  return runPromptAPISession(session, `${buildExtractionPrompt()}\n\nDocument text:\n${text}`, onChunk);
}

// ============================================
// Florence-2 (Multimodal OCR + Captioning)
// ============================================

async function initFlorence(onStatus, onProgress) {
  if (florenceModel && florenceProcessor) return;

  timerPause();
  onStatus?.('Loading Florence-2 library...');
  const transformers = await import('https://esm.sh/@huggingface/transformers@3.8.1');
  const { Florence2ForConditionalGeneration, AutoProcessor } = transformers;

  const modelId = CONFIG.florence.modelId;
  const dtype = CONFIG.florence.dtype;

  // Track download progress across all model files
  const fileProgress = {};
  const progressCallback = (progress) => {
    if (progress.status === 'progress' && progress.file) {
      fileProgress[progress.file] = { loaded: progress.loaded || 0, total: progress.total || 0 };
      const totals = Object.values(fileProgress);
      const loaded = totals.reduce((s, f) => s + f.loaded, 0);
      const total = totals.reduce((s, f) => s + f.total, 0);
      if (total > 0) {
        const pct = Math.round((loaded / total) * 100);
        const mb = (n) => (n / 1024 / 1024).toFixed(0);
        onProgress?.(pct);
        onStatus?.(`Downloading Florence-2... ${pct}% (${mb(loaded)}/${mb(total)} MB)`);
      }
    } else if (progress.status === 'ready') {
      onStatus?.('Florence-2 model loaded.');
    }
  };

  try {
    onStatus?.('Downloading Florence-2 processor...');
    florenceProcessor = await AutoProcessor.from_pretrained(modelId, { progress_callback: progressCallback });
    onStatus?.('Downloading Florence-2 model (cached after first use)...');
    florenceModel = await Florence2ForConditionalGeneration.from_pretrained(modelId, { dtype, progress_callback: progressCallback });
  } catch (err) {
    florenceProcessor = null;
    florenceModel = null;
    throw new Error(`Florence-2 failed to load: ${err?.message || err?.toString?.() || String(err)}`);
  } finally {
    timerResume();
  }
}

async function florenceTask(imageBlob, task) {
  const transformers = await import('https://esm.sh/@huggingface/transformers@3.8.1');
  const { RawImage } = transformers;

  const url = URL.createObjectURL(imageBlob);
  let image;
  try {
    image = await RawImage.read(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const prompts = florenceProcessor.construct_prompts(task);
  const inputs = await florenceProcessor(image, prompts);
  const generatedIds = await florenceModel.generate({
    ...inputs,
    max_new_tokens: 1024,
  });
  const decoded = florenceProcessor.batch_decode(generatedIds, {
    skip_special_tokens: false,
  })[0];
  const result = florenceProcessor.post_process_generation(
    decoded,
    task,
    { width: image.width, height: image.height }
  );
  return result[task] || '';
}

async function florenceOCR(imageBlobs, onStatus, onProgress) {
  await initFlorence(onStatus, onProgress);
  const texts = [];
  for (let i = 0; i < imageBlobs.length; i++) {
    onStatus?.(`Florence-2 OCR: page ${i + 1}/${imageBlobs.length}...`);
    const text = await florenceTask(imageBlobs[i], '<OCR>');
    texts.push(text);
  }
  return texts.join('\n\n');
}

async function florenceCaption(imageBlobs, onStatus) {
  const captions = [];
  for (let i = 0; i < imageBlobs.length; i++) {
    onStatus?.(`Florence-2 captioning: page ${i + 1}/${imageBlobs.length}...`);
    const caption = await florenceTask(imageBlobs[i], '<MORE_DETAILED_CAPTION>');
    captions.push(caption);
  }
  return captions.join('\n');
}

// ============================================
// Tesseract.js OCR
// ============================================

async function ocrWithTesseract(imageBlobs, onStatus, onProgress) {
  timerPause();
  onStatus?.('Loading Tesseract.js OCR engine...');
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'loading tesseract core') {
        onStatus?.('Loading Tesseract core...');
        onProgress?.(Math.round((m.progress || 0) * 100));
      } else if (m.status === 'initializing tesseract') {
        onStatus?.('Initializing Tesseract...');
      } else if (m.status === 'loading language traineddata') {
        const pct = Math.round((m.progress || 0) * 100);
        onProgress?.(pct);
        onStatus?.(`Downloading language data... ${pct}%`);
      } else if (m.status === 'recognizing text') {
        const page = m.userJobId != null ? ` (page ${Number(m.userJobId) + 1})` : '';
        onProgress?.(Math.round((m.progress || 0) * 100));
        onStatus?.(`Recognizing text${page}... ${Math.round((m.progress || 0) * 100)}%`);
      }
    },
  });
  timerResume();
  const texts = [];
  for (let i = 0; i < imageBlobs.length; i++) {
    onStatus?.(`Tesseract OCR: page ${i + 1}/${imageBlobs.length}...`);
    const { data } = await worker.recognize(imageBlobs[i]);
    texts.push(data.text);
  }
  await worker.terminate();
  return texts.join('\n\n');
}

// ============================================
// wllama (Text Analysis)
// ============================================

const WLLAMA_VERSION = '2.3.7';
const WLLAMA_CDN = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}`;

async function initWllama(onStatus, onProgress) {
  if (wllamaInstance) return;

  timerPause();
  onStatus?.('Loading wllama engine...');
  const { Wllama } = await import(`${WLLAMA_CDN}/esm/index.js`);

  const wasmPaths = {
    'single-thread/wllama.wasm': `${WLLAMA_CDN}/esm/single-thread/wllama.wasm`,
    'multi-thread/wllama.wasm': `${WLLAMA_CDN}/esm/multi-thread/wllama.wasm`,
  };

  wllamaInstance = new Wllama(wasmPaths);

  onStatus?.('Downloading text model (cached after first use)...');
  await wllamaInstance.loadModelFromHF(
    CONFIG.wllama.modelRepo,
    CONFIG.wllama.modelFile,
    {
      n_ctx: 4096,
      progressCallback: ({ loaded, total }) => {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        const mb = (n) => (n / 1024 / 1024).toFixed(0);
        onProgress?.(pct);
        onStatus?.(`Downloading text model... ${pct}% (${mb(loaded)}/${mb(total)} MB)`);
      },
    }
  );
  timerResume();
}

async function analyzeTextWithWllama(text, onChunk) {
  // Reserve ~1200 tokens for prompt template + response; rest for document text
  // Rough estimate: 1 token ≈ 4 chars
  const maxDocChars = (4096 - 1200) * 4; // ~11584 chars
  const trimmedText = text.slice(0, maxDocChars);

  const prompt = `<|im_start|>system
You are a document analysis assistant. Always respond with valid JSON only.<|im_end|>
<|im_start|>user
${buildExtractionPrompt()}

Document text:
${trimmedText}<|im_end|>
<|im_start|>assistant
`;

  console.log('[wllama] prompt length:', prompt.length, 'chars');
  console.log('[wllama] prompt:', prompt);
  setStatus('Processing prompt (this may take a moment)...');

  let result = '';
  let tokenCount = 0;
  try {
    const output = await wllamaInstance.createCompletion(prompt, {
      nPredict: 512,
      sampling: { temp: 0.3, top_k: 40, top_p: 0.9 },
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        tokenCount++;
        result = currentText;
        onChunk?.(result);
        setStatus(`Generating response... (${tokenCount} tokens)`);
      },
    });
    console.log('[wllama] done, output length:', (output || '').length);
    return output || result;
  } catch (err) {
    console.error('[wllama] createCompletion error:', err);
    throw err;
  }
}

// ============================================
// Florence-2 + wllama Pipeline
// ============================================

async function analyzeFlorenceWllama(pages, onChunk) {
  const onStatus = (msg) => setStatus(msg);
  const onProgress = (pct) => setProgress(pct);

  // 1. Render pages
  setStatus('Rendering PDF pages...');
  const images = await renderPageImages(pdfDoc, pages, CONFIG.pdfRenderScale);

  // 2. Text extraction — PDF.js first, Florence-2 OCR if sparse
  setStatus('Extracting text layer...');
  let pdfText = await extractPdfText(pdfDoc, pages);
  const hasSparseText = (pdfText.length / pages.length) < CONFIG.sparseTextThreshold;

  let ocrText = '';
  let captionText = '';

  showProgress(true);
  if (hasSparseText) {
    ocrText = await florenceOCR(images, onStatus, onProgress);
  } else {
    await initFlorence(onStatus, onProgress);
  }
  showProgress(false);
  captionText = await florenceCaption(images, onStatus);

  // 3. Combine text
  let combined = '';
  if (ocrText) combined += `[OCR Text]\n${ocrText}\n\n`;
  if (!hasSparseText) combined += `[Document Text]\n${pdfText}\n\n`;
  if (captionText) combined += `[Visual Description]\n${captionText}\n\n`;
  combined = combined.slice(0, CONFIG.maxTextChars);

  // 4. Analyze with wllama
  showProgress(true);
  await initWllama(onStatus, onProgress);
  showProgress(false);
  setStatus('Analyzing with AI...');
  return await analyzeTextWithWllama(combined, onChunk);
}

// ============================================
// Tesseract.js + wllama Pipeline
// ============================================

async function analyzeTesseractWllama(pages, onChunk) {
  const onStatus = (msg) => setStatus(msg);
  const onProgress = (pct) => setProgress(pct);

  // 1. Render pages
  setStatus('Rendering PDF pages...');
  const images = await renderPageImages(pdfDoc, pages, CONFIG.pdfRenderScale);

  // 2. Text extraction — PDF.js first, Tesseract OCR if sparse
  setStatus('Extracting text layer...');
  let pdfText = await extractPdfText(pdfDoc, pages);
  const hasSparseText = (pdfText.length / pages.length) < CONFIG.sparseTextThreshold;

  let ocrText = '';
  if (hasSparseText) {
    showProgress(true);
    ocrText = await ocrWithTesseract(images, onStatus, onProgress);
    showProgress(false);
  }

  let combined = '';
  if (ocrText) combined += `[OCR Text]\n${ocrText}\n\n`;
  if (!hasSparseText) combined += `[Document Text]\n${pdfText}\n\n`;
  combined = combined.slice(0, CONFIG.maxTextChars);

  // 3. Analyze with wllama
  showProgress(true);
  await initWllama(onStatus, onProgress);
  showProgress(false);
  setStatus('Analyzing with AI...');
  return await analyzeTextWithWllama(combined, onChunk);
}

// ============================================
// Result Parsing & Rendering
// ============================================

function parseResults(text) {
  try {
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    // parse failed
  }
  return null;
}

function formatValue(val) {
  if (val == null || val === 'null' || val === 'N/A') return null;
  if (Array.isArray(val)) {
    if (!val.length) return null;
    // Array of objects (e.g. line items) → key-value list
    if (typeof val[0] === 'object') {
      return '<div class="key-fields-list">' + val.map((item) => {
        const parts = Object.entries(item)
          .map(([k, v]) => `<span class="kf-label">${escapeHtml(k)}:</span> <span class="kf-value">${escapeHtml(String(v))}</span>`)
          .join(' ');
        return `<div class="key-field-item">${parts}</div>`;
      }).join('') + '</div>';
    }
    // Simple array → comma-separated
    return escapeHtml(val.join(', '));
  }
  if (typeof val === 'object') {
    return '<div class="key-fields-list">' + Object.entries(val)
      .map(([k, v]) => `<div class="key-field-item"><span class="kf-label">${escapeHtml(k)}:</span> <span class="kf-value">${escapeHtml(String(v))}</span></div>`)
      .join('') + '</div>';
  }
  return escapeHtml(String(val));
}

function renderResults(data, elapsed) {
  resultGrid.innerHTML = '';
  const elapsedEl = document.getElementById('elapsedTime');
  if (elapsedEl) elapsedEl.textContent = elapsed ? `${elapsed}` : '';

  if (!data) {
    resultGrid.innerHTML = `<div class="result-card">
      <div class="label">Result</div>
      <div class="value">Could not parse a structured response. Check the raw output below.</div>
    </div>`;
    resultsArea.hidden = false;
    return;
  }

  let isFirst = true;
  for (const [key, val] of Object.entries(data)) {
    const html = formatValue(val);
    if (!html) continue;

    const card = document.createElement('div');
    card.className = `result-card${isFirst ? ' type-card' : ''}`;
    card.innerHTML = `<div class="label">${escapeHtml(key)}</div><div class="value">${html}</div>`;
    resultGrid.appendChild(card);
    isFirst = false;
  }

  resultsArea.hidden = false;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ============================================
// UI Helpers
// ============================================

function setStatus(msg) {
  statusArea.hidden = false;
  statusText.textContent = msg;
}

function hideStatus() {
  statusArea.hidden = true;
}

function showProgress(show) {
  progressBar.hidden = !show;
}

function setProgress(pct) {
  progressFill.style.width = `${pct}%`;
}

function showError(msg) {
  hideStatus();
  resultGrid.innerHTML = `<div class="result-card" style="border-left:3px solid var(--error)">
    <div class="label">Error</div>
    <div class="value" style="color:var(--error)">${escapeHtml(msg)}</div>
  </div>`;
  resultsArea.hidden = false;
}

function resetUI() {
  uploadSection.hidden = false;
  pageSection.hidden = true;
  configSection.hidden = true;
  statusArea.hidden = true;
  resultsArea.hidden = true;
  resultGrid.innerHTML = '';
  rawResponse.textContent = '';
  pageThumbnails.innerHTML = '';
  fileInput.value = '';
  pdfDoc = null;
  pdfTotalPages = 0;
  selectedPages.clear();
}

// ============================================
// Page Thumbnails
// ============================================

async function showPageSelector(doc) {
  pdfTotalPages = doc.numPages;
  pageCount.textContent = `${pdfTotalPages} page${pdfTotalPages > 1 ? 's' : ''}`;

  // Default selection: first 5 or all if fewer
  const defaultMax = Math.min(pdfTotalPages, 5);
  selectedPages.clear();
  for (let i = 1; i <= defaultMax; i++) selectedPages.add(i);
  pageRange.value = pagesToRangeString([...selectedPages]);

  // Render thumbnails
  pageThumbnails.innerHTML = '';
  const thumbCount = Math.min(pdfTotalPages, CONFIG.maxThumbPages);

  for (let i = 1; i <= thumbCount; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = `page-thumb${selectedPages.has(i) ? ' selected' : ''}`;
    wrapper.dataset.page = i;

    const canvas = await renderPageToCanvas(doc, i, CONFIG.thumbScale);
    wrapper.appendChild(canvas);

    const label = document.createElement('div');
    label.className = 'page-num';
    label.textContent = i;
    wrapper.appendChild(label);

    wrapper.addEventListener('click', () => togglePageThumb(wrapper, i));
    pageThumbnails.appendChild(wrapper);
  }

  if (pdfTotalPages > CONFIG.maxThumbPages) {
    const more = document.createElement('div');
    more.className = 'page-thumb';
    more.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--gray-400)';
    more.textContent = `+${pdfTotalPages - CONFIG.maxThumbPages} more`;
    pageThumbnails.appendChild(more);
  }

  pageSection.hidden = false;
  configSection.hidden = false;
}

function togglePageThumb(el, pageNum) {
  if (selectedPages.has(pageNum)) {
    selectedPages.delete(pageNum);
    el.classList.remove('selected');
  } else {
    selectedPages.add(pageNum);
    el.classList.add('selected');
  }
  pageRange.value = pagesToRangeString([...selectedPages]);
}

function syncThumbsFromInput() {
  const pages = parsePageRange(pageRange.value, pdfTotalPages);
  selectedPages = new Set(pages);
  for (const thumb of pageThumbnails.querySelectorAll('.page-thumb[data-page]')) {
    const p = Number(thumb.dataset.page);
    thumb.classList.toggle('selected', selectedPages.has(p));
  }
}

// ============================================
// Main Analysis Flow
// ============================================

async function runAnalysis() {
  const pages = [...selectedPages].sort((a, b) => a - b);
  if (!pages.length) {
    showError('Please select at least one page.');
    return;
  }
  const engine = getSelectedEngine();
  if (!engine) {
    showError('Please select an AI engine.');
    return;
  }

  pageSection.hidden = true;
  configSection.hidden = true;
  uploadSection.hidden = true;
  timerReset();
  setStatus('Preparing document...');

  try {
    const onChunk = (text) => { rawResponse.textContent = text; };
    let result;

    switch (engine) {
      case 'prompt-api-multimodal':
        result = await analyzePromptAPIMultimodal(pages, onChunk);
        break;
      case 'prompt-api-text':
        result = await analyzePromptAPIText(pages, onChunk);
        break;
      case 'florence-wllama':
        result = await analyzeFlorenceWllama(pages, onChunk);
        break;
      case 'tesseract-wllama':
        result = await analyzeTesseractWllama(pages, onChunk);
        break;
    }

    hideStatus();
    const elapsed = formatElapsed(timerElapsed());
    const parsed = parseResults(result);
    renderResults(parsed, elapsed);
    rawResponse.textContent = result;
  } catch (err) {
    console.error(err);
    showError(err.message || 'Analysis failed.');
  }
}

// ============================================
// Event Handlers
// ============================================

async function onFileSelected(file) {
  if (!file || file.type !== 'application/pdf') {
    showError('Please upload a PDF file.');
    return;
  }

  uploadSection.hidden = true;
  setStatus('Loading PDF...');

  try {
    pdfDoc = await loadPdf(file);
    hideStatus();
    await showPageSelector(pdfDoc);
  } catch (err) {
    console.error(err);
    showError('Failed to load PDF: ' + err.message);
  }
}

function setupEvents() {
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) onFileSelected(fileInput.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) onFileSelected(e.dataTransfer.files[0]);
  });

  pageRange.addEventListener('input', () => syncThumbsFromInput());

  addFieldBtn.addEventListener('click', () => {
    const input = addFieldRow();
    input.focus();
  });

  analyzeBtn.addEventListener('click', () => runAnalysis());

  resetBtn.addEventListener('click', () => resetUI());

  chromeFlagsBtn.addEventListener('click', () => {
    const showing = !chromeFlagsInfo.hidden;
    chromeFlagsInfo.hidden = showing;
    chromeFlagsBtn.textContent = showing
      ? 'How to enable Gemini Nano in Chrome'
      : 'Hide Chrome setup instructions';
  });
}

// ============================================
// Init
// ============================================

async function init() {
  setupEvents();
  initFieldRows();
  const availability = await detectAllEngines();
  renderEngineSelector(availability);
}

init();
