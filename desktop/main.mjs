import { app } from 'electron';

app.setName('Deskframe');
app.whenReady().then(() => app.quit());
