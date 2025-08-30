// // panel.js（Markdown最適化 + ページ文脈添付 + ストリーミング）

// const chatEl   = document.getElementById('chat');
// const inputEl  = document.getElementById('input');
// const sendBtn  = document.getElementById('send');
// const statusEl = document.getElementById('status');
// const attachEl = document.getElementById('attach');

// const DEBUG = false;
// function d(...a){ if (DEBUG) console.log('[PANEL]', ...a); }

// let messages = []; // {role:'user'|'assistant', content:string}

// //
// // ==== Marked 設定（tight list で余白とネストを最小化） ====
// if (window.marked) {
//   const renderer = new marked.Renderer();
//   renderer.listitem = (text, task, checked) => {
//     if (text.startsWith('<p>') && text.endsWith('</p>')) text = text.slice(3, -4);
//     return `<li>${text}</li>`;
//   };
//   renderer.paragraph = (text) => `<p>${text}</p>`;
//   marked.use({ renderer, gfm: true, breaks: true, smartLists: true });
// }

// // 余計な <p> / 分割UL/OL を軽く正規化
// function tightenLists(html) {
//   return html
//     .replace(/<li>\s*<p>/g, '<li>')
//     .replace(/<\/p>\s*<\/li>/g, '</li>')
//     .replace(/<\/p>\s*<(ul|ol)>/g, '<$1>')
//     .replace(/<p>\s*<\/p>/g, '')
//     .replace(/<\/ul>\s*<ul>/g, '')
//     .replace(/<\/ol>\s*<ol>/g, '');
// }

// // Markdown → HTML（サニタイズ）
// function mdToHtml(md) {
//   try {
//     const raw = window.marked ? marked.parse(md) : escapeHtml(md);
//     const tightened = tightenLists(raw);
//     return window.DOMPurify ? DOMPurify.sanitize(tightened) : tightened;
//   } catch { return escapeHtml(md); }
// }
// function escapeHtml(s){
//   return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// }

// (async () => {
//   const { history } = await chrome.storage.local.get(['history']);
//   if (Array.isArray(history)) { messages = history; render(); scrollEnd(); }
//   d('init historyLen=', messages.length);
// })();

// sendBtn.addEventListener('click', () => onSend());
// inputEl.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend(); });
// chrome.runtime.onMessage.addListener((msg) => {
//   if (msg?.type === 'ASK_FROM_CONTEXT' && msg.text) { inputEl.value = msg.text; onSend(); }
// });

// async function onSend() {
//   const text = inputEl.value.trim();
//   if (!text) { status('テキストがありません'); return; }
//   inputEl.value = '';

//   // 1) ユーザー発話を履歴へ
//   messages.push({ role: 'user', content: text });
//   render(); scrollEnd();
//   await chrome.storage.local.set({ history: messages });

//   // 2) 送信用履歴（空assistantは除く）
//   let historyForSend = messages.map(m => ({ role: m.role, content: m.content }));

//   // 3) ページ文脈を付与
//   if (attachEl.checked) {
//     try {
//       const pageCtx = await getActivePageContext();
//       d('pageCtx', pageCtx && { url: pageCtx.url, textLen: pageCtx.text?.length||0, selLen: pageCtx.selection?.length||0, reason: pageCtx.reason });
//       if (pageCtx?.text) {
//         const block =
// `[PAGE_CONTEXT]
// URL: ${pageCtx.url}
// TITLE: ${pageCtx.title}
// DESCRIPTION: ${pageCtx.desc || '(なし)'}
// SELECTION:
// ${pageCtx.selection || '(なし)'}
// BODY_EXCERPT:
// ${pageCtx.text}
// [/PAGE_CONTEXT]`;
//         const prior = historyForSend.slice(0, -1);
//         const lastQ = historyForSend[historyForSend.length - 1];
//         historyForSend = [
//           ...prior,
//           { role: 'user', content: `上の[PAGE_CONTEXT]は現在のタブから抽出した内容です。続く質問に日本語で答えてください。\n${block}` },
//           lastQ
//         ];
//       } else if (pageCtx?.reason) {
//         status(pageCtx.reason); // chrome:// 等
//       }
//     } catch (e) {
//       status('ページ内容の取得に失敗: ' + (e?.message || String(e)));
//     }
//   }

//   // 4) 表示用の空assistant
//   messages.push({ role: 'assistant', content: '' });
//   render(); scrollEnd();
//   await chrome.storage.local.set({ history: messages });
//   const idx = messages.length - 1;

//   // 5) ストリーム開始
//   const port = chrome.runtime.connect({ name: 'ollama-stream' });
//   busy(true);
//   port.onMessage.addListener(msg => {
//     if (msg.type === 'CHUNK') {
//       messages[idx].content += msg.data;
//       updateLast(messages[idx].content);
//     } else if (msg.type === 'ERROR') {
//       busy(false);
//       messages[idx].content = 'エラー: ' + msg.message;
//       render(); scrollEnd(); port.disconnect();
//     } else if (msg.type === 'DONE') {
//       busy(false);
//       chrome.storage.local.set({ history: messages });
//       port.disconnect();
//     }
//   });

//   // 6) 送信
//   port.postMessage({
//     type: 'CALL_LOCAL_STREAM',
//     model: 'gpt-oss:20b',
//     messages: historyForSend
//   });
// }

// /** 現在のタブから本文・選択テキストなどを抽出 */
// async function getActivePageContext() {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   if (!tab) return null;
//   const url = tab.url || '';
//   if (!/^https?:/i.test(url)) return { reason: 'このページのDOMは取得できません（chrome:// 等）' };

//   const [{ result }] = await chrome.scripting.executeScript({
//     target: { tabId: tab.id },
//     func: () => {
//       try {
//         const sel = (window.getSelection && window.getSelection().toString()) || '';
//         const title = document.title || '';
//         const desc = document.querySelector('meta[name="description"]')?.content || '';
//         const root = document.querySelector('article, main, [role="main"], #content') || document.body;

//         const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
//           acceptNode(node) {
//             const v = node.nodeValue;
//             if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
//             const el = node.parentElement;
//             if (!el) return NodeFilter.FILTER_REJECT;
//             const cs = getComputedStyle(el);
//             if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
//             return NodeFilter.FILTER_ACCEPT;
//           }
//         });

//         let text = '';
//         while (walker.nextNode() && text.length < 20000) {
//           const t = walker.currentNode.nodeValue.replace(/\s+/g, ' ').trim();
//           if (t) text += t + ' ';
//         }

//         return {
//           url: location.href,
//           title,
//           desc,
//           selection: sel.slice(0, 4000),
//           text: text.slice(0, 8000)
//         };
//       } catch (e) {
//         return { error: String(e) };
//       }
//     }
//   });

//   if (result?.error) throw new Error(result.error);
//   return result;
// }

// /* ===== 描画系 ===== */
// function updateLast(text) {
//   const last = chatEl.lastElementChild;
//   if (last) last.innerHTML = mdToHtml(text);
//   scrollEnd();
// }
// function render() {
//   chatEl.innerHTML = '';
//   for (const m of messages) {
//     const div = document.createElement('div');
//     div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
//     div.innerHTML = mdToHtml(m.content);
//     chatEl.appendChild(div);
//   }
// }
// function scrollEnd(){ chatEl.scrollTop = chatEl.scrollHeight; }
// function busy(b){ sendBtn.disabled = b; statusEl.textContent = b ? '生成中…' : ''; }
// function status(s){ statusEl.textContent = s; if (s) setTimeout(()=>statusEl.textContent='',3000); }



// panel.js（Markdown最適化 + ページ文脈添付 + ストリーミング + [object Object]対策）

const chatEl   = document.getElementById('chat');
const inputEl  = document.getElementById('input');
const sendBtn  = document.getElementById('send');
const statusEl = document.getElementById('status');
const attachEl = document.getElementById('attach');

const DEBUG = false;
function d(...a){ if (DEBUG) console.log('[PANEL]', ...a); }

let messages = []; // {role:'user'|'assistant', content:string}

/* ========== Marked 設定（tight list） ========== */
if (window.marked) {
  const renderer = new marked.Renderer();
  renderer.listitem = (text) => {
    if (text.startsWith('<p>') && text.endsWith('</p>')) text = text.slice(3, -4);
    return `<li>${text}</li>`;
  };
  renderer.paragraph = (text) => `<p>${text}</p>`;
  marked.use({ renderer, gfm: true, breaks: true, smartLists: true });
}

/* 余計な<p>/分割UL/OLを軽く正規化 */
function tightenLists(html) {
  return html
    .replace(/<li>\s*<p>/g, '<li>')
    .replace(/<\/p>\s*<\/li>/g, '</li>')
    .replace(/<\/p>\s*<(ul|ol)>/g, '<$1>')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/<\/ol>\s*<ol>/g, '');
}

/* Markdown → HTML（サニタイズ） */
function mdToHtml(md) {
  try {
    const raw = window.marked ? marked.parse(md) : escapeHtml(md);
    const tightened = tightenLists(raw);
    return window.DOMPurify ? DOMPurify.sanitize(tightened) : tightened;
  } catch { return escapeHtml(md); }
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* どんな入力でも確実に文字列化（[object Object]対策） */
function toText(x){
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
  return String(x);
}

(async () => {
  const { history } = await chrome.storage.local.get(['history']);
  if (Array.isArray(history)) { messages = history; render(); scrollEnd(); }
  d('init historyLen=', messages.length);
})();

sendBtn.addEventListener('click', () => onSend());
inputEl.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend(); });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'ASK_FROM_CONTEXT' && msg.text) { inputEl.value = msg.text; onSend(); }
});

async function onSend() {
  const text = inputEl.value.trim();
  if (!text) { status('テキストがありません'); return; }
  inputEl.value = '';

  // 1) ユーザー発話を履歴へ
  messages.push({ role: 'user', content: text });
  render(); scrollEnd();
  await chrome.storage.local.set({ history: messages });

  // 2) 送信用履歴（空assistantは除く）
  let historyForSend = messages.map(m => ({ role: m.role, content: m.content }));

  // 3) ページ文脈を付与
  if (attachEl.checked) {
    try {
      const pageCtx = await getActivePageContext();
      d('pageCtx', pageCtx && { url: pageCtx.url, textLen: pageCtx.text?.length||0, selLen: pageCtx.selection?.length||0, reason: pageCtx.reason });
      if (pageCtx?.text) {
        const block =
`[PAGE_CONTEXT]
URL: ${pageCtx.url}
TITLE: ${pageCtx.title}
DESCRIPTION: ${pageCtx.desc || '(なし)'}
SELECTION:
${pageCtx.selection || '(なし)'}
BODY_EXCERPT:
${pageCtx.text}
[/PAGE_CONTEXT]`;
        const prior = historyForSend.slice(0, -1);
        const lastQ = historyForSend[historyForSend.length - 1];
        historyForSend = [
          ...prior,
          { role: 'user', content: `上の[PAGE_CONTEXT]は現在のタブから抽出した内容です。続く質問に日本語で答えてください。\n${block}` },
          lastQ
        ];
      } else if (pageCtx?.reason) {
        status(pageCtx.reason); // chrome:// 等
      }
    } catch (e) {
      status('ページ内容の取得に失敗: ' + (e?.message || String(e)));
    }
  }

  // 4) 表示用の空assistant
  messages.push({ role: 'assistant', content: '' });
  render(); scrollEnd();
  await chrome.storage.local.set({ history: messages });
  const idx = messages.length - 1;

  // 5) ストリーム開始
  const port = chrome.runtime.connect({ name: 'ollama-stream' });
  busy(true);
  port.onMessage.addListener(msg => {
    if (msg.type === 'CHUNK') {
      messages[idx].content += toText(msg.data);   // ← 常に文字列化
      updateLast(messages[idx].content);
    } else if (msg.type === 'ERROR') {
      busy(false);
      messages[idx].content = 'エラー: ' + toText(msg.message); // ← 文字列化
      render(); scrollEnd(); port.disconnect();
    } else if (msg.type === 'DONE') {
      busy(false);
      chrome.storage.local.set({ history: messages });
      port.disconnect();
    }
  });

  // 6) 送信
  port.postMessage({
    type: 'CALL_LOCAL_STREAM',
    model: 'gpt-oss:20b',
    messages: historyForSend
  });
}

/** 現在のタブから本文・選択テキストなどを抽出 */
async function getActivePageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  const url = tab.url || '';
  if (!/^https?:/i.test(url)) return { reason: 'このページのDOMは取得できません（chrome:// 等）' };

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      try {
        const sel = (window.getSelection && window.getSelection().toString()) || '';
        const title = document.title || '';
        const desc = document.querySelector('meta[name="description"]')?.content || '';
        const root = document.querySelector('article, main, [role="main"], #content') || document.body;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const v = node.nodeValue;
            if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
            const el = node.parentElement;
            if (!el) return NodeFilter.FILTER_REJECT;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        let text = '';
        while (walker.nextNode() && text.length < 20000) {
          const t = walker.currentNode.nodeValue.replace(/\s+/g, ' ').trim();
          if (t) text += t + ' ';
        }

        return {
          url: location.href,
          title,
          desc,
          selection: sel.slice(0, 4000),
          text: text.slice(0, 8000)
        };
      } catch (e) {
        return { error: String(e) };
      }
    }
  });

  if (result?.error) throw new Error(result.error);
  return result;
}

/* ========== 描画系 ========== */
function updateLast(text) {
  const last = chatEl.lastElementChild;
  if (last) last.innerHTML = mdToHtml(text);
  scrollEnd();
}
function render() {
  chatEl.innerHTML = '';
  for (const m of messages) {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    // ★修正箇所：m.content（文字列）を渡す
    div.innerHTML = mdToHtml(m.content); 
    chatEl.appendChild(div);
  }
}
function render() {
    chatEl.innerHTML = '';
    for (const m of messages) {
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
      // ★修正箇所：m.content（文字列）を渡す
      div.innerHTML = mdToHtml(m.content); 
      chatEl.appendChild(div);
    }
  }
function scrollEnd(){ chatEl.scrollTop = chatEl.scrollHeight; }
function busy(b){ sendBtn.disabled = b; statusEl.textContent = b ? '生成中…' : ''; }
function status(s){ statusEl.textContent = s; if (s) setTimeout(()=>statusEl.textContent='',3000); }





// panel.js（[object Object]対策を徹底・全文そのまま置き換え）

// const chatEl   = document.getElementById('chat');
// const inputEl  = document.getElementById('input');
// const sendBtn  = document.getElementById('send');
// const statusEl = document.getElementById('status');
// const attachEl = document.getElementById('attach');

// const DEBUG = false;
// function d(...a){ if (DEBUG) console.log('[PANEL]', ...a); }

// /* どんな値でも確実に「表示用の文字列」にする */
// function toText(x){
//   if (x == null) return '';
//   if (typeof x === 'string') return x;
//   if (typeof x === 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
//   return String(x);
// }

// let messages = []; // {role:'user'|'assistant', content:string}

// /* ========== Marked（tight list） ========== */
// if (window.marked) {
//   const renderer = new marked.Renderer();
//   renderer.listitem = (text) => {
//     if (text.startsWith('<p>') && text.endsWith('</p>')) text = text.slice(3, -4);
//     return `<li>${text}</li>`;
//   };
//   renderer.paragraph = (text) => `<p>${text}</p>`;
//   marked.use({ renderer, gfm: true, breaks: true, smartLists: true });
// }

// /* 余計な<p>/分割UL/OLを軽く正規化 */
// function tightenLists(html) {
//   return html
//     .replace(/<li>\s*<p>/g, '<li>')
//     .replace(/<\/p>\s*<\/li>/g, '</li>')
//     .replace(/<\/p>\s*<(ul|ol)>/g, '<$1>')
//     .replace(/<p>\s*<\/p>/g, '')
//     .replace(/<\/ul>\s*<ul>/g, '')
//     .replace(/<\/ol>\s*<ol>/g, '');
// }

// /* Markdown → HTML（常に文字列化してから処理） */
// function mdToHtml(md) {
//   try {
//     const mdStr = toText(md);                                // ★ここで強制的に文字列へ
//     const raw = window.marked ? marked.parse(mdStr) : escapeHtml(mdStr);
//     const tightened = tightenLists(raw);
//     return window.DOMPurify ? DOMPurify.sanitize(tightened) : tightened;
//   } catch { return escapeHtml(toText(md)); }
// }
// function escapeHtml(s){
//   return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// }

// /* 初期化 */
// (async () => {
//   const { history } = await chrome.storage.local.get(['history']);
//   if (Array.isArray(history)) { messages = history; render(); scrollEnd(); }
//   d('init historyLen=', messages.length);
// })();

// /* 送信 */
// sendBtn.addEventListener('click', () => onSend());
// inputEl.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend(); });
// chrome.runtime.onMessage.addListener((msg) => {
//   if (msg?.type === 'ASK_FROM_CONTEXT' && msg.text) { inputEl.value = toText(msg.text); onSend(); }
// });

// async function onSend() {
//   const text = toText(inputEl.value).trim();                 // ★文字列化
//   if (!text) { status('テキストがありません'); return; }
//   inputEl.value = '';

//   // 1) ユーザー発話を履歴へ
//   messages.push({ role: 'user', content: text });
//   render(); scrollEnd();
//   await chrome.storage.local.set({ history: messages });

//   // 2) 送信用履歴（空assistantは除く・必ず文字列化）
//   let historyForSend = messages.map(m => ({ role: m.role, content: toText(m.content) }));

//   // 3) ページ文脈を付与
//   if (attachEl.checked) {
//     try {
//       const pageCtx = await getActivePageContext();
//       d('pageCtx', pageCtx && { url: pageCtx.url, textLen: pageCtx.text?.length||0, selLen: pageCtx.selection?.length||0, reason: pageCtx.reason });
//       if (pageCtx?.text) {
//         const block =
// `[PAGE_CONTEXT]
// URL: ${pageCtx.url}
// TITLE: ${toText(pageCtx.title)}
// DESCRIPTION: ${toText(pageCtx.desc) || '(なし)'}
// SELECTION:
// ${toText(pageCtx.selection) || '(なし)'}
// BODY_EXCERPT:
// ${toText(pageCtx.text)}
// [/PAGE_CONTEXT]`;
//         const prior = historyForSend.slice(0, -1);
//         const lastQ = historyForSend[historyForSend.length - 1];
//         historyForSend = [
//           ...prior,
//           { role: 'user', content: `上の[PAGE_CONTEXT]は現在のタブから抽出した内容です。続く質問に日本語で答えてください。\n${block}` },
//           lastQ
//         ];
//       } else if (pageCtx?.reason) {
//         status(pageCtx.reason); // chrome:// 等
//       }
//     } catch (e) {
//       status('ページ内容の取得に失敗: ' + toText(e?.message || e));
//     }
//   }

//   // 4) 表示用の空assistant
//   messages.push({ role: 'assistant', content: '' });
//   render(); scrollEnd();
//   await chrome.storage.local.set({ history: messages });
//   const idx = messages.length - 1;

//   // 5) ストリーム開始
//   const port = chrome.runtime.connect({ name: 'ollama-stream' });
//   busy(true);
//   port.onMessage.addListener(msg => {
//     if (msg.type === 'CHUNK') {
//       messages[idx].content += toText(msg.data);            // ★常に文字列化
//       updateLast(messages[idx].content);
//     } else if (msg.type === 'ERROR') {
//       busy(false);
//       messages[idx].content = 'エラー: ' + toText(msg.message);
//       render(); scrollEnd(); port.disconnect();
//     } else if (msg.type === 'DONE') {
//       busy(false);
//       chrome.storage.local.set({ history: messages });
//       port.disconnect();
//     }
//   });

//   // 6) 送信
//   port.postMessage({
//     type: 'CALL_LOCAL_STREAM',
//     model: 'gpt-oss:20b',
//     messages: historyForSend
//   });
// }

// /** 現在のタブから本文・選択テキストなどを抽出 */
// async function getActivePageContext() {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   if (!tab) return null;
//   const url = tab.url || '';
//   if (!/^https?:/i.test(url)) return { reason: 'このページのDOMは取得できません（chrome:// 等）' };

//   const [{ result }] = await chrome.scripting.executeScript({
//     target: { tabId: tab.id },
//     func: () => {
//       try {
//         const sel = (window.getSelection && window.getSelection().toString()) || '';
//         const title = document.title || '';
//         const desc = document.querySelector('meta[name="description"]')?.content || '';
//         const root = document.querySelector('article, main, [role="main"], #content') || document.body;

//         const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
//           acceptNode(node) {
//             const v = node.nodeValue;
//             if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
//             const el = node.parentElement;
//             if (!el) return NodeFilter.FILTER_REJECT;
//             const cs = getComputedStyle(el);
//             if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
//             return NodeFilter.FILTER_ACCEPT;
//           }
//         });

//         let text = '';
//         while (walker.nextNode() && text.length < 20000) {
//           const t = walker.currentNode.nodeValue.replace(/\s+/g, ' ').trim();
//           if (t) text += t + ' ';
//         }

//         return {
//           url: location.href,
//           title,
//           desc,
//           selection: sel.slice(0, 4000),
//           text: text.slice(0, 8000)
//         };
//       } catch (e) {
//         return { error: String(e) };
//       }
//     }
//   });

//   if (result?.error) throw new Error(result.error);
//   return result;
// }

// /* ========== 描画系 ========== */
// function updateLast(text) {
//   const last = chatEl.lastElementChild;
//   if (last) last.innerHTML = mdToHtml(text);   // mdToHtml内でtoText済み
//   scrollEnd();
// }
// function render() {
//   chatEl.innerHTML = '';
//   for (const m of messages) {
//     const div = document.createElement('div');
//     div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
//     div.innerHTML = mdToHtml(m.content);       // mdToHtml内でtoText済み
//     chatEl.appendChild(div);
//   }
// }
// function scrollEnd(){ chatEl.scrollTop = chatEl.scrollHeight; }
// function busy(b){ sendBtn.disabled = b; statusEl.textContent = b ? '生成中…' : ''; }
// function status(s){ statusEl.textContent = toText(s); if (s) setTimeout(()=>statusEl.textContent='',3000); }
