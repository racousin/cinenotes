const input = document.getElementById('omdbKey');

document.getElementById('openRanking').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggleRanking' });
    window.close();
  } catch {
    flash('Ouvrez Netflix puis rechargez la page (⌘R).');
  }
});
const status = document.getElementById('status');
const flash = (msg) => {
  status.textContent = msg;
  setTimeout(() => (status.textContent = ''), 4000);
};

chrome.storage.sync.get('omdbKey').then(({ omdbKey }) => (input.value = omdbKey || ''));

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ omdbKey: input.value.trim() });
  await chrome.runtime.sendMessage({ type: 'clearCache' });
  flash('Enregistré ✔');
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearCache' });
  flash('Cache vidé ✔');
});
