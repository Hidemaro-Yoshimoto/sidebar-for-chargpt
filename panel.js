const chatEl   = document.getElementById('chat');
const inputEl  = document.getElementById('input');
const sendBtn  = document.getElementById('send');
const statusEl = document.getElementById('status');
const attachEl = document.getElementById('attach');

let messages = []; // {role:'user'|'assistant', content:string}

(async () => {
  const { history } = await chrome.storage.local.get(['history']);
  if (Array.isArray(history)) { messages = history; render(); scrollEnd(); }
})();

sendBtn.addEventListener('click', () => onSend());
inputEl.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend();
});

async function onSend() {
  const text = inputEl.value.trim();
  if (!text) { status('テキストがありません'); return; }
  inputEl.value = '';

  // 1) userを履歴に追加（ここまでを送信対象）
  messages.push({ role: 'user', content: text });
  render(); scrollEnd();
  await chrome.storage.local.set({ history: messages });

  // 2) 送信用履歴を作成（空assistantは含めない）
  let historyForSend = messages.map(m => ({ role: m.role, content: m.content }));

  // 3) ページ内容を取得して差し込む（内部ページは自動でスキップ）
  if (attachEl.checked) {
    try {
      const pageCtx = await getActivePageContext();
      if (pageCtx && pageCtx.text) {
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
        // 最新のユーザー発話の直前に文脈を挿入
        const prior = historyForSend.slice(0, -1);
        const lastQ = historyForSend[historyForSend.length - 1];
        historyForSend = [
          ...prior,
          { role: 'user',
            content: `上の[PAGE_CONTEXT]は現在のタブから抽出した内容です。必ずこれを前提に、続く質問に日本語で答えてください。\n${block}` },
          lastQ
        ];
      } else if (pageCtx && pageCtx.reason) {
        status(pageCtx.reason); // chrome:// 等
      }
    } catch (e) {
      status('ページ内容の取得に失敗: ' + String(e));
    }
  }

  // 4) 表示用に空assistantバブルを作成（送信には含めない）
  messages.push({ role: 'assistant', content: '' });
  render(); scrollEnd();
  await chrome.storage.local.set({ history: messages });
  const idx = messages.length - 1;

  // 5) ストリーム開始
  const port = chrome.runtime.connect({ name: 'ollama-stream' });
  busy(true);
  port.onMessage.addListener(msg => {
    if (msg.type === 'CHUNK') {
      messages[idx].content += msg.data;
      const last = chatEl.lastElementChild;
      if (last) last.textContent = messages[idx].content;
      scrollEnd();
    } else if (msg.type === 'ERROR') {
      busy(false);
      messages[idx].content = 'エラー: ' + msg.message;
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
    model: 'gpt-oss:20b', // 必要に変更
    messages: historyForSend
  });
}

/** 現在のタブから本文・選択テキストなどを抽出（activeTab + scripting で注入） */
async function getActivePageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;

  // chrome:// や拡張ページ・WebStore等は注入不可 → 理由つきで返す
  const url = tab.url || '';
  if (!/^https?:/i.test(url)) {
    return { reason: 'このページのDOMは取得できません（chrome:// 等）' };
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const sel = (window.getSelection && window.getSelection().toString()) || '';
      const title = document.title || '';
      const desc = document.querySelector('meta[name="description"]')?.content || '';

      // 可視テキスト抽出（簡易）
      const root =
        document.querySelector('article, main, [role="main"], #content') || document.body;

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
        text: text.slice(0, 8000) // 上限
      };
    }
  });

  return result;
}

function render() {
  chatEl.innerHTML = '';
  for (const m of messages) {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    div.textContent = m.content;
    chatEl.appendChild(div);
  }
}

function scrollEnd() { chatEl.scrollTop = chatEl.scrollHeight; }
function busy(b) { sendBtn.disabled = b; statusEl.textContent = b ? '生成中…' : ''; }
function status(s) { statusEl.textContent = s; if (s) setTimeout(()=>statusEl.textContent='',1500); }

// 右クリック経由
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'ASK_FROM_CONTEXT' && msg.text) {
    inputEl.value = msg.text;
    onSend();
  }
});
