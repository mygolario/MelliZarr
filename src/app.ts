import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import goldRouter from './routes/gold';
import multisigRouter from './routes/multisig';

const app = express();

// Standard middleware
app.use(cors());
app.use(express.json());

// Routes registration
app.use('/api/auth', authRouter);
app.use('/api/gold', goldRouter);
app.use('/api/multisig', multisigRouter);

// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'HEALTHY',
    timestamp: new Date(),
    service: 'MelliZarr Core Backend API',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}. Route not found.`,
  });
});

export default app;
