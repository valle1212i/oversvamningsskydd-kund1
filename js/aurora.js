(() => {
    const API_URL = 'https://<DIN-AURORA-BACKEND>.onrender.com/api/aurora/ask';
  
    let history = [];
  
    function el(tag, attrs = {}, children = []) {
      const e = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
      (Array.isArray(children) ? children : [children])
        .filter(Boolean)
        .forEach(c => {
          e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      return e;
    }
  
    // --- Stilar för chat-widget ---
    const style = el('style', {}, `
      .aurora-btn {
        position: fixed; right: 20px; bottom: 20px;
        border: 0; border-radius: 999px;
        padding: 12px 16px;
        background: #0ea5e9; color: #fff;
        font-weight: 600; cursor: pointer;
        box-shadow: 0 8px 30px rgba(2,132,199,.4);
        z-index: 9999;
      }
      .aurora-panel {
        position: fixed; right: 20px; bottom: 80px;
        width: 340px; max-height: 520px;
        background: #0b1220; color: #e5e7eb;
        border: 1px solid #1f2a44; border-radius: 14px;
        display: none; flex-direction: column;
        overflow: hidden; z-index: 9999;
      }
      .aurora-head {
        padding: 10px 12px; border-bottom: 1px solid #1f2a44;
        font-weight: 700;
      }
      .aurora-log {
        flex: 1; padding: 10px; overflow: auto;
        font-size: 14px;
      }
      .aurora-row {
        display: flex; gap: 8px; padding: 10px;
        border-top: 1px solid #1f2a44;
      }
      .aurora-in {
        flex: 1; border: 1px solid #1f2a44;
        background: #0a1020; color: #e5e7eb;
        border-radius: 10px; padding: 8px 10px;
      }
      .aurora-send {
        background: #22c55e; border: 0; color: #0b1220;
        font-weight: 700; border-radius: 10px;
        padding: 8px 12px; cursor: pointer;
      }
      .a-msg {
        margin: 8px 0; padding: 8px 10px;
        border-radius: 10px; max-width: 90%;
      }
      .a-user { background: #12243a; align-self: flex-end; }
      .a-bot { background: #0f172a; }
    `);
    document.head.appendChild(style);
  
    // --- Skapa element ---
    const btn = el('button', { class: 'aurora-btn' }, 'Chatta med Aurora');
    const panel = el('div', { class: 'aurora-panel' }, [
      el('div', { class: 'aurora-head' }, 'Aurora – Översvämningsskydd'),
      el('div', { class: 'aurora-log', id: 'aurora-log' }),
      el('div', { class: 'aurora-row' }, [
        el('input', { class: 'aurora-in', id: 'aurora-in', placeholder: 'Skriv din fråga…' }),
        el('button', { class: 'aurora-send', id: 'aurora-send' }, 'Skicka')
      ])
    ]);
  
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  
    // --- Öppna/Stäng panel ---
    btn.onclick = () => {
      panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
      if (panel.style.display === 'flex') document.getElementById('aurora-in').focus();
    };
  
    // --- Chat-logik ---
    function push(type, text) {
      const log = document.getElementById('aurora-log');
      const bubble = el('div', { class: `a-msg ${type === 'user' ? 'a-user' : 'a-bot'}` }, text);
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
    }
  
    async function send() {
      const input = document.getElementById('aurora-in');
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      push('user', q);
  
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, history })
        });
        const data = await res.json();
        const answer = data?.answer || 'Tyvärr, jag saknar ett svar just nu.';
        push('bot', answer);
  
        history = [...history, { role: 'user', content: q }, { role: 'assistant', content: answer }].slice(-10);
      } catch (e) {
        push('bot', 'Tekniskt fel – försök igen om en liten stund.');
      }
    }
  
    document.getElementById('aurora-send').onclick = send;
    document.getElementById('aurora-in').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
  })();
  