// Aplikacja desktopowa TopSep: otwiera serwer w oknie.
// Domyślnie łączy się z localhost; zmień TOPSEP_URL, np. https://topsep.twojadomena.pl
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1100, height: 720, title: 'TopSep' });
  win.loadURL(process.env.TOPSEP_URL || 'http://localhost:8080');
});
app.on('window-all-closed', () => app.quit());
