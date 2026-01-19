chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "GET_SELECTION") {
    const selection = window.getSelection()?.toString() || "";
    sendResponse({ text: selection });
    return true;
  }
  return false;
});
