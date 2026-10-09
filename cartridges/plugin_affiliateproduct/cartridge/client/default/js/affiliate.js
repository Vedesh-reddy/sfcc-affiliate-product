'use strict';

/**
 * Copies the code or link named by the button's data-affiliate-copy and announces the result.
 * @param {HTMLElement} button - copy button
 */
function copy(button) {
    var source = document.getElementById(button.getAttribute('data-affiliate-copy'));
    var status = button.parentNode.parentNode.querySelector('.affiliate-copy-status');
    var text = source.value || source.textContent.trim();
    var announce = function (key) {
        if (status) status.textContent = button.getAttribute('data-' + key) || '';
    };
    navigator.clipboard.writeText(text).then(function () { announce('done'); }, function () { announce('failed'); });
}

/**
 * Applies or removes the checkout referral and swaps in the re-rendered panel.
 * @param {HTMLFormElement} form - referral form
 */
function submitReferral(form) {
    var panel = form.closest('[data-affiliate-panel]');
    var message = panel.querySelector('.affiliate-referral-message');
    fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        if (data.success) {
            panel.outerHTML = data.panel;
        } else {
            message.textContent = data.errorMessage || '';
        }
    }).catch(function () {
        window.location.reload();
    });
}

document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-affiliate-copy]');
    if (button) copy(button);
});

document.addEventListener('submit', function (event) {
    var form = event.target.closest('.affiliate-referral-form');
    if (!form) return;
    event.preventDefault();
    submitReferral(form);
});
