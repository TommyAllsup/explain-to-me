const copyStatus = document.getElementById('copy-status');
let statusTimeout;

function showCopyStatus(message) {
  if (!copyStatus) return;
  window.clearTimeout(statusTimeout);
  copyStatus.textContent = message;
  copyStatus.classList.add('visible');
  statusTimeout = window.setTimeout(() => copyStatus.classList.remove('visible'), 3500);
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;
    const content = target.textContent.trim();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      showCopyStatus(button.dataset.copyMessage || (button.dataset.copy === 'agent-prompt' ? 'Copied the Windows installation prompt. Your agent has a mission.' : 'Copied the commands. Your first movie is next.'));
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
      target.scrollIntoView({ block: 'center' });
      showCopyStatus('Text selected. Press Ctrl+C (⌘C on Mac) to copy.');
    }
  });
}
