// Closed import dialogs must not leave duplicate column IDs behind in the page.
const dialog = document.getElementById('dialog');
if (dialog instanceof HTMLDialogElement) {
  dialog.addEventListener('close', () => {
    // A newly opened dialog may have replaced the contents before the queued event.
    if (!dialog.open) dialog.replaceChildren();
  });
}
