(function () {
  'use strict';
  if (window.__nabsChatLoaded) return;
  window.__nabsChatLoaded = true;

  var WS_URL = 'wss://nabs-chat-service.onrender.com';

  // â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  var css = `
    #nabs-chat-wrapper {
      position: fixed; bottom: 24px; right: 24px; z-index: 999998;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
    }
    #nabs-chat-label {
      background: #c8a84b; color: #080818;
      font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
      padding: 4px 12px; border-radius: 20px; white-space: nowrap;
      font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 0 2px 8px rgba(200,168,75,0.4);
      pointer-events: none;
    }
    #nabs-chat-btn {
      width: 58px; height: 58px; border-radius: 50%;
      background: #080818; border: 2px solid #c8a84b;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 26px; box-shadow: 0 0 16px rgba(200,168,75,0.4);
      animation: nabsPulse 3s ease-in-out infinite;
      transition: transform 0.2s;
    }
    #nabs-chat-btn:hover { transform: scale(1.08); }
    @keyframes nabsPulse {
      0%, 100% { box-shadow: 0 0 12px rgba(200,168,75,0.35); }
      50%       { box-shadow: 0 0 24px rgba(200,168,75,0.65); }
    }
    #nabs-chat-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 999999;
      width: 360px; height: 500px;
      background: #080818; border: 1px solid #c8a84b33;
      border-radius: 16px; display: flex; flex-direction: column;
      box-shadow: 0 8px 40px rgba(0,0,0,0.7);
      font-family: system-ui, -apple-system, sans-serif;
      overflow: hidden; opacity: 0; transform: translateY(12px) scale(0.97);
      pointer-events: none; transition: opacity 0.2s, transform 0.2s;
    }
    #nabs-chat-panel.nabs-open {
      opacity: 1; transform: translateY(0) scale(1); pointer-events: all;
    }
    #nabs-chat-header {
      background: linear-gradient(135deg, #0d0d2b 0%, #1a1a3e 100%);
      border-bottom: 1px solid #c8a84b44;
      padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;
    }
    #nabs-chat-header span {
      color: #c8a84b; font-size: 15px; font-weight: 600; letter-spacing: 0.5px;
    }
    #nabs-close-btn {
      background: none; border: none; color: #c8a84b88; font-size: 20px;
      cursor: pointer; padding: 0 4px; line-height: 1;
    }
    #nabs-close-btn:hover { color: #c8a84b; }
    #nabs-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px 14px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: #c8a84b33 transparent;
      user-select: text; -webkit-user-select: text;
    }
    #nabs-chat-messages::-webkit-scrollbar { width: 4px; }
    #nabs-chat-messages::-webkit-scrollbar-thumb { background: #c8a84b44; border-radius: 4px; }
    .nabs-msg {
      max-width: 82%; padding: 10px 13px; border-radius: 12px;
      font-size: 14px; line-height: 1.5; word-break: break-word;
    }
    .nabs-msg-bot {
      background: #111128; color: #e8e8f0; border-bottom-left-radius: 4px; align-self: flex-start;
    }
    .nabs-msg-user {
      background: #c8a84b; color: #080818; font-weight: 500;
      border-bottom-right-radius: 4px; align-self: flex-end;
    }
    .nabs-typing {
      align-self: flex-start; background: #111128; border-radius: 12px;
      border-bottom-left-radius: 4px; padding: 10px 14px; display: flex; gap: 5px;
    }
    .nabs-dot {
      width: 7px; height: 7px; border-radius: 50%; background: #c8a84b88;
      animation: nabsBounce 1.2s ease-in-out infinite;
    }
    .nabs-dot:nth-child(2) { animation-delay: 0.2s; }
    .nabs-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes nabsBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30% { transform: translateY(-5px); opacity: 1; }
    }
    #nabs-chat-footer {
      border-top: 1px solid #c8a84b22; padding: 12px;
      display: flex; gap: 8px; background: #0a0a1e;
    }
    #nabs-input {
      flex: 1; background: #111128; border: 1px solid #c8a84b33; border-radius: 8px;
      color: #e8e8f0; font-size: 14px; padding: 9px 12px; outline: none;
      font-family: inherit; resize: none; height: 38px; line-height: 1.4;
    }
    #nabs-input::placeholder { color: #555577; }
    #nabs-input:focus { border-color: #c8a84b88; }
    #nabs-send-btn {
      background: #c8a84b; border: none; border-radius: 8px; color: #080818;
      font-size: 18px; width: 38px; cursor: pointer; flex-shrink: 0;
      font-weight: bold; transition: background 0.15s;
    }
    #nabs-send-btn:hover { background: #e2c97e; }
    #nabs-send-btn:disabled { background: #c8a84b55; cursor: default; }
  `;

  // â”€â”€ DOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var wrapper = document.createElement('div');
  wrapper.id = 'nabs-chat-wrapper';

  var label = document.createElement('div');
  label.id = 'nabs-chat-label';
  label.textContent = 'ðŸ’¬ Live Chat';

  var btn = document.createElement('div');
  btn.id = 'nabs-chat-btn';
  btn.innerHTML = 'âœ¦';
  btn.title = 'Chat with us';

  wrapper.appendChild(label);
  wrapper.appendChild(btn);
  document.body.appendChild(wrapper);

  var panel = document.createElement('div');
  panel.id = 'nabs-chat-panel';
  panel.innerHTML = `
    <div id="nabs-chat-header">
      <span>âœ¦ Name a Bright Star</span>
      <button id="nabs-close-btn" aria-label="Close">Ã—</button>
    </div>
    <div id="nabs-chat-messages"></div>
    <div id="nabs-chat-footer">
      <input id="nabs-input" type="text" placeholder="Ask about your starâ€¦" autocomplete="off" maxlength="500">
      <button id="nabs-send-btn" aria-label="Send">âž¤</button>
    </div>
  `;
  document.body.appendChild(panel);

  var messagesEl = document.getElementById('nabs-chat-messages');
  var inputEl = document.getElementById('nabs-input');
  var sendBtn = document.getElementById('nabs-send-btn');
  var closeBtn = document.getElementById('nabs-close-btn');
  var isOpen = false;
  var ws = null;
  var connected = false;
  var pendingTyping = null;

  // â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = function () {
      connected = true;
      sendBtn.disabled = false;
    };

    ws.onmessage = function (evt) {
      removeTyping();
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'chat' || data.type === 'message' || data.type === 'response') {
          addMessage(data.text || data.content || '', 'bot');
        } else if (data.type === 'approval_result') {
          if (data.status === 'approved') {
            addMessage('âœ… ' + (data.result || 'Your request has been approved.'), 'bot');
          } else {
            addMessage('Your request could not be approved at this time. Please email support@nameabrightstar.com for help.', 'bot');
          }
        } else if (data.text || data.content || data.message) {
          addMessage(data.text || data.content || data.message, 'bot');
        }
      } catch (e) {
        if (typeof evt.data === 'string' && evt.data.trim()) {
          addMessage(evt.data, 'bot');
        }
      }
    };

    ws.onerror = function () {
      connected = false;
    };

    ws.onclose = function () {
      connected = false;
      sendBtn.disabled = true;
      setTimeout(function () { if (isOpen) connect(); }, 3000);
    };
  }

  // â”€â”€ Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function linkify(text) {
    // Convert URLs to clickable links
    return escapeHtml(text).replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener" style="color:#c8a84b;word-break:break-all;">$1</a>'
    );
  }

  function addMessage(text, who) {
    var div = document.createElement('div');
    div.className = 'nabs-msg ' + (who === 'user' ? 'nabs-msg-user' : 'nabs-msg-bot');
    div.style.userSelect = 'text';
    div.style.webkitUserSelect = 'text';
    // Bot messages: linkify URLs. User messages: plain escaped text.
    div.innerHTML = who === 'bot' ? linkify(text) : escapeHtml(text);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    if (pendingTyping) return;
    var div = document.createElement('div');
    div.className = 'nabs-typing';
    div.id = 'nabs-typing-indicator';
    div.innerHTML = '<div class="nabs-dot"></div><div class="nabs-dot"></div><div class="nabs-dot"></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    pendingTyping = div;
  }

  function removeTyping() {
    if (pendingTyping) {
      pendingTyping.remove();
      pendingTyping = null;
    }
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !connected) return;
    addMessage(text, 'user');
    inputEl.value = '';
    showTyping();
    try {
      ws.send(JSON.stringify({ type: 'chat', text: text }));
    } catch (e) {
      removeTyping();
      addMessage('Connection lost. Please refresh and try again.', 'bot');
    }
  }

  // â”€â”€ Toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function openPanel() {
    isOpen = true;
    panel.classList.add('nabs-open');
    connect();
    if (messagesEl.children.length === 0) {
      setTimeout(function () {
        addMessage('Hi! âœ¦ Welcome to Name a Bright Star. I can help you look up a registration, resend your certificate, or answer questions about your star. What can I help you with?', 'bot');
      }, 300);
    }
    setTimeout(function () { inputEl.focus(); }, 250);
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('nabs-open');
  }

  btn.addEventListener('click', function () { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closePanel(); });
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Initial state: button disabled until WS connects
  sendBtn.disabled = true;
})();
