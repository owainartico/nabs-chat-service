(function () {
  const CHAT_URL = window.NABS_CHAT_URL || 'wss://nabs-chat.onrender.com';

  // ── Styles ──────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #nabs-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      color: #fff; font-size: 26px; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s;
    }
    #nabs-chat-btn:hover { transform: scale(1.1); }

    #nabs-chat-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 9999;
      width: 360px; height: 520px;
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.2);
      display: none; flex-direction: column; overflow: hidden;
      font-family: Georgia, serif;
    }
    #nabs-chat-panel.open { display: flex; }

    #nabs-chat-header {
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      color: #fff; padding: 16px 20px;
      display: flex; align-items: center; gap: 12px;
    }
    #nabs-chat-header .star { font-size: 24px; }
    #nabs-chat-header .title { flex: 1; }
    #nabs-chat-header .title strong { display: block; font-size: 15px; }
    #nabs-chat-header .title span { font-size: 12px; opacity: 0.7; }
    #nabs-chat-close { background: none; border: none; color: #fff;
      font-size: 20px; cursor: pointer; opacity: 0.7; padding: 0; }
    #nabs-chat-close:hover { opacity: 1; }

    #nabs-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
      background: #f8f7f5;
    }

    .nabs-msg {
      max-width: 85%; padding: 10px 14px; border-radius: 12px;
      font-size: 14px; line-height: 1.5; word-break: break-word;
    }
    .nabs-msg.bot {
      background: #fff; color: #1a1a2e;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      align-self: flex-start;
    }
    .nabs-msg.user {
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      color: #fff; border-bottom-right-radius: 4px;
      align-self: flex-end;
    }
    .nabs-msg.typing { opacity: 0.6; font-style: italic; }

    #nabs-chat-input-area {
      padding: 12px 16px; background: #fff;
      border-top: 1px solid #eee;
      display: flex; gap: 8px; align-items: flex-end;
    }
    #nabs-chat-input {
      flex: 1; border: 1px solid #ddd; border-radius: 20px;
      padding: 8px 14px; font-size: 14px; font-family: Georgia, serif;
      resize: none; outline: none; max-height: 80px; overflow-y: auto;
    }
    #nabs-chat-input:focus { border-color: #1a1a2e; }
    #nabs-chat-send {
      width: 36px; height: 36px; border-radius: 50%;
      background: #1a1a2e; color: #fff; border: none; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #nabs-chat-send:hover { background: #16213e; }
    #nabs-chat-send:disabled { opacity: 0.4; cursor: default; }
  `;
  document.head.appendChild(style);

  // ── HTML ─────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'nabs-chat-panel';
  panel.innerHTML = `
    <div id="nabs-chat-header">
      <span class="star">⭐</span>
      <div class="title">
        <strong>Name a Bright Star</strong>
        <span>Support Chat</span>
      </div>
      <button id="nabs-chat-close">✕</button>
    </div>
    <div id="nabs-chat-messages"></div>
    <div id="nabs-chat-input-area">
      <textarea id="nabs-chat-input" placeholder="Ask us anything..." rows="1"></textarea>
      <button id="nabs-chat-send">➤</button>
    </div>
  `;
  document.body.appendChild(panel);

  const btn = document.createElement('button');
  btn.id = 'nabs-chat-btn';
  btn.innerHTML = '⭐';
  btn.title = 'Chat with support';
  document.body.appendChild(btn);

  // ── State ─────────────────────────────────────────────────────────
  let ws = null;
  let isOpen = false;
  let connected = false;
  let greeted = false;

  const messages = document.getElementById('nabs-chat-messages');
  const input = document.getElementById('nabs-chat-input');
  const send = document.getElementById('nabs-chat-send');

  // ── WebSocket ─────────────────────────────────────────────────────
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(CHAT_URL.replace(/^http/, 'ws'));

    ws.onopen = () => {
      connected = true;
      if (!greeted) {
        greeted = true;
        addMessage('bot', "Hi! 🌟 Welcome to Name a Bright Star support. I can help you with registration, certificates, or any questions about your star. What can I help you with today?");
      }
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      removeTyping();

      if (msg.type === 'chat') {
        addMessage('bot', msg.text);
      } else if (msg.type === 'approval_result') {
        if (msg.status === 'approved') {
          addMessage('bot', `All sorted! ✅ ${msg.result || 'Your request has been processed.'} Is there anything else I can help you with?`);
        } else {
          addMessage('bot', "I'm sorry, we're not able to process that request right now. Please email us at support@nameabrightstar.com and our team will help you out.");
        }
      }

      send.disabled = false;
    };

    ws.onclose = () => {
      connected = false;
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }

  // ── UI helpers ────────────────────────────────────────────────────
  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `nabs-msg ${role}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function addTyping() {
    if (document.getElementById('nabs-typing')) return;
    const div = document.createElement('div');
    div.className = 'nabs-msg bot typing';
    div.id = 'nabs-typing';
    div.textContent = '...';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function removeTyping() {
    const el = document.getElementById('nabs-typing');
    if (el) el.remove();
  }

  function sendMessage() {
    const text = input.value.trim();
    if (!text || !connected) return;

    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    send.disabled = true;
    addTyping();

    ws.send(JSON.stringify({ type: 'chat', text }));
  }

  // ── Events ────────────────────────────────────────────────────────
  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    btn.innerHTML = isOpen ? '✕' : '⭐';
    if (isOpen && !connected) connect();
    if (isOpen) setTimeout(() => input.focus(), 100);
  });

  document.getElementById('nabs-chat-close').addEventListener('click', () => {
    isOpen = false;
    panel.classList.remove('open');
    btn.innerHTML = '⭐';
  });

  send.addEventListener('click', sendMessage);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
  });
})();
