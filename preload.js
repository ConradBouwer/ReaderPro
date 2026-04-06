const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- Window Controls ---
  minimize: () => ipcRenderer.send('minimize-app'),
  close: () => ipcRenderer.send('close-app'),
  switchPage: (page) => ipcRenderer.send('switch-page', page),
  
  send: (channel, data) => {
    let validChannels = ['request-focus', 'minimize-app', 'close-app', 'switch-page'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  }, 

  // --- Database Setup & Persistence ---
  setupDatabase: () => ipcRenderer.invoke('setup-database'),
  connectSilent: (path) => ipcRenderer.invoke('connect-db-silent', path),

  // --- Authentication ---
  attemptLogin: (creds) => ipcRenderer.invoke('attempt-login', creds),

  // --- Teacher Roster Management ---
  saveStudent: (studentData) => ipcRenderer.invoke('save-student', studentData),
  getAllStudents: () => ipcRenderer.invoke('get-all-students'),
  deleteStudent: (email) => ipcRenderer.invoke('delete-student', email),

  // --- Staff / Teacher Management ---
  saveTeacher: (teacherData) => ipcRenderer.invoke('save-teacher', teacherData),
  getAllTeachers: () => ipcRenderer.invoke('get-all-teachers'),
  deleteTeacher: (email) => ipcRenderer.invoke('delete-teacher', email),

  // --- Story & OCR Management ---
  saveStory: (storyData) => ipcRenderer.invoke('save-story', storyData),
  getStories: () => ipcRenderer.invoke('get-stories'),
  
  // --- Library Management Handlers ---
  setActiveStory: (id) => ipcRenderer.invoke('set-active-story', id),
  deleteStory: (id) => ipcRenderer.invoke('delete-story', id),

  // --- Learner Results & Analytics ---
  saveResult: (resultData) => ipcRenderer.invoke('save-result', resultData),
  getAllResults: () => ipcRenderer.invoke('get-all-results'),
  clearResults: () => ipcRenderer.invoke('clear-results'),

  // --- CSV Export ---
  exportToCSV: (payload) => ipcRenderer.invoke('export-to-csv', payload),

  // --- Branding & Settings ---
  saveSetting: (data) => ipcRenderer.invoke('save-setting', data),
  getSettings: () => ipcRenderer.invoke('get-settings'),

  // --- UPDATE SYSTEM ---
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadAndInstallUpdate: (data) => ipcRenderer.invoke('download-and-install-update', data),
  openReleasePage: () => ipcRenderer.invoke('open-release-page'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Listen for download progress
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  removeDownloadProgress: (callback) => {
    ipcRenderer.removeListener('download-progress', callback);
  }
});