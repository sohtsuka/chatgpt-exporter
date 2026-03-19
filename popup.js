// popup.js
// Runs in the extension popup context.

const btn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = type; // '' | 'error' | 'success'
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  setStatus('チャットを抽出中...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Guard: only run on chatgpt.com
  if (!tab?.url?.includes('chatgpt.com')) {
    setStatus('chatgpt.com を開いてからお試しください。', 'error');
    btn.disabled = false;
    return;
  }

  let result;
  try {
    // Inject content.js (re-injection is safe — just redefines functions)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    // Call extractConversation() inside the page context
    const execResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => extractConversation(),
    });

    result = execResults?.[0]?.result;
  } catch (err) {
    setStatus(`エラー: ${err.message}`, 'error');
    btn.disabled = false;
    return;
  }

  if (!result || result.error) {
    setStatus(result?.error || '不明なエラーが発生しました。', 'error');
    btn.disabled = false;
    return;
  }

  // Encode markdown as a data URI for download
  // (Using data: URL instead of createObjectURL because the popup may close
  //  before the download completes, invalidating blob URLs.)
  const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
  const dataUrl = await blobToDataUrl(blob);

  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: result.filename,
      saveAs: false,
    });

    setStatus(
      `保存完了: "${result.title}" (${result.messageCount} メッセージ)`,
      'success'
    );
  } catch (err) {
    setStatus(`ダウンロード失敗: ${err.message}`, 'error');
  }

  btn.disabled = false;
});


function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
