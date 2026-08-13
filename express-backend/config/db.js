const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

// Load environment variables from root or local .env
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || 'postgresql://codepulse_user:codepulse_password@db:5432/codepulse_dev';

const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

async function checkDbConnection() {
  try {
    await sequelize.authenticate();
    return true;
  } catch (error) {
    console.error('Database connectivity check failed:', error.message);
    return false;
  }
}

module.exports = {
  sequelize,
  checkDbConnection
};
