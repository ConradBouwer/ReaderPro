const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronPath', {
    join: (...args) => args.join('/').replace(/\/+/g, '/'),
    resolve: (...args) => args.join('/').replace(/\/+/g, '/'),
    dirname: (p) => p.substring(0, p.lastIndexOf('/') + 1) || './',
    basename: (p, ext) => {
        const base = p.substring(p.lastIndexOf('/') + 1);
        return ext ? base.replace(ext, '') : base;
    }
});

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
  getStoryById: (id) => ipcRenderer.invoke('get-story-by-id', id),
  scanPdf: (filePath) => ipcRenderer.invoke('scan-pdf', filePath),
  
  // --- Library Management Handlers ---
  setActiveStory: (id, grade) => ipcRenderer.invoke('set-active-story', id, grade),
  getActiveStoryForGrade: (grade) => ipcRenderer.invoke('get-active-story-for-grade', grade),
  deleteStory: (id) => ipcRenderer.invoke('delete-story', id),

  // --- Learner Results & Analytics ---
  saveResult: (resultData) => ipcRenderer.invoke('save-result', resultData),
  getAllResults: () => ipcRenderer.invoke('get-all-results'),
  clearResults: () => ipcRenderer.invoke('clear-results'),

  // --- CSV Export ---
  exportToCSV: (payload) => ipcRenderer.invoke('export-to-csv', payload),

  // --- Database Backup ---
  exportDatabaseBackup: () => ipcRenderer.invoke('export-database-backup'),

  // --- Branding & Settings ---
  saveSetting: (data) => ipcRenderer.invoke('save-setting', data),
  getSettings: () => ipcRenderer.invoke('get-settings'),

  // --- Badges & Achievements ---
  getStudentBadges: (email) => ipcRenderer.invoke('get-student-badges', email),
  getLoginStreak: (email) => ipcRenderer.invoke('get-login-streak', email),
  awardBadge: (badgeData) => ipcRenderer.invoke('award-badge', badgeData),

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
