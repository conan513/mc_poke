const mysql = require('mysql2/promise');
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '123456',
  database: 'cobble_universe'
};

async function migrate() {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Migrating EasyAuth table to V2 (JSON Data column)...');
    
    // Check if 'data' column exists
    const [columns] = await connection.execute('SHOW COLUMNS FROM easyauth');
    const columnNames = columns.map(c => c.Field);
    
    if (!columnNames.includes('data')) {
      console.log('- Adding "data" column...');
      await connection.execute('ALTER TABLE easyauth ADD COLUMN data LONGTEXT');
    }

    // Migrate existing rows if data is null
    const [rows] = await connection.execute('SELECT * FROM easyauth WHERE data IS NULL');
    console.log(`- Migrating ${rows.length} existing users to JSON format...`);

    for (const row of rows) {
      // Handle different possible column names from previous attempts
      const password = row.password;
      const last_ip = row.last_ip || row.lastip || '';
      const reg_date = row.reg_date || row.regdate || new Date().toISOString();
      
      const data = {
        password: password,
        last_ip: last_ip,
        last_authenticated_date: new Date().toISOString(),
        login_tries: 0,
        last_kicked_date: "1970-01-01T00:00:00Z",
        online_account: "UNKNOWN",
        registration_date: new Date(reg_date).toISOString(),
        data_version: 1
      };

      await connection.execute('UPDATE easyauth SET data = ? WHERE id = ?', [JSON.stringify(data), row.id]);
      console.log(`  * Migrated user: ${row.username}`);
    }
    
    console.log('Migration completed successfully.');
  } catch (e) {
    console.error('Migration failed:', e.message);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
