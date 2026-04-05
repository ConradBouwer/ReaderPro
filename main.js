const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs'); 

let mainWindow;
let db;

/**
 * WINDOW INITIALIZATION
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false, 
    focusable: true,
    backgroundColor: '#001a3d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, 
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTimeout(() => {
        mainWindow.focus();
        mainWindow.webContents.focus();
    }, 250); // Increased to fix non-clickable field issues
  });
}

function initTables(dbInstance) {
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('busy_timeout = 5000');

  // 1. Settings Table (School Name, Logo, Colors)
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();

  // 2. Teacher Table & Master Admin
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS teachers (name TEXT, email TEXT PRIMARY KEY, password TEXT)`).run();
  dbInstance.prepare(`INSERT OR IGNORE INTO teachers (name, email, password) VALUES ('System Admin', 'cbouwer@namies.co.za', 'admin123')`).run();

  // 3. Stories Table
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    id_string TEXT UNIQUE, 
    title TEXT, 
    content TEXT, 
    language TEXT,
    questions TEXT, 
    words INTEGER,
    is_active INTEGER DEFAULT 0
  )`).run();

  // 4. Roster Table
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS roster (name TEXT, email TEXT PRIMARY KEY, grade TEXT, class_id TEXT, language TEXT)`).run();

  // 5. Results Table
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    email TEXT, 
    story_id_string TEXT, 
    wpm INTEGER, 
    accuracy INTEGER, 
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
// --- Window Management IPCs ---
ipcMain.on('minimize-app', () => mainWindow.minimize());
ipcMain.on('close-app', () => { 
  if (db) db.close(); 
  app.quit(); 
});

ipcMain.on('request-focus', () => {
  if (mainWindow) {
    mainWindow.blur(); 
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
});

ipcMain.on('switch-page', (event, page) => {
  if (mainWindow) {
    mainWindow.loadFile(page);
    mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => {
            mainWindow.focus();
            mainWindow.webContents.focus();
        }, 150);
    });
  }
});

// --- Database Connectivity Handlers ---
ipcMain.handle('connect-db-silent', async (event, savedPath) => {
  try {
    db = new Database(path.join(savedPath, 'literacy_data.db'));
    initTables(db);
    return { success: true };
  } catch (e) {
    console.error("Database connection failed:", e);
    return { success: false };
  }
});

ipcMain.handle('setup-database', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const folder = result.filePaths[0];
    db = new Database(path.join(folder, 'literacy_data.db'));
    initTables(db);
    return { success: true, path: folder };
  }
  return { success: false };
});

// --- Branding & Settings Management ---
ipcMain.handle('save-setting', async (event, { key, value }) => {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
  return { success: true };
});


// --- Auth & Roster Management (Strict Mode) ---
ipcMain.handle('attempt-login', async (event, { email, password }) => {
  try {
    // 1. Check the Student Roster first
    const student = db.prepare('SELECT * FROM roster WHERE email = ?').get(email);
    if (student) {
      // Students don't have passwords in your current schema, so they get in by email
      return { 
        success: true, 
        role: 'learner', 
        page: 'learner.html', 
        studentData: student 
      };
    }

    // 2. Check the Registered Teachers table
    const teacher = db.prepare('SELECT * FROM teachers WHERE email = ?').get(email);
    
    // If teacher exists AND password matches
    if (teacher && teacher.password === password) {
      return { 
        success: true, 
        role: 'teacher', 
        page: 'teacher.html' 
      };
    }

    // 3. If it reaches here, they aren't in either table
    return { 
        success: false, 
        message: "Access Denied: User not found in database." 
    };

  } catch (e) {
    console.error("Login Database Error:", e);
    return { success: false, message: "Database connection error." };
  }
});

ipcMain.handle('save-student', async (event, s) => {
  db.prepare(`INSERT OR REPLACE INTO roster (name, email, grade, class_id, language) VALUES (?, ?, ?, ?, ?)`).run(
    s.name, s.email, s.grade, s.class_id, s.language
  );
  return { success: true };
});

ipcMain.handle('get-all-students', async () => {
  return db.prepare('SELECT * FROM roster ORDER BY name ASC').all();
});

ipcMain.handle('delete-student', async (event, email) => {
  db.prepare('DELETE FROM roster WHERE email = ?').run(email);
  return { success: true };
});

ipcMain.handle('save-teacher', async (event, t) => {
  db.prepare(`INSERT OR REPLACE INTO teachers (name, email, password) VALUES (?, ?, ?)`).run(
    t.name, t.email, t.password
  );
  return { success: true };
});

ipcMain.handle('get-all-teachers', async () => {
  return db.prepare('SELECT * FROM teachers ORDER BY name ASC').all();
});

ipcMain.handle('delete-teacher', async (event, email) => {
  db.prepare('DELETE FROM teachers WHERE email = ?').run(email);
  return { success: true };
});

ipcMain.handle('save-story', async (event, s) => {
  db.prepare(`INSERT OR REPLACE INTO stories (id_string, title, content, language, questions, words) VALUES (?, ?, ?, ?, ?, ?)`).run(
    s.id_string, s.title, s.content, s.language, s.questions, s.words
  );
  return { success: true };
});

ipcMain.handle('get-stories', async () => {
  return db.prepare('SELECT * FROM stories ORDER BY id_string ASC').all();
});

ipcMain.handle('set-active-story', async (event, id) => {
  db.prepare('UPDATE stories SET is_active = 0').run();
  db.prepare('UPDATE stories SET is_active = 1 WHERE id_string = ?').run(id);
  return { success: true };
});

ipcMain.handle('delete-story', async (event, id_string) => {
  db.prepare('DELETE FROM stories WHERE id_string = ?').run(id_string);
  return { success: true };
});

ipcMain.handle('save-result', async (event, r) => {
  db.prepare(`INSERT INTO results (email, story_id_string, wpm, accuracy) VALUES (?, ?, ?, ?)`).run(
    r.email, r.story_id_string, r.wpm, r.accuracy
  );
  return { success: true };
});

ipcMain.handle('get-all-results', async () => {
  return db.prepare(`
    SELECT r.*, s.name, s.grade, s.class_id 
    FROM roster s 
    LEFT JOIN results r ON s.email = r.email 
    ORDER BY s.name ASC
  `).all();
});

ipcMain.handle('clear-results', async () => {
  db.prepare('DELETE FROM results').run();
  return { success: true };
});

ipcMain.handle('export-to-csv', async (event, { type, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export ${type}`,
    defaultPath: path.join(app.getPath('documents'), `${type}_export.csv`),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (!result.canceled && result.filePath) {
    try {
      let csvContent = "";
      if (type === 'Roster') {
        csvContent = "Name,Email,Grade,Class,Language\n";
        data.forEach(s => {
          csvContent += `"${s.name}","${s.email}","${s.grade}","${s.class_id}","${s.language}"\n`;
        });
      }
	  
	  else if (type === 'Teachers') {
        csvContent = "Name,Email,Password\n";
        data.forEach(t => {
          csvContent += `"${t.name}","${t.email}","${t.password}"\n`;
        });
      }
	  
      fs.writeFileSync(result.filePath, csvContent, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
  return { success: false };
});
// --- Fetch settings ---
ipcMain.handle('get-settings', async () => {
  try {
    // 1. Get EVERY row from the settings table (name, logo, primary, dark, accent)
    const rows = db.prepare('SELECT * FROM settings').all();
    
    // 2. Turn those rows into a single object like: { schoolName: "...", primary: "#ff0000", ... }
    const settingsObject = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    return settingsObject;
  } catch (err) {
    console.error("Failed to fetch settings:", err);
    return {};
  }
});

// --- New Handler for the Professional Report ---
ipcMain.handle('get-student-results', async (event, email) => {
  try {
    return db.prepare(`
      SELECT 
        r.timestamp as date, 
        COALESCE(s.title, 'General Reading') as story, 
        r.wpm as speed, 
        r.accuracy 
      FROM results r
      LEFT JOIN stories s ON r.story_id_string = s.id_string
      WHERE LOWER(TRIM(r.email)) = LOWER(TRIM(?))
      ORDER BY r.timestamp DESC
    `).all(email);
  } catch (err) {
    console.error("Database Error:", err);
    return [];
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});