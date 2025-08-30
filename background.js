// function d(...a){ console.log('[BG]', ...a); }

// // ストリーミング本体：Ollama NDJSON
// chrome.runtime.onConnect.addListener(port => {
//   if (port.name !== 'ollama-stream') return;
//   d('onConnect:', port.name);

//   port.onMessage.addListener(async (msg) => {
//     if (msg.type !== 'CALL_LOCAL_STREAM') return;
//     d('CALL_LOCAL_STREAM: model=', msg.model, 'messages=', (msg.messages||[]).length);

//     try {
//       d('fetch POST /api/chat begin');
//       const res = await fetch('http://localhost:11434/api/chat', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           model: msg.model || 'gpt-oss:20b',
//           messages: (msg.messages || []).map(m => ({ role: m.role, content: m.content })),
//           stream: true,
//           options: { num_ctx: 4096 }
//         })
//       });

//       d('fetch response status=', res.status);
//       if (!res.ok) {
//         let body = '';
//         try { body = await res.text(); } catch {}
//         const err = `Ollama ${res.status} ${body ? ' body='+body.slice(0,200) : ''}`;
//         d('!ok ->', err);
//         port.postMessage({ type: 'ERROR', message: err });
//         return;
//       }
//       if (!res.body) { d('no ReadableStream'); port.postMessage({ type:'ERROR', message:'ReadableStreamなし' }); return; }

//       const reader = res.body.getReader();
//       const dec = new TextDecoder();
//       let buf = '';
//       let lines = 0, chunks = 0;

//       while (true) {
//         const { value, done } = await reader.read();
//         if (done) break;
//         buf += dec.decode(value, { stream: true });

//         let idx;
//         while ((idx = buf.indexOf('\n')) >= 0) {
//           const line = buf.slice(0, idx).trim();
//           buf = buf.slice(idx + 1);
//           if (!line) continue;
//           lines++;
//           try {
//             const j = JSON.parse(line);

//             if (j?.error) {
//               d('NDJSON error:', j.error);
//               port.postMessage({ type: 'ERROR', message: j.error });
//               return;
//             }

//             const chunk = j?.message?.content || j?.response || '';
//             if (chunk) {
//               chunks++;
//               if (chunks <= 3 || chunks % 50 === 0) d('chunk#', chunks, 'len=', chunk.length);
//               port.postMessage({ type: 'CHUNK', data: chunk });
//             }
//             if (j?.done) { d('done=true after lines=', lines, 'chunks=', chunks); port.postMessage({ type:'DONE' }); return; }
//           } catch (e) {
//             d('JSON.parse error on line:', line.slice(0,120), '...', String(e));
//           }
//         }
//       }
//       d('stream end naturally. lines=', lines, 'chunks=', chunks);
//       port.postMessage({ type: 'DONE' });
//     } catch (e) {
//       const msgStr = e?.message || String(e);
//       d('catch ERROR:', msgStr);
//       try { port.postMessage({ type: 'ERROR', message: msgStr }); } catch {}
//     }
//   });
// });

// // 右クリック→サイドパネル
// chrome.runtime.onInstalled.addListener(() => {
//   chrome.contextMenus.create({
//     id: 'ask-local',
//     title: 'サイドバー(20B)で質問',
//     contexts: ['selection']
//   });
// });
// chrome.contextMenus.onClicked.addListener(async (info, tab) => {
//   if (info.menuItemId === 'ask-local' && info.selectionText) {
//     if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
//     chrome.runtime.sendMessage({ type: 'ASK_FROM_CONTEXT', text: info.selectionText });
//   }
// });

// // ショートカット・アイコンで開く
// chrome.action?.onClicked.addListener(async (tab) => {
//   if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
// });
// chrome.commands?.onCommand.addListener(async (cmd) => {
//   if (cmd === 'open-sidebar') {
//     const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//     if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
//   }
// });


// // background.js（全置換してOK）
// // Ollama NDJSONを安全に文字列化して転送

// chrome.runtime.onConnect.addListener(port => {
//     if (port.name !== 'ollama-stream') return;
  
//     port.onMessage.addListener(async (msg) => {
//       if (msg.type !== 'CALL_LOCAL_STREAM') return;
//       try {
//         const res = await fetch('http://localhost:11434/api/chat', {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({
//             model: msg.model || 'gpt-oss:20b',
//             messages: (msg.messages || []).map(m => ({ role: m.role, content: m.content })),
//             stream: true,
//             options: { num_ctx: 4096 }
//           })
//         });
//         if (!res.ok) { port.postMessage({ type: 'ERROR', message: `Ollama ${res.status}` }); return; }
//         if (!res.body) { port.postMessage({ type: 'ERROR', message: 'ReadableStreamなし' }); return; }
  
//         const reader = res.body.getReader();
//         const dec = new TextDecoder();
//         let buf = '';
  
//         while (true) {
//           const { value, done } = await reader.read();
//           if (done) break;
//           buf += dec.decode(value, { stream: true });
  
//           let idx;
//           while ((idx = buf.indexOf('\n')) >= 0) {
//             const line = buf.slice(0, idx).trim();
//             buf = buf.slice(idx + 1);
//             if (!line) continue;
  
//             try {
//               const j = JSON.parse(line);
  
//               if (j?.error) { port.postMessage({ type: 'ERROR', message: String(j.error) }); return; }
  
//               // 文字列だけを取り出す（objectは無視）
//               let chunk = '';
//               if (typeof j?.message?.content === 'string') chunk = j.message.content;
//               else if (typeof j?.response === 'string') chunk = j.response;
//               else if (typeof j?.delta === 'string') chunk = j.delta;
//               else if (typeof j?.delta?.content === 'string') chunk = j.delta.content;
  
//               if (chunk) port.postMessage({ type: 'CHUNK', data: String(chunk) });
//               if (j?.done) { port.postMessage({ type: 'DONE' }); return; }
//             } catch {
//               // パースできない断片は捨てる
//             }
//           }
//         }
//         port.postMessage({ type: 'DONE' });
//       } catch (e) {
//         port.postMessage({ type: 'ERROR', message: String(e) });
//       }
//     });
//   });
  
//   // 右クリックなどはあなたの既存のままでOK（省略可）
  

// background.js（MV3 / サイドパネル起動 + 右クリック送信 + Ollamaストリーム + [object Object]対策）
const OLLAMA_URL = 'http://localhost:11434/api/chat';

/* 起動時にコンテキストメニュー作成（重複は無視） */
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'ask-local',
      title: 'サイドバー(20B)で質問',
      contexts: ['selection']
    });
  } catch {}
});

/* 右クリック選択テキストをサイドパネルへ */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ask-local' && info.selectionText) {
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
    chrome.runtime.sendMessage({ type: 'ASK_FROM_CONTEXT', text: info.selectionText });
  }
});

/* ツールバーアイコン／ショートカットでサイドパネルを開く */
chrome.action?.onClicked.addListener(async (tab) => {
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});
chrome.commands?.onCommand.addListener(async (cmd) => {
  if (cmd === 'open-sidebar') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  }
});

/* 安全な文字列化（[object Object] 回避） */
function toText(x){
  if (x == null) return '';
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

/* Ollama NDJSON ストリーミング */
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'ollama-stream') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'CALL_LOCAL_STREAM') return;
    try {
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: msg.model || 'gpt-oss:20b',
          messages: (msg.messages || []).map(m => ({ role: m.role, content: m.content })),
          stream: true,
          options: { num_ctx: 4096 }
        })
      });
      if (!res.ok) { port.postMessage({ type: 'ERROR', message: `Ollama ${res.status}` }); return; }
      if (!res.body) { port.postMessage({ type: 'ERROR', message: 'ReadableStreamなし' }); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;

          try {
            const j = JSON.parse(line);

            if (j?.error) { port.postMessage({ type: 'ERROR', message: toText(j.error) }); return; }

            // 文字列チャンクのみ送出
            let chunk = '';
            if (typeof j?.message?.content === 'string') chunk = j.message.content;
            else if (typeof j?.response === 'string')      chunk = j.response;
            else if (typeof j?.delta === 'string')         chunk = j.delta;
            else if (typeof j?.delta?.content === 'string')chunk = j.delta.content;

            if (chunk) port.postMessage({ type: 'CHUNK', data: toText(chunk) });
            if (j?.done) { port.postMessage({ type: 'DONE' }); return; }
          } catch {
            // 断片は無視
          }
        }
      }
      port.postMessage({ type: 'DONE' });
    } catch (e) {
      port.postMessage({ type: 'ERROR', message: toText(e) });
    }
  });
});
