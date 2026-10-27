const toast = document.getElementById('toast');
const params = new URLSearchParams(location.search);
if (params.has('saved') || params.has('feedback')) {
  toast.textContent = params.has('feedback') ? 'Thank you. Your feedback has been saved.' : 'Your changes have been saved.';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4500);
}
for (const form of document.querySelectorAll('form')) {
  form.addEventListener('submit', event => {
    const from = form.querySelector('input[name="from"]');
    const to = form.querySelector('input[name="to"]');
    if (from && to && from.value >= to.value) {
      event.preventDefault(); to.setCustomValidity('Check-out must be after check-in.'); to.reportValidity();
    } else if (to) to.setCustomValidity('');
  });
  for (const input of form.querySelectorAll('input[type="date"]')) input.addEventListener('input', () => {
    for (const date of form.querySelectorAll('input[type="date"]')) date.setCustomValidity('');
  });
}
const dialog = document.getElementById('gallery-dialog');
if (dialog) {
  document.querySelectorAll('[data-gallery-open]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if(event.target === dialog) dialog.close(); });
}
const demoFill = document.querySelector('[data-fill-card]');
if (demoFill) demoFill.addEventListener('click', () => {
  document.querySelector('[name="cardNumber"]').value = '4242 4242 4242 4242';
  document.querySelector('[name="cardNumber"]').focus();
});
