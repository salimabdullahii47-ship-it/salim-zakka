const os = require('os');
const path = require('path');

// Use a configurable DB path. In serverless (VERCEL) use in-memory DB to avoid
// filesystem write errors. You can override with env `DB_FILE` in other envs.
const dbFile = process.env.DB_FILE || (process.env.VERCEL ? ':memory:' : path.join(__dirname, 'local.db'));

let db;
try {
	const Database = require('better-sqlite3');
	db = new Database(dbFile);
} catch (err) {
	console.warn('Warning: failed to load or open better-sqlite3. Falling back to an in-memory mock DB.\n', err && err.message);
	// Minimal mock DB to avoid crashing serverless functions. This mock does NOT execute SQL
	// and returns safe empty results. Replace with a real DB for production.
	db = {
		prepare: () => ({
			run: () => ({ changes: 0, lastInsertRowid: 0 }),
			get: () => undefined,
			all: () => []
		}),
		exec: () => {},
		close: () => {},
		isMock: true
	};
}

module.exports = db;
