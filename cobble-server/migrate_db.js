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
    console.log('Migrating EasyAuth table columns...');
    
    // Check if columns exist and rename them
    const [columns] = await connection.execute('SHOW COLUMNS FROM easyauth');
    const columnNames = columns.map(c => c.Field);
    
    if (columnNames.includes('regdate') && !columnNames.includes('reg_date')) {
      await connection.execute('ALTER TABLE easyauth CHANGE regdate reg_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      console.log('- Renamed regdate to reg_date');
    }
    if (columnNames.includes('lastip') && !columnNames.includes('last_ip')) {
      await connection.execute('ALTER TABLE easyauth CHANGE lastip last_ip VARCHAR(45)');
      console.log('- Renamed lastip to last_ip');
    }
    if (columnNames.includes('lastlogin') && !columnNames.includes('last_login')) {
      await connection.execute('ALTER TABLE easyauth CHANGE lastlogin last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
      console.log('- Renamed lastlogin to last_login');
    }
    
    console.log('Migration completed successfully.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    console.log('You might need to run these manually in your SQL console:');
    console.log('ALTER TABLE easyauth CHANGE regdate reg_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP;');
    console.log('ALTER TABLE easyauth CHANGE lastip last_ip VARCHAR(45);');
    console.log('ALTER TABLE easyauth CHANGE lastlogin last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;');
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
