(() => {
    const ids = ['adminClaimFreeBtn','editionPhone','adminPhone','adminActivateModal','activateModal'];
    const out = {};
    for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? {
            tag: el.tagName, display: getComputedStyle(el).display,
            visible: !!(el.offsetWidth || el.offsetHeight),
            text: (el.textContent || '').trim().slice(0, 40),
            value: el.value || ''
        } : null;
    }
    // 当前可见的模态
    const modals = [...document.querySelectorAll('[id*="odal" i]')].filter(e => e.offsetWidth > 0).map(e => e.id);
    out.visibleModals = modals;
    // 页面上所有含“免费”的按钮
    out.freeButtons = [...document.querySelectorAll('button')].filter(b => /免费/.test(b.textContent)).map(b => ({
        id: b.id, text: b.textContent.trim().slice(0, 30), visible: !!(b.offsetWidth || b.offsetHeight),
        disabled: b.disabled
    }));
    out.hasLicenseApi = !!(window.electronAPI && window.electronAPI.activate && typeof window.electronAPI.activate.claimFree === 'function');
    return out;
})()
