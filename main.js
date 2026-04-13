const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs'); 
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const os = require('os');
const { GlobalWorkerOptions } = require('pdfjs-dist');

let mainWindow;
let db;
let updateInfo = null;

// Helper to get db config path (must be called after app ready)
const getDbPathFile = () => path.join(app.getPath('userData'), 'db_config.json');

function saveDbPath(dbPath) {
    try {
        fs.writeFileSync(getDbPathFile(), JSON.stringify({ path: dbPath }), 'utf8');
    } catch (err) {
        console.error('Failed to save DB path:', err);
    }
}

function getSavedDbPath() {
    try {
        const dbPathFile = getDbPathFile();
        if (fs.existsSync(dbPathFile)) {
            const config = JSON.parse(fs.readFileSync(dbPathFile, 'utf8'));
            return config.path;
        }
    } catch (err) {
        console.error('Failed to read DB path:', err);
    }
    return null;
}

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

  // Auto-connect to saved database on startup
  const savedPath = getSavedDbPath();
  if (savedPath && fs.existsSync(path.join(savedPath, 'literacy_data.db'))) {
    try {
      db = new Database(path.join(savedPath, 'literacy_data.db'));
      initTables(db);
      console.log('Auto-connected to database at:', savedPath);
    } catch (err) {
      console.error('Auto-connect failed:', err);
    }
  }

  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTimeout(() => {
        mainWindow.focus();
        mainWindow.webContents.focus();
    }, 250);
  });
}

function initTables(dbInstance) {
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('busy_timeout = 5000');

  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS teachers (name TEXT, email TEXT PRIMARY KEY, password TEXT)`).run();
  dbInstance.prepare(`INSERT OR IGNORE INTO teachers (name, email, password) VALUES ('System Admin', 'readerpro@admin.co.za', 'F0rtre$$')`).run();
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    id_string TEXT UNIQUE, 
    title TEXT, 
    content TEXT, 
    language TEXT,
    questions TEXT, 
    words INTEGER,
    is_active INTEGER DEFAULT 0,
    difficulty TEXT DEFAULT 'Medium',
    grade_level TEXT
  )`).run();
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS roster (
    name TEXT, 
    email TEXT PRIMARY KEY, 
    grade TEXT, 
    class_id TEXT, 
    language TEXT,
    parent_name TEXT,
    parent_surname TEXT,
    parent_email TEXT,
    parent_phone TEXT
  )`).run();
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    email TEXT, 
    story_id_string TEXT, 
    wpm INTEGER, 
    accuracy INTEGER, 
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    badge_type TEXT,
    badge_name TEXT,
    awarded_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    criteria_met TEXT
  )`).run();
  dbInstance.prepare(`CREATE TABLE IF NOT EXISTS login_streaks (
    email TEXT PRIMARY KEY,
    last_login DATE,
    streak_count INTEGER DEFAULT 0
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
        saveDbPath(savedPath);
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
        saveDbPath(folder);
        return { success: true, path: folder };
    }
    return { success: false };
});

// --- Branding & Settings Management ---
ipcMain.handle('save-setting', async (event, { key, value }) => {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
  return { success: true };
});

// --- Auth & Roster Management ---
ipcMain.handle('attempt-login', async (event, { email, password }) => {
  try {
    const student = db.prepare('SELECT * FROM roster WHERE email = ?').get(email);
    if (student) {
      const today = new Date().toISOString().split('T')[0];
      const streakRecord = db.prepare('SELECT * FROM login_streaks WHERE email = ?').get(email);
      
      if (streakRecord) {
        const lastLogin = new Date(streakRecord.last_login);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (lastLogin.toISOString().split('T')[0] === yesterday.toISOString().split('T')[0]) {
          db.prepare('UPDATE login_streaks SET last_login = ?, streak_count = streak_count + 1 WHERE email = ?')
            .run(today, email);
        } else if (lastLogin.toISOString().split('T')[0] !== today) {
          db.prepare('UPDATE login_streaks SET last_login = ?, streak_count = 1 WHERE email = ?')
            .run(today, email);
        }
      } else {
        db.prepare('INSERT INTO login_streaks (email, last_login, streak_count) VALUES (?, ?, 1)')
          .run(email, today);
      }
      
      await checkAndAwardBadges(email);
      
      return { 
        success: true, 
        role: 'learner', 
        page: 'learner.html', 
        studentData: student 
      };
    }

    const teacher = db.prepare('SELECT * FROM teachers WHERE email = ?').get(email);
    
    if (teacher && teacher.password === password) {
      return { 
        success: true, 
        role: 'teacher', 
        page: 'teacher.html' 
      };
    }

    return { 
        success: false, 
        message: "Access Denied: User not found in database." 
    };

  } catch (e) {
    console.error("Login Database Error:", e);
    return { success: false, message: "Database connection error." };
  }
});

ipcMain.handle('award-badge', async (event, badgeData) => {
    try {
        const exists = db.prepare('SELECT * FROM badges WHERE email = ? AND badge_type = ?')
            .get(badgeData.email, badgeData.badge_type);
        if (!exists) {
            db.prepare('INSERT INTO badges (email, badge_type, badge_name, criteria_met) VALUES (?, ?, ?, ?)')
                .run(badgeData.email, badgeData.badge_type, badgeData.badge_name, badgeData.criteria_met);
        }
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

async function checkAndAwardBadges(email) {
  const student = db.prepare('SELECT * FROM roster WHERE email = ?').get(email);
  const results = db.prepare('SELECT * FROM results WHERE email = ?').all(email);
  const streak = db.prepare('SELECT * FROM login_streaks WHERE email = ?').get(email);
  
  const baseWpm = getBaseWpmForGrade(student.grade);
  const highSpeedResults = results.filter(r => r.wpm >= baseWpm * 1.1);
  if (highSpeedResults.length > 0) {
    awardBadgeIfNotExists(email, 'speedster', 'The Speedster', `Achieved ${baseWpm * 1.1}+ WPM`);
  }
  
  const perfectResults = results.filter(r => r.accuracy === 100);
  if (perfectResults.length > 0) {
    awardBadgeIfNotExists(email, 'perfect_score', 'Perfect Score', '100% accuracy on quiz');
  }
  
  if (streak && streak.streak_count >= 5) {
    awardBadgeIfNotExists(email, 'consistent', 'Consistent Learner', `${streak.streak_count} day login streak`);
  }
  
  if (perfectResults.length >= 5) {
    awardBadgeIfNotExists(email, 'quality', 'Quality over Speed', '100% accuracy on 5+ stories');
  }
  
  if (results.length >= 2) {
    const sorted = results.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const firstWpm = sorted[0].wpm;
    const lastMonthResults = sorted.filter(r => {
      const daysDiff = (new Date() - new Date(r.timestamp)) / (1000 * 60 * 60 * 24);
      return daysDiff <= 30;
    });
    if (lastMonthResults.length > 0) {
      const latestWpm = lastMonthResults[lastMonthResults.length - 1].wpm;
      if (latestWpm - firstWpm >= 15) {
        awardBadgeIfNotExists(email, 'growth', 'Growth Mindset', `Improved by ${latestWpm - firstWpm} WPM`);
      }
    }
  }
  
  const gradeStories = db.prepare('SELECT * FROM stories WHERE grade_level = ? AND is_active = 1').all(student.grade);
  const completedStoryIds = new Set(results.map(r => r.story_id_string));
  const allGradeStoriesCompleted = gradeStories.every(s => completedStoryIds.has(s.id_string));
  if (allGradeStoriesCompleted && gradeStories.length > 0) {
    awardBadgeIfNotExists(email, 'finisher', 'The Finisher', 'Completed all grade stories');
  }
}

function awardBadgeIfNotExists(email, badgeType, badgeName, criteria) {
  const exists = db.prepare('SELECT * FROM badges WHERE email = ? AND badge_type = ?').get(email, badgeType);
  if (!exists) {
    db.prepare('INSERT INTO badges (email, badge_type, badge_name, criteria_met) VALUES (?, ?, ?, ?)')
      .run(email, badgeType, badgeName, criteria);
  }
}

function getBaseWpmForGrade(grade) {
  const gradeNum = parseInt(grade) || 8;
  const baseWpmMap = {
    4: 90, 5: 100, 6: 110, 7: 120,
    8: 130, 9: 140, 10: 150, 11: 160, 12: 170
  };
  return baseWpmMap[gradeNum] || 130;
}

ipcMain.handle('get-student-badges', async (event, email) => {
  return db.prepare('SELECT * FROM badges WHERE email = ? ORDER BY awarded_date DESC').all(email);
});

ipcMain.handle('get-login-streak', async (event, email) => {
  const streak = db.prepare('SELECT * FROM login_streaks WHERE email = ?').get(email);
  return streak || { streak_count: 0 };
});

ipcMain.handle('save-student', async (event, s) => {
  db.prepare(`INSERT OR REPLACE INTO roster (name, email, grade, class_id, language, parent_name, parent_surname, parent_email, parent_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    s.name, s.email, s.grade, s.class_id, s.language, s.parent_name, s.parent_surname, s.parent_email, s.parent_phone
  );
  return { success: true };
});

ipcMain.handle('get-all-students', async () => {
  return db.prepare('SELECT * FROM roster ORDER BY name ASC').all();
});

ipcMain.handle('delete-student', async (event, email) => {
  db.prepare('DELETE FROM roster WHERE email = ?').run(email);
  db.prepare('DELETE FROM results WHERE email = ?').run(email);
  db.prepare('DELETE FROM badges WHERE email = ?').run(email);
  db.prepare('DELETE FROM login_streaks WHERE email = ?').run(email);
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
  if (email === 'readerpro@admin.co.za') {
    return { success: false, message: 'Cannot delete super user account' };
  }
  db.prepare('DELETE FROM teachers WHERE email = ?').run(email);
  return { success: true };
});

ipcMain.handle('save-story', async (event, s) => {
  db.prepare(`INSERT OR REPLACE INTO stories (id_string, title, content, language, questions, words, difficulty, grade_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    s.id_string, s.title, s.content, s.language, s.questions, s.words, s.difficulty || 'Medium', s.grade_level
  );
  return { success: true };
});

ipcMain.handle('get-stories', async () => {
  return db.prepare('SELECT * FROM stories ORDER BY id_string ASC').all();
});

ipcMain.handle('get-story-by-id', async (event, id_string) => {
  return db.prepare('SELECT * FROM stories WHERE id_string = ?').get(id_string);
});

ipcMain.handle('set-active-story', async (event, id, grade) => {
  if (grade) {
    db.prepare('UPDATE stories SET is_active = 0 WHERE grade_level = ?').run(grade);
    db.prepare('UPDATE stories SET is_active = 1 WHERE id_string = ? AND grade_level = ?').run(id, grade);
  } else {
    db.prepare('UPDATE stories SET is_active = 0').run();
    db.prepare('UPDATE stories SET is_active = 1 WHERE id_string = ?').run(id);
  }
  return { success: true };
});

ipcMain.handle('get-active-story-for-grade', async (event, grade) => {
  return db.prepare('SELECT * FROM stories WHERE grade_level = ? AND is_active = 1').get(grade);
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
        csvContent = "Name,Email,Grade,Class,Language,Parent Name,Parent Surname,Parent Email,Parent Phone\n";
        data.forEach(s => {
          csvContent += `"${s.name}","${s.email}","${s.grade}","${s.class_id}","${s.language}","${s.parent_name || ''}","${s.parent_surname || ''}","${s.parent_email || ''}","${s.parent_phone || ''}"\n`;
        });
      } else if (type === 'Teachers') {
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

ipcMain.handle('export-database-backup', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Database Backup',
    defaultPath: path.join(app.getPath('documents'), `readerpro_backup_${new Date().toISOString().split('T')[0]}.db`),
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  });

  if (!result.canceled && result.filePath) {
    try {
      const dbPath = db.name;
      fs.copyFileSync(dbPath, result.filePath);
      return { success: true, path: result.filePath };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
  return { success: false };
});

ipcMain.handle('get-settings', async () => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
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

ipcMain.handle('scan-pdf', async (event, filePath) => {
  try {
    const canvas = require('@napi-rs/canvas');
    const pdfjsLib = require('pdfjs-dist');
    
    const data = new Uint8Array(fs.readFileSync(filePath));
    
    const pdf = await pdfjsLib.getDocument({ 
      data,
      CanvasFactory: canvas.Canvas 
    }).promise;

    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + "\n\n";
    }

    return { success: true, text: fullText.trim() };
  } catch (err) {
    console.error("PDF Scan Error:", err);
    return { 
      success: false, 
      message: "Could not extract text from PDF. If this is a scanned image, please copy-paste manually." 
    };
  }
});

const GITHUB_OWNER = 'ConradBouwer';
const GITHUB_REPO = 'ReaderPro';
const CURRENT_VERSION = app.getVersion();

function downloadWithRedirects(url, callback, progressCallback) {
  const client = url.startsWith('https:') ? https : http;
  
  client.get(url, {
    headers: {
      'User-Agent': 'Literacy-Portal-Updater'
    }
  }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      console.log(`Following redirect to: ${response.headers.location}`);
      downloadWithRedirects(response.headers.location, callback, progressCallback);
      return;
    }
    
    if (response.statusCode !== 200) {
      callback(new Error(`Download failed with status ${response.statusCode}`));
      return;
    }

    callback(null, response);
  }).on('error', (err) => {
    callback(err);
  });
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'Literacy-Portal-Updater',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            
            if (release.message === 'Not Found') {
              resolve({ 
                success: false, 
                message: 'No releases found. Repository may be private or releases not published.' 
              });
              return;
            }

            const latestVersion = release.tag_name.replace(/^v/, '');
            
            const currentParts = CURRENT_VERSION.split('.').map(Number);
            const latestParts = latestVersion.split('.').map(Number);
            
            let hasUpdate = false;
            for (let i = 0; i < 3; i++) {
              if (latestParts[i] > (currentParts[i] || 0)) {
                hasUpdate = true;
                break;
              } else if (latestParts[i] < (currentParts[i] || 0)) {
                break;
              }
            }

            if (hasUpdate) {
              const platform = process.platform;
              const arch = process.arch;
              let asset = null;
              
              const platformPatterns = {
                win32: /\.exe$|\.msi$|\.nsis\.exe$/i,
                darwin: /\.dmg$|\.zip$/i,
                linux: /\.AppImage$|\.deb$|\.rpm$|\.snap$/i
              };
              
              const pattern = platformPatterns[platform];
              if (pattern && release.assets) {
                asset = release.assets.find(a => pattern.test(a.name));
              }

              updateInfo = {
                version: latestVersion,
                releaseNotes: release.body || 'No release notes provided.',
                downloadUrl: asset ? asset.browser_download_url : null,
                assetName: asset ? asset.name : null,
                publishedAt: release.published_at,
                htmlUrl: release.html_url
              };

              resolve({
                success: true,
                hasUpdate: true,
                version: latestVersion,
                currentVersion: CURRENT_VERSION,
                releaseNotes: release.body,
                downloadUrl: asset ? asset.browser_download_url : null,
                assetName: asset ? asset.name : null,
                publishedAt: release.published_at,
                htmlUrl: release.html_url
              });
            } else {
              resolve({
                success: true,
                hasUpdate: false,
                currentVersion: CURRENT_VERSION,
                message: 'You are running the latest version.'
              });
            }
          } catch (parseError) {
            console.error('Parse error:', parseError);
            resolve({ 
              success: false, 
              message: 'Failed to parse update information.' 
            });
          }
        });
      });

      req.on('error', (error) => {
        console.error('Request error:', error);
        resolve({ 
          success: false, 
          message: 'Network error. Please check your internet connection.' 
        });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ 
          success: false, 
          message: 'Request timed out. Please try again.' 
        });
      });

      req.end();
    });
  } catch (error) {
    console.error('Update check error:', error);
    return { 
      success: false, 
      message: 'Failed to check for updates: ' + error.message 
    };
  }
});

ipcMain.handle('download-and-install-update', async (event, data = {}) => {
  const { acceptedTerms } = data;
  
  if (!acceptedTerms) {
    return { success: false, message: 'You must accept the terms to proceed.' };
  }

  if (!updateInfo || !updateInfo.downloadUrl) {
    return { success: false, message: 'No update available to download.' };
  }

  try {
    const tempDir = path.join(os.tmpdir(), 'literacy-portal-update');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const downloadPath = path.join(tempDir, updateInfo.assetName || 'update.exe');

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(downloadPath);
      
      downloadWithRedirects(updateInfo.downloadUrl, (err, response) => {
        if (err) {
          fs.unlink(downloadPath, () => {});
          reject(err);
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const progress = Math.round((downloadedBytes / totalBytes) * 100);
            mainWindow.webContents.send('download-progress', { progress, downloadedBytes, totalBytes });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(downloadPath, () => {});
          reject(err);
        });
      });
    });

    if (!fs.existsSync(downloadPath)) {
      return { success: false, message: 'Download failed - file not found.' };
    }

    if (db) {
      db.close();
      db = null;
    }

    if (process.platform === 'win32') {
      exec(`"${downloadPath}" /S`, (error) => {
        if (error) {
          console.error('Install error:', error);
          return;
        }
        app.quit();
      });
    } else if (process.platform === 'darwin') {
      exec(`open "${downloadPath}"`, (error) => {
        if (error) {
          console.error('Install error:', error);
          return;
        }
        app.quit();
      });
    } else {
      fs.chmodSync(downloadPath, '755');
      exec(`"${downloadPath}"`, (error) => {
        if (error) {
          console.error('Install error:', error);
          return;
        }
        app.quit();
      });
    }

    return { success: true, message: 'Installer launched. The application will close now.' };
  } catch (error) {
    console.error('Download/Install error:', error);
    return { 
      success: false, 
      message: 'Failed to download or install update: ' + error.message 
    };
  }
});

ipcMain.handle('open-release-page', async () => {
  if (updateInfo && updateInfo.htmlUrl) {
    await shell.openExternal(updateInfo.htmlUrl);
    return { success: true };
  }
  return { success: false, message: 'No release page available.' };
});

ipcMain.handle('get-app-version', async () => {
  return { 
    version: CURRENT_VERSION,
    platform: process.platform,
    arch: process.arch
  };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
