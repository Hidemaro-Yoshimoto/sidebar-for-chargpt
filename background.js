// ストリーミング本体：Ollama NDJSON
chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'ollama-stream') return;
  
    port.onMessage.addListener(async (msg) => {
      if (msg.type !== 'CALL_LOCAL_STREAM') return;
      try {
        const res = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: msg.model || 'gpt-oss:20b',
            messages: (msg.messages || []).map(m => ({ role: m.role, content: m.content })),
            stream: true,
            options: { num_ctx: 4096 } // 必要に応じて調整
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
  
              // ★ エラー行を捕捉
              if (j?.error) {
                port.postMessage({ type: 'ERROR', message: j.error });
                return;
              }
  
              const chunk = j?.message?.content || j?.response || '';
              if (chunk) port.postMessage({ type: 'CHUNK', data: chunk });
              if (j?.done) { port.postMessage({ type: 'DONE' }); return; }
            } catch {
              // 断片は無視
            }
          }
        }
        port.postMessage({ type: 'DONE' });
      } catch (e) {
        port.postMessage({ type: 'ERROR', message: String(e) });
      }
    });
  });
  
  // 右クリックからサイドパネルに送る（任意）
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'ask-local',
      title: 'サイドバー(20B)で質問',
      contexts: ['selection']
    });
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'ask-local' && info.selectionText) {
      if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
      chrome.runtime.sendMessage({ type: 'ASK_FROM_CONTEXT', text: info.selectionText });
    }
  });
  
  // アイコン/ショートカットで開く
  chrome.action?.onClicked.addListener(async (tab) => {
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  });
  chrome.commands?.onCommand.addListener(async (cmd) => {
    if (cmd === 'open-sidebar') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
    }
  });
  