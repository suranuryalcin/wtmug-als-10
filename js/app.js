/* ============================================================
   app.js — Ana yönlendirici; moda göre modülleri başlatır
   ============================================================ */

'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'pair';

  // Tema + SW ortak
  Utils.initTheme();
  Utils.registerSW();
  Utils.askNotifyPermission();

  // === PAIR MODU (ALŞ08) ===
  async function startPair() {
    const $ = Utils.$;
    $('modeTitle').textContent = 'Birebir Bağlantı';
$('pairView').classList.remove('hidden');
const tv = $('teacherView');
if (tv) tv.classList.add('hidden');
    

    Chat.loadHistory();

    const receiver = new FileTransfer.Receiver();

    Chat.bindInputs({
      canSend: () => WebRTC.getConn() && WebRTC.getConn().open,
      onText: (v) => {
        WebRTC.getConn().send({ type: 'text', text: v });
        Chat.addMsg(v, 'sent');
      },
      onFile: (f) => {
        FileTransfer.send(f, WebRTC.getConn()).catch(e => alert('Gönderim hatası: ' + e.message));
      }
    });

    Chat.bindDragDrop((f) => {
      const c = WebRTC.getConn();
      if (c && c.open) FileTransfer.send(f, c).catch(e => alert('Gönderim hatası: ' + e.message));
    });

    const copyBtn = $('copyIdBtn');
    const idText = $('peerIdText');
    if (copyBtn && idText) {
      copyBtn.onclick = async () => {
        await Utils.copyText(idText.textContent);
        copyBtn.textContent = '✓ Kopyalandı';
        setTimeout(() => copyBtn.textContent = '📋 ID\'yi Kopyala', 1500);
      };
      idText.onclick = () => copyBtn.click();
    }

    try {
      const id = await WebRTC.init();
      idText.textContent = id;
      QR.draw($('qrCanvas'), id);
      Utils.setStatus('QR kodu okutun');

      WebRTC.onIncoming((c) => {
        const existing = WebRTC.getConn();
        if (existing && existing.open) { try { c.close(); } catch (e) { } return; }

        WebRTC.setConn(c);
        wirePairConn(c, receiver);

        c.on('open', () => {
          Utils.setStatus('Bağlı ✓', 'connected');
          Chat.enableUI(true);
          Chat.addMsg('Bağlantı kuruldu. Uçtan uca şifreli.', 'system', null, { save: false });
          WebRTC.startQoS(c);
        });
      });
    } catch (e) {
      Utils.setStatus('Hata: ' + e.message, 'error');
    }
  }

  function wirePairConn(c, receiver) {
    c.on('data', (data) => {
      switch (data.type) {
        case 'text':
          Chat.addMsg(data.text, 'received');
          break;
        case 'file-meta':
          receiver.start(data);
          Chat.addMsg(`📎 ${data.name} (${Utils.fmtSize(data.size)}) alınıyor…`, 'system', null, { save: false });
          Utils.showProgress('Alınıyor: ' + data.name, 0);
          break;
        case 'file-chunk':
          Utils.showProgress('Alınıyor: ' + receiver.name, receiver.addChunk(data.data));
          break;
        case 'file-end': {
          const blob = receiver.finalize();
          const html = FileTransfer.renderFileCard(blob, receiver.name, receiver.mime);
          Chat.addMsg('', 'received', html);
          Utils.showProgress('Transfer tamamlandı ✓', 100, true);
          Utils.notify('Dosya alındı', receiver.name);
          break;
        }
      }
    });

    c.on('close', () => {
      Utils.setStatus('Bağlantı kesildi');
      Chat.enableUI(false);
      WebRTC.stopQoS();
      Chat.addMsg('Bağlantı kesildi.', 'system', null, { save: false });
      WebRTC.clearConn();
    });

    c.on('error', (e) => {
      console.error('[pair] conn error', e);
      Utils.setStatus('Bağlantı hatası', 'error');
    });
  }

  // === ÖĞRENCI MODU (ALŞ09) ===
  function startStudent() {
    const $ = Utils.$;
    $('modeTitle').textContent = 'Öğrenci Modu';

    $('hintText').textContent = 'QR kodu okutabilir veya Hocanın ID\'sini girebilirsiniz.';

    if (!window.isSecureContext) {
      const n = $('deviceNotice');
      if (n) { n.style.display = 'block'; n.textContent = '⚠️ Kamera ve WebRTC için HTTPS gerekir.'; }
    }

    const receiver = new FileTransfer.Receiver();

    $('connectBtn').onclick = () => {
      const id = $('peerIdInput').value.trim();
      if (!id) { alert('ID girin'); return; }
      connectAsStudent(id, receiver);
    };
    $('peerIdInput').onkeydown = (e) => { if (e.key === 'Enter') $('connectBtn').click(); };

    let qrScanner = null;
    $('scanBtn').onclick = () => {
      if (!window.isSecureContext) { alert('Kamera için HTTPS gerekir'); return; }
      $('scanBtn').classList.add('hidden');
      $('qrReader').classList.remove('hidden');
      qrScanner = QR.scan('qrReader',
        async (text) => {
          $('qrReader').classList.add('hidden');
          $('scanBtn').classList.remove('hidden');
          qrScanner = null;
          await connectAsStudent(text, receiver);
        },
        (err) => {
          alert('Kamera erişilemedi: ' + (err.message || err));
          $('qrReader').classList.add('hidden');
          $('scanBtn').classList.remove('hidden');
          qrScanner = null;
        }
      );
    };

    Chat.bindInputs({
      canSend: () => WebRTC.getConn() && WebRTC.getConn().open,
      onText: (v) => {
        WebRTC.getConn().send({ type: 'text', text: v });
        Chat.addMsg(v, 'sent');
      },
      onFile: (f) => {
        FileTransfer.send(f, WebRTC.getConn()).catch(e => alert('Gönderim hatası: ' + e.message));
      }
    });
  }

  async function connectAsStudent(hostId, receiver) {
    const $ = Utils.$;
    try {
      $('connectBtn').disabled = true;
      Utils.setStatus('Bağlanıyor…');
      if (!WebRTC.getPeer()) await WebRTC.init();
      const c = WebRTC.connect(hostId);
      WebRTC.setConn(c);

      c.on('open', () => {
        Utils.setStatus('Bağlı ✓', 'connected');
        $('connectView').classList.add('hidden');
        $('chatView').classList.remove('hidden');
        Chat.enableUI(true);
        Chat.addMsg('Hocaya bağlandınız.', 'system', null, { save: false });
      });

      c.on('data', (data) => {
        switch (data.type) {
          case 'text':
            Chat.addMsg(data.text, 'received');
            break;
          case 'file-meta':
            receiver.start(data);
            Chat.addMsg(`📎 ${data.name} (${Utils.fmtSize(data.size)}) alınıyor…`, 'system', null, { save: false });
            Utils.showProgress('Alınıyor: ' + data.name, 0);
            break;
          case 'file-chunk':
            Utils.showProgress('Alınıyor: ' + receiver.name, receiver.addChunk(data.data));
            break;
          case 'file-end': {
            const blob = receiver.finalize();
            const html = FileTransfer.renderFileCard(blob, receiver.name, receiver.mime);
            Chat.addMsg('', 'received', html);
            Utils.showProgress('Tamamlandı ✓', 100, true);
            Utils.notify('Dosya alındı', receiver.name);
            break;
          }
        }
      });

      c.on('close', () => {
        Utils.setStatus('Bağlantı kesildi');
        Chat.enableUI(false);
        Chat.addMsg('Bağlantı kesildi.', 'system', null, { save: false });
        WebRTC.clearConn();
      });

      c.on('error', (e) => {
        console.error('[student] conn error', e);
        Utils.setStatus('Bağlantı hatası', 'error');
      });
    } catch (e) {
      alert('Bağlantı hatası: ' + e.message);
      $('connectBtn').disabled = false;
      Utils.setStatus('Hata', 'error');
    }
  }

  // === ROUTER ===
  if (mode === 'teacher') {
    Broadcast.start();
  } else if (mode === 'student') {
    startStudent();
  } else {
    // pair (varsayılan)
    startPair();
  }
})();