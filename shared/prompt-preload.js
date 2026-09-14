// prompt-preload.js - Preload script for prompt modal window
// Exposes submit/cancel IPC methods to the prompt modal renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptAPI', {
    submit: function(value) { ipcRenderer.send('prompt:submit', value); },
    cancel: function() { ipcRenderer.send('prompt:cancel'); }
});
