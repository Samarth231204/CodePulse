const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { checkDbConnection } = require('./config/db');

dotenv.config();

const app = express();
const port = process.env.BACKEND_PORT || 8000;

// Configure CORS origins dynamically
let origins = ["http://localhost:5173", "http://127.0.0.1:5173"];
if (process.env.BACKEND_CORS_ORIGINS) {
  try {
    origins = JSON.parse(process.env.BACKEND_CORS_ORIGINS);
  } catch (e) {
    console.error("Failed to parse BACKEND_CORS_ORIGINS, using defaults");
  }
}

app.use(cors({
  origin: origins,
  credentials: true
}));

app.use(express.json());

// Health Check Route
app.get('/health', async (req, res) => {
  const dbConnected = await checkDbConnection();
  res.json({
    status: 'healthy',
    db: dbConnected ? 'connected' : 'disconnected'
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Express API Server running on port ${port}`);
});

module.exports = app;
